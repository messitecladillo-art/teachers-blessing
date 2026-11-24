"""Chinese micro-teaching voice narration generator using edge-tts with offline Windows SAPI fallback."""

from __future__ import annotations

import asyncio
import hashlib
import math
import os
import re
import struct
import subprocess
import wave
from pathlib import Path
from typing import Any

import edge_tts

from core.config import EXPORTS_DIR


AVAILABLE_VOICES = [
    {"id": "zh-CN-XiaoxiaoNeural", "label": "晓晓 · 亲和自然女声（推荐微格试讲）"},
    {"id": "zh-CN-YunxiNeural", "label": "云希 · 沉稳清晰男声（适合理化推理）"},
    {"id": "zh-CN-XiaoyiNeural", "label": "晓伊 · 柔和细致女声（适合中小学课堂）"},
]


def _write_fallback_wave(wav_path: Path, duration_sec: float = 0.8) -> None:
    """Write a valid 22.05kHz mono PCM WAV file (>20KB) as final cross-platform safety net."""
    sample_rate = 22050
    n_samples = int(sample_rate * duration_sec)
    frames = bytearray()
    for i in range(n_samples):
        env = max(0.0, 1.0 - i / max(1, n_samples))
        val = int(3200 * env * math.sin(2 * math.pi * 523.25 * (i / sample_rate)))
        frames.extend(struct.pack("<h", val))
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(frames))


def _synthesize_windows_sapi(full_script: str, deck_id: str, wav_path: Path) -> str:
    """Offline Chinese TTS fallback via Windows System.Speech.Synthesis.SpeechSynthesizer."""
    tmp_txt = EXPORTS_DIR / f"_tts_script_{deck_id}.txt"
    tmp_txt.write_text(full_script[:3600], encoding="utf-8")
    env = os.environ.copy()
    env["EDU_TTS_TXT"] = str(tmp_txt)
    env["EDU_TTS_WAV"] = str(wav_path)
    ps_cmd = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1; "
        "if ($zh) { $s.SelectVoice($zh.VoiceInfo.Name) }; "
        "$s.SetOutputToWaveFile($env:EDU_TTS_WAV); "
        "$txt = [System.IO.File]::ReadAllText($env:EDU_TTS_TXT, [System.Text.Encoding]::UTF8); "
        "$s.Speak($txt); "
        "$s.Dispose()"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode == 0 and wav_path.is_file() and wav_path.stat().st_size > 10000:
            return "windows-sapi-zh"
    except Exception:
        pass
    finally:
        tmp_txt.unlink(missing_ok=True)

    _write_fallback_wave(wav_path)
    return "pcm-wav-fallback"


_TTS_VOICE_MAP: dict[str, str] = {
    "zh_female_clear": "zh-CN-XiaoxiaoNeural",
    "zh_male_steady": "zh-CN-YunxiNeural",
    "zh_female_warm": "zh-CN-XiaoyiNeural",
    "zh_male_fast": "zh-CN-YunjianNeural",
}


