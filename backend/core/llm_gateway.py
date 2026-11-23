"""Dual-protocol resilient LLM gateway (Anthropic Messages w/ thinking + OpenAI compatible)."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncGenerator

import httpx

from core.config import RuntimeLLMConfig, runtime_llm_config


class LLMGatewayError(RuntimeError):
    """Raised when the upstream LLM request fails."""


def _anthropic_endpoint(base_url: str) -> str:
    clean = (base_url or "https://api.deepseek.com/anthropic").rstrip("/")
    if clean.endswith("/v1/messages") or clean.endswith("/messages"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/messages"
    return f"{clean}/v1/messages"


def _openai_endpoint(base_url: str) -> str:
    clean = (base_url or "https://api.openai.com/v1").rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    if clean.endswith("/v1"):
        return f"{clean}/chat/completions"
    return f"{clean}/v1/chat/completions"


def extract_json_payload(raw_text: str) -> Any:
    """Robustly parse JSON from an LLM response, stripping fences and repairing trailing commas."""
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("LLM returned empty text while JSON was expected.")

    # Prefer fenced ```json ... ``` blocks
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fence_match:
        candidate = fence_match.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            text = candidate

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Locate outermost { ... } or [ ... ]
    first_obj = text.find("{")
    first_arr = text.find("[")
    starts = [idx for idx in (first_obj, first_arr) if idx != -1]
    if not starts:
        raise ValueError(f"Could not find JSON object or array in output: {text[:240]}")

    start = min(starts)
    open_ch = text[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_str = False
    escaped = False
    end = -1
    for i in range(start, len(text)):
        ch = text[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\" and in_str:
            escaped = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if not in_str:
            if ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break

    slice_str = text[start:end] if end > start else text[start:]
    # Strip invalid trailing commas before } or ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", slice_str)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON from LLM: {exc}\nSnippet: {cleaned[:400]}") from exc


def _has_complete_json(text_acc: list[str]) -> bool:
    raw = "".join(text_acc).strip()
    if not raw:
        return False
    try:
        extract_json_payload(raw)
        return True
    except ValueError:
        return False


async def _stream_llm_once(
    *,
    system_prompt: str,
    user_prompt: str,
    cfg: RuntimeLLMConfig,
    eff_max_tokens: int,
    eff_temp: float,
    timeout_sec: float,
) -> AsyncGenerator[dict[str, str], None]:
    thinking_acc: list[str] = []
    text_acc: list[str] = []

    if cfg.protocol == "anthropic":
        url = _anthropic_endpoint(cfg.base_url)
        headers = {
            "x-api-key": cfg.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": cfg.model,
            "max_tokens": eff_max_tokens,
            "temperature": eff_temp,
            "stream": True,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }

        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code >= 400:
                    err_body = (await resp.aread()).decode("utf-8", errors="replace")
                    raise LLMGatewayError(f"上游 Anthropic 接口错误 ({resp.status_code}): {err_body[:360]}")

                try:
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            evt = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        evt_type = evt.get("type", "")
                        if evt_type == "content_block_start":
                            block = evt.get("content_block") or {}
                            btype = block.get("type", "text")
                            if btype == "thinking" and block.get("thinking"):
                                d = str(block["thinking"])
                                thinking_acc.append(d)
                                yield {"type": "thinking", "delta": d}
                            elif btype == "text" and block.get("text"):
                                d = str(block["text"])
                                text_acc.append(d)
                                yield {"type": "text", "delta": d}
                        elif evt_type == "content_block_delta":
                            delta = evt.get("delta") or {}
                            dtype = delta.get("type", "")
                            if dtype == "thinking_delta" or "thinking" in delta:
                                d = str(delta.get("thinking", ""))
                                if d:
                                    thinking_acc.append(d)
                                    yield {"type": "thinking", "delta": d}
                            elif dtype == "text_delta" or "text" in delta:
                                d = str(delta.get("text", ""))
                                if d:
                                    text_acc.append(d)
                                    yield {"type": "text", "delta": d}
                        elif evt_type == "error":
                            err = evt.get("error") or {}
                            raise LLMGatewayError(f"模型流式返回错误: {err.get('message', str(evt))}")
                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.StreamError):
                    if not _has_complete_json(text_acc):
                        raise

    else:
        url = _openai_endpoint(cfg.base_url)
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "content-type": "application/json",
        }
        payload = {
            "model": cfg.model,
            "max_tokens": eff_max_tokens,
            "temperature": eff_temp,
            "stream": True,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code >= 400:
                    err_body = (await resp.aread()).decode("utf-8", errors="replace")
                    raise LLMGatewayError(f"上游 OpenAI 兼容接口错误 ({resp.status_code}): {err_body[:360]}")

                try:
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            evt = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        choices = evt.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        rc = delta.get("reasoning_content")
                        if rc:
                            thinking_acc.append(str(rc))
                            yield {"type": "thinking", "delta": str(rc)}
                        content = delta.get("content")
                        if content:
                            text_acc.append(str(content))
                            yield {"type": "text", "delta": str(content)}
                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.StreamError):
                    if not _has_complete_json(text_acc):
                        raise

    yield {
        "type": "done",
        "thinking": "".join(thinking_acc),
        "text": "".join(text_acc),
    }


async def stream_llm(
    *,
    system_prompt: str,
    user_prompt: str,
    config: RuntimeLLMConfig | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    timeout_sec: float = 180.0,
) -> AsyncGenerator[dict[str, str], None]:
    """Stream LLM output with automatic fallback to fast model if deep thinking stream drops."""
    cfg = config or runtime_llm_config
    if not cfg.api_key:
        raise LLMGatewayError("未配置大模型 API Key，请先在右上角「模型设置」中填入或设置环境变量。")

    eff_max_tokens = max_tokens or cfg.max_tokens
    eff_temp = cfg.temperature if temperature is None else temperature

    try:
        async for evt in _stream_llm_once(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            cfg=cfg,
            eff_max_tokens=eff_max_tokens,
            eff_temp=eff_temp,
            timeout_sec=timeout_sec,
        ):
            yield evt
    except (httpx.RemoteProtocolError, httpx.ReadTimeout, httpx.ReadError, httpx.StreamError, httpx.ConnectError) as exc:
        fallback_model = "deepseek-chat" if (cfg.protocol == "anthropic" and "deepseek" in cfg.model) else cfg.model
        fallback_cfg = RuntimeLLMConfig(
            protocol=cfg.protocol,
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            model=fallback_model,
            temperature=eff_temp,
            max_tokens=min(eff_max_tokens, 8192),
        )
        yield {"type": "thinking", "delta": f"\n[网络防断流恢复] 流式连接中断（{exc}），已自动切换稳健通道补全结果…\n"}
        last_err: Exception | None = None
        text, thinking = "", ""
        for attempt in range(2):
            try:
                text, thinking = await call_llm(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    config=fallback_cfg,
                    max_tokens=fallback_cfg.max_tokens,
                    temperature=eff_temp,
                    timeout_sec=timeout_sec,
                )
                last_err = None
                break
            except (httpx.HTTPError, LLMGatewayError) as retry_exc:
                last_err = retry_exc
                if attempt == 0:
                    await asyncio.sleep(1.0)
        if last_err is not None:
            raise LLMGatewayError(f"流式传输与稳健恢复均中断：{last_err}") from last_err
        if text:
            yield {"type": "text", "delta": text}
        yield {"type": "done", "thinking": thinking, "text": text}


async def call_llm(
    *,
    system_prompt: str,
    user_prompt: str,
    config: RuntimeLLMConfig | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    timeout_sec: float = 180.0,
) -> tuple[str, str]:
    """Call LLM non-streamingly and return (text, thinking)."""
    cfg = config or runtime_llm_config
    if not cfg.api_key:
        raise LLMGatewayError("未配置大模型 API Key，请先在右上角「模型设置」中填入或设置环境变量。")

    eff_max_tokens = max_tokens or cfg.max_tokens
    eff_temp = cfg.temperature if temperature is None else temperature

    if cfg.protocol == "anthropic":
        url = _anthropic_endpoint(cfg.base_url)
        headers = {
            "x-api-key": cfg.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": cfg.model,
            "max_tokens": eff_max_tokens,
            "temperature": eff_temp,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                raise LLMGatewayError(f"上游 Anthropic 接口错误 ({resp.status_code}): {resp.text[:360]}")
            data = resp.json()

        thinking_parts: list[str] = []
        text_parts: list[str] = []
        for block in data.get("content", []):
            btype = block.get("type")
            if btype == "thinking":
                thinking_parts.append(str(block.get("thinking", "")))
            elif btype == "text":
                text_parts.append(str(block.get("text", "")))
        return "".join(text_parts), "".join(thinking_parts)

    url = _openai_endpoint(cfg.base_url)
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "content-type": "application/json",
    }
    payload = {
        "model": cfg.model,
        "max_tokens": eff_max_tokens,
        "temperature": eff_temp,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise LLMGatewayError(f"上游 OpenAI 兼容接口错误 ({resp.status_code}): {resp.text[:360]}")
        data = resp.json()
    msg = (data.get("choices") or [{}])[0].get("message", {})
    return str(msg.get("content") or ""), str(msg.get("reasoning_content") or "")


async def call_llm_json(
    *,
    system_prompt: str,
    user_prompt: str,
    config: RuntimeLLMConfig | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> tuple[Any, str]:
    """Call LLM and parse JSON with one automatic repair retry on format errors."""
    text, thinking = await call_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        config=config,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    try:
        return extract_json_payload(text), thinking
    except ValueError as first_err:
        repair_text, _ = await call_llm(
            system_prompt="你是严格的JSON格式修复器。只输出合法且完整的JSON，不要输出任何解释或多余字符。",
            user_prompt=f"以下内容应当是一个合法JSON，但解析报错（{first_err}）。请修复并输出纯JSON：\n\n{text[:10000]}",
            config=config,
            max_tokens=max_tokens or 12000,
            temperature=0.0,
        )
        return extract_json_payload(repair_text), thinking