def latex_to_spoken_zh(text: str) -> str:
    """Convert LaTeX formulas and markup into natural spoken Chinese for TTS."""
    if not text:
        return ""
    s = str(text)
    s = re.sub(r"```[\s\S]*?```", " ", s)
    s = re.sub(r"(?m)^\s*>\s?", " ", s)
    s = re.sub(r"\$\$?", " ", s)

    # Unwrap common text wrappers
    for _ in range(3):
        s = re.sub(r"\\(?:text|mathrm|mathbf|operatorname|boldsymbol)\{([^{}]*)\}", r"\1", s)

    # Common blackboard sets
    s = re.sub(r"\\mathbb\{R\}", " 全体实数集 ", s)
    s = re.sub(r"\\mathbb\{N\}", " 自然数集 ", s)
    s = re.sub(r"\\mathbb\{Z\}", " 整数集 ", s)
    s = re.sub(r"\\mathbb\{Q\}", " 有理数集 ", s)
    s = re.sub(r"\\mathbb\{C\}", " 复数集 ", s)
    s = re.sub(r"\\mathbb\{([A-Za-z]+)\}", r" \1 ", s)

    # Strip sizing wrappers & thin-space commands before operator replacements
    s = re.sub(r"\\(?:left|right)\b|\\[,;:!]", " ", s)

    # Fractions & roots (nested-safe)
    for _ in range(3):
        s, n = re.subn(r"\\(?:d|t)?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r" \2 分之 \1 ", s)
        if n == 0:
            break

    s = re.sub(r"\\sqrt\[([^\]]+)\]\{([^{}]+)\}", r" \1 次根号下 \2 ", s)
    for _ in range(2):
        s = re.sub(r"\\sqrt\{([^{}]+)\}", r" 根号下 \1 ", s)

    s = re.sub(r"-\s*\\infty(?![A-Za-z])", " 负无穷大 ", s)
    s = re.sub(r"\+\s*\\infty(?![A-Za-z])", " 正无穷大 ", s)

    replacements = [
        (r"\\Rightarrow(?![A-Za-z])", " 推出 "),
        (r"\\Leftarrow(?![A-Za-z])", " 反推得到 "),
        (r"\\iff(?![A-Za-z])", " 当且仅当 "),
        (r"\\leftrightarrow(?![A-Za-z])", " 等价于 "),
        (r"\\rightarrow\b|\\to\b", " 趋近于 "),
        (r"\\mapsto(?![A-Za-z])", " 映射到 "),
        (r"\\ge(?:q)?\b", " 大于等于 "),
        (r"\\le(?:q)?\b", " 小于等于 "),
        (r"\\ne(?:q)?\b", " 不等于 "),
        (r"\\approx(?![A-Za-z])", " 约等于 "),
        (r"\\equiv(?![A-Za-z])|\\cong(?![A-Za-z])", " 同构于 "),
        (r"\\propto(?![A-Za-z])", " 正比于 "),
        (r"\\infty(?![A-Za-z])", " 无穷大 "),
        (r"\\emptyset\b|\\varnothing\b", " 空集 "),
        (r"\\sum(?![A-Za-z])", " 求和 "),
        (r"\\int(?![A-Za-z])", " 积分 "),
        (r"\\cup(?![A-Za-z])", " 并 "),
        (r"\\cap(?![A-Za-z])", " 交 "),
        (r"\\in\b", " 属于 "),
        (r"\\notin\b", " 不属于 "),
        (r"\\subset(?:eq)?\b", " 包含于 "),
        (r"\\mid\b", " 整除 "),
        (r"\\cdot(?![A-Za-z])", " 乘 "),
        (r"\\times(?![A-Za-z])", " 乘以 "),
        (r"\\div(?![A-Za-z])", " 除以 "),
        (r"\\pm(?![A-Za-z])", " 加减 "),
        (r"\\ln\b", " 自然对数 "),
        (r"\\log\b", " 对数 "),
        (r"\\sin\b", " 正弦 "),
        (r"\\cos\b", " 余弦 "),
        (r"\\tan\b", " 正切 "),
        (r"\\lim(?![A-Za-z])", " 极限 "),
        (r"\\max(?![A-Za-z])", " 最大值 "),
        (r"\\min(?![A-Za-z])", " 最小值 "),
        (r"\\alpha(?![A-Za-z])", " 阿尔法 "),
        (r"\\beta(?![A-Za-z])", " 贝塔 "),
        (r"\\gamma(?![A-Za-z])", " 伽马 "),
        (r"\\Delta(?![A-Za-z])", " 判别式德尔塔 "),
        (r"\\delta(?![A-Za-z])", " 德尔塔 "),
        (r"\\theta(?![A-Za-z])", " 西塔 "),
        (r"\\varphi(?![A-Za-z])|\\phi(?![A-Za-z])", " 斐 "),
        (r"\\lambda(?![A-Za-z])", " 拉姆达 "),
        (r"\\pi(?![A-Za-z])", " 派 "),
        (r"\\sigma(?![A-Za-z])", " 西格玛 "),
        (r"\\omega(?![A-Za-z])", " 欧米伽 "),
        (r"\\partial(?![A-Za-z])", " 偏 "),
        (r"\\forall(?![A-Za-z])", " 对任意 "),
        (r"\\exists(?![A-Za-z])", " 存在 "),
    ]
    for pat, rep in replacements:
        s = re.sub(pat, rep, s)

    # Derivatives: f''(x), f'(x)
    s = re.sub(r"([A-Za-z])''\s*\(([^)]+)\)", r"\1 两撇 \2", s)
    s = re.sub(r"([A-Za-z])'\s*\(([^)]+)\)", r"\1 撇 \2", s)
    s = re.sub(r"([A-Za-z])''", r"\1 两撇", s)
    s = re.sub(r"([A-Za-z])'", r"\1 撇", s)

    # Powers & subscripts
    s = re.sub(r"\^\{2\}|\^2\b", " 的平方 ", s)
    s = re.sub(r"\^\{3\}|\^3\b", " 的立方 ", s)
    s = re.sub(r"\^\{([^{}]+)\}", r" 的 \1 次方 ", s)
    s = re.sub(r"\^(-?\d+|[A-Za-z])", r" 的 \1 次方 ", s)
    s = re.sub(r"_\{([^{}]+)\}", r" 下标 \1 ", s)
    s = re.sub(r"_([A-Za-z0-9]+)", r" 下标 \1 ", s)

    # Second fraction & root pass after inner \sqrt / ^ / _ braces have been unwrapped
    for _ in range(3):
        s, n = re.subn(r"\\(?:d|t)?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r" \2 分之 \1 ", s)
        if n == 0:
            break
    s = re.sub(r"\\sqrt\{([^{}]+)\}", r" 根号下 \1 ", s)

    # Multi-char ASCII operators & Unicode symbols
    unicode_map = {
        "<=>": " 当且仅当 ",
        "<->": " 等价于 ",
        "=>": " 推出 ",
        "->": "，下一步 ",
        ">=": " 大于等于 ",
        "<=": " 小于等于 ",
        "!=": " 不等于 ",
        "⇒": " 推出 ",
        "→": "，下一步 ",
        "≥": " 大于等于 ",
        "≤": " 小于等于 ",
        "≠": " 不等于 ",
        ">": " 大于 ",
        "<": " 小于 ",
        "＞": " 大于 ",
        "＜": " 小于 ",
        "∞": " 无穷大 ",
        "∈": " 属于 ",
        "∝": " 正比于 ",
        "·": " 乘 ",
        "²": " 的平方",
        "³": " 的立方",
    }
    for k, v in unicode_map.items():
        s = s.replace(k, v)

    s = re.sub(r"\\[A-Za-z]+", " ", s)
    s = re.sub(r"[{}\\#*`>~|<]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


async def synthesize_text_audio(
    *,
    cache_key: str,
    text: str,
    voice_id: str = "zh_female_clear",
) -> dict[str, Any]:
    """Synthesize cached Chinese voice narration for lecture/whiteboard playback with offline fallback."""
    clean_text = latex_to_spoken_zh(text)[:2400]
    if not clean_text:
        raise ValueError("当前没有可朗读的文本内容。")

    edge_voice = _TTS_VOICE_MAP.get(
        (voice_id or "").strip(),
        voice_id if str(voice_id or "").startswith("zh-") else "zh-CN-XiaoxiaoNeural",
    )
    safe_key = re.sub(r"[^a-zA-Z0-9_-]+", "_", cache_key or "lec")[:48]
    digest = hashlib.sha1(f"{edge_voice}::{clean_text}".encode("utf-8")).hexdigest()[:10]
    mp3_path = EXPORTS_DIR / f"tts_{safe_key}_{digest}.mp3"
    wav_path = EXPORTS_DIR / f"tts_{safe_key}_{digest}.wav"

    if mp3_path.is_file() and mp3_path.stat().st_size > 1000:
        return {
            "audio_path": str(mp3_path),
            "filename": mp3_path.name,
            "mime_type": "audio/mpeg",
            "engine": "edge-tts-cache",
            "size_bytes": mp3_path.stat().st_size,
            "voice": edge_voice,
        }
    if wav_path.is_file() and wav_path.stat().st_size > 1000:
        return {
            "audio_path": str(wav_path),
            "filename": wav_path.name,
            "mime_type": "audio/wav",
            "engine": "wav-cache",
            "size_bytes": wav_path.stat().st_size,
            "voice": edge_voice,
        }

    try:
        communicate = edge_tts.Communicate(clean_text, voice=edge_voice, rate="+0%")
        await asyncio.wait_for(communicate.save(str(mp3_path)), timeout=8.0)
        if mp3_path.is_file() and mp3_path.stat().st_size > 1000:
            return {
                "audio_path": str(mp3_path),
                "filename": mp3_path.name,
                "mime_type": "audio/mpeg",
                "engine": "edge-tts",
                "size_bytes": mp3_path.stat().st_size,
                "voice": edge_voice,
            }
    except Exception:
        pass

    engine_used = await asyncio.to_thread(_synthesize_windows_sapi, clean_text, f"{safe_key}_{digest}", wav_path)
    return {
        "audio_path": str(wav_path),
        "filename": wav_path.name,
        "mime_type": "audio/wav",
        "engine": engine_used,
        "size_bytes": wav_path.stat().st_size if wav_path.is_file() else 0,
        "voice": edge_voice,
    }


async def synthesize_deck_narration(
    *,
    deck_id: str,
    title: str,
    slides: list[dict[str, Any]],
    voice: str = "zh-CN-XiaoxiaoNeural",
) -> dict[str, Any]:
    """Synthesize a merged micro-teaching demo narration audio from slide speaker notes."""
    chunks: list[str] = []
    for idx, sl in enumerate(slides, start=1):
        notes = str(sl.get("speaker_notes") or "").strip()
        if not notes:
            notes = f"第{idx}页，{sl.get('title', '')}。{sl.get('takeaway', '')}"
        chunks.append(f"第{idx}页。{notes}")

    full_script = latex_to_spoken_zh("\n".join(chunks))[:3600]
    if not full_script:
        raise ValueError("当前课件没有可用的讲解逐字稿。")

    mp3_path = EXPORTS_DIR / f"试讲示范音频_{deck_id}.mp3"
    try:
        communicate = edge_tts.Communicate(full_script, voice=voice, rate="+0%")
        await asyncio.wait_for(communicate.save(str(mp3_path)), timeout=10.0)
        if mp3_path.is_file() and mp3_path.stat().st_size > 1000:
            return {
                "audio_path": str(mp3_path),
                "filename": mp3_path.name,
                "mime_type": "audio/mpeg",
                "engine": "edge-tts",
                "size_bytes": mp3_path.stat().st_size,
                "voice": voice,
                "char_count": len(full_script),
            }
    except Exception:
        pass

    wav_path = EXPORTS_DIR / f"试讲示范音频_{deck_id}.wav"
    engine_used = await asyncio.to_thread(_synthesize_windows_sapi, full_script, deck_id, wav_path)
    return {
        "audio_path": str(wav_path),
        "filename": wav_path.name,
        "mime_type": "audio/wav",
        "engine": engine_used,
        "size_bytes": wav_path.stat().st_size if wav_path.is_file() else 0,
        "voice": voice,
        "char_count": len(full_script),
    }
