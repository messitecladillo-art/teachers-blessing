"""Source document ingestion supporting PDF (with Beamer deduplication), DOCX, PPTX, LaTeX (UTF-8/GBK), HTML, and ZIP course packs."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from core.config import PPT_MASTER_SCRIPTS_DIR, UPLOADS_DIR


def _decode_bytes_auto(raw: bytes) -> str:
    """Decode UTF-8, GB18030, or GBK source files without mojibake."""
    for enc in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _extract_brace_arg(text: str, start_brace_idx: int) -> tuple[str, int]:
    """Return content inside matching {...} starting at start_brace_idx and end index."""
    if start_brace_idx >= len(text) or text[start_brace_idx] != "{":
        return "", start_brace_idx
    depth = 0
    for idx in range(start_brace_idx, len(text)):
        ch = text[idx]
        if ch == "{" and (idx == 0 or text[idx - 1] != "\\"):
            depth += 1
        elif ch == "}" and (idx == 0 or text[idx - 1] != "\\"):
            depth -= 1
            if depth == 0:
                return text[start_brace_idx + 1 : idx], idx + 1
    return text[start_brace_idx + 1 :], len(text)


def _convert_tex_to_markdown(file_path: Path) -> str:
    """Convert LaTeX / CJK Beamer (.tex/.latex) with GBK/UTF-8 detection into clean Markdown."""
    raw = _decode_bytes_auto(file_path.read_bytes())
    raw = raw.replace("\r\n", "\n")

    # Strip unescaped % comments before parsing commands
    raw = re.sub(r"(?<!\\)%[^\n]*", "", raw)

    # Extract title / author metadata
    title_matches = re.findall(r"\\title(?:\[[^\]]*\])?\{([^}]*)\}", raw)
    title_clean = ""
    if title_matches:
        t_raw = title_matches[-1]
        t_raw = re.sub(r"\\(?:Large|large|huge|CJKfamily\{[^}]*\})\s*", "", t_raw).strip()
        title_clean = re.sub(r"\s+", " ", t_raw)

    author_m = re.search(r"\\author\{([^}]*)\}", raw)
    author_clean = author_m.group(1).strip() if author_m else ""

    if r"\begin{document}" in raw:
        raw = raw.split(r"\begin{document}", 1)[1]
    if r"\end{document}" in raw:
        raw = raw.split(r"\end{document}", 1)[0]

    # Strip Beamer/CJK wrappers & incremental overlay directives
    raw = re.sub(r"\\begin\{CJK\}\{[^}]*\}\{[^}]*\}", "", raw)
    raw = raw.replace(r"\end{CJK}", "")
    raw = re.sub(r"\\CJKfamily\{[^}]*\}", "", raw)
    raw = re.sub(r"\\(?:pause|titlepage)\b", "", raw)
    raw = re.sub(r"\\onslide<[^>]*>", "", raw)
    raw = re.sub(r"\\frame\{\\titlepage\}|\s*\\frame\{\}", "", raw)
    raw = re.sub(r"\\begin\{(?:description|itemize|enumerate)\}(\[[^\]]*\])?", "", raw)
    raw = re.sub(r"\\end\{(?:description|itemize|enumerate)\}", "\n", raw)

    for cmd, fmt in (
        ("section", "\n\n## {body}\n"),
        ("subsection", "\n\n### {body}\n"),
        ("frametitle", "\n\n#### {body}\n"),
        ("textbf", "**{body}**"),
        ("alert", "**{body}**"),
    ):
        pattern = re.compile(rf"\\{cmd}\*?\s*\{{")
        while True:
            m = pattern.search(raw)
            if not m:
                break
            inner, end_idx = _extract_brace_arg(raw, m.end() - 1)
            raw = raw[: m.start()] + fmt.format(body=inner.strip()) + raw[end_idx:]

    block_pat = re.compile(r"\\begin\{block\}\s*\{")
    while True:
        m = block_pat.search(raw)
        if not m:
            break
        inner, end_idx = _extract_brace_arg(raw, m.end() - 1)
        raw = raw[: m.start()] + f"\n**【{inner.strip()}】**\n" + raw[end_idx:]
    raw = raw.replace(r"\end{block}", "\n")
    raw = re.sub(r"\\begin\{frame\}(?:<[^>]*>)?(?:\{([^}]*)\})?", lambda m: f"\n\n#### {m.group(1)}\n" if m.group(1) else "\n\n---\n", raw)
    raw = raw.replace(r"\end{frame}", "\n")

    raw = re.sub(r"\\item\[([^\]]+)\]\s*", r"\n- **\1**：", raw)
    raw = re.sub(r"\\item\s+", "\n- ", raw)

    lines = [ln.rstrip() for ln in raw.splitlines()]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    header = f"# {title_clean or file_path.stem}\n"
    if author_clean:
        header += f"> 授课教师/作者：{author_clean}\n"
    return f"{header}\n{cleaned}".strip()


class _CleanHtmlTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t in ("script", "style", "noscript", "svg"):
            self._skip_depth += 1
        elif t in ("h1", "h2", "h3", "h4"):
            self.chunks.append(f"\n\n{'#' * int(t[1])} ")
        elif t in ("p", "li", "tr", "div", "section"):
            self.chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("script", "style", "noscript", "svg") and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            txt = data.strip()
            if txt:
                self.chunks.append(txt + " ")


def _convert_html_to_markdown(file_path: Path) -> str:
    """Convert structured exam HTML (like MathQuestionBank) or general HTML into clean Markdown."""
    raw = _decode_bytes_auto(file_path.read_bytes())
    marker = "globalThis.MathQuestionBank"
    if marker in raw:
        eq_pos = raw.find("=", raw.find(marker))
        if eq_pos != -1:
            try:
                bank, _ = json.JSONDecoder().raw_decode(raw[eq_pos + 1 :].lstrip())
                lines = [f"# {file_path.stem}（内置题库结构摘要）"]
                books = bank.get("books") or {}
                chapters = bank.get("chapters") or []
                items = bank.get("items") or []
                lines.append(f"- 教材册别：{'、'.join(books.values())}")
                lines.append(f"- 章节单元：{len(chapters)} 个 ｜ 收录题目：{len(items)} 道")
                lines.append("\n## 章节与知识点目录")
                for ch in chapters:
                    tps = "、".join(t["name"] for t in (ch.get("topics") or []))
                    lines.append(f"- **{ch.get('label', ch.get('name', ''))}**：{tps}")
                lines.append("\n## 精选示例试题")
                for idx, it in enumerate(items[:5], start=1):
                    lines.append(f"{idx}. [{it.get('type', '')} · {it.get('difficulty', '')}] {it.get('stem', '')}")
                return "\n".join(lines)
            except Exception:
                pass

    parser = _CleanHtmlTextParser()
    parser.feed(raw)
    text = "".join(parser.chunks)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return f"# {file_path.stem}\n\n{text[:18000]}".strip()


def _clean_beamer_pdf_markdown(md_text: str) -> str:
    """Strip Beamer dot-progress bars and collapse incremental overlay pages into complete frames."""
    cleaned = re.sub(r"[\.·…]{6,}", "", md_text)
    pages = re.split(r"(<!--\s*Page\s+\d+\s*-->)", cleaned)
    if len(pages) < 4:
        return re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    preamble = pages[0].strip()
    blocks: list[tuple[str, str]] = []
    for i in range(1, len(pages), 2):
        marker = pages[i]
        body = pages[i + 1].strip() if i + 1 < len(pages) else ""
        if body:
            blocks.append((marker, body))

    deduped: list[tuple[str, str]] = []
    for marker, body in blocks:
        norm_cur = re.sub(r"\s+", "", body)
        if deduped:
            norm_prev = re.sub(r"\s+", "", deduped[-1][1])
            # In Beamer \pause PDFs, page N+1 repeats all lines from page N plus new reveals
            if norm_prev and (norm_prev in norm_cur or norm_cur.startswith(norm_prev[: max(12, int(len(norm_prev) * 0.8))])):
                deduped[-1] = (marker, body)
                continue
        deduped.append((marker, body))

    parts = [preamble] if preamble else []
    for marker, body in deduped:
        parts.append(f"{marker}\n\n{body}")
    return re.sub(r"\n{3,}", "\n\n", "\n\n".join(parts)).strip()


def _decode_zip_filename(info: zipfile.ZipInfo) -> str:
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("gbk")
    except Exception:
        return info.filename


def _convert_zip_to_markdown(file_path: Path) -> str:
    """List multi-lecture ZIP package contents and extract text from inner documents."""
    supported_inner = {".tex", ".latex", ".md", ".txt", ".html", ".htm", ".pptx", ".docx", ".pdf"}
    lines = [f"# 课程资料压缩包：{file_path.name}", ""]
    extracted_sections: list[str] = []

    with zipfile.ZipFile(file_path, "r") as zf:
        entries = [i for i in zf.infolist() if not i.is_dir()]
        lines.append(f"共包含 {len(entries)} 个文件：")
        for info in entries:
            name = _decode_zip_filename(info)
            size_kb = max(1, info.file_size // 1024)
            lines.append(f"- `{name}` ({size_kb} KB)")

        with tempfile.TemporaryDirectory() as tmpdir:
            td = Path(tmpdir)
            processed = 0
            for info in entries:
                if processed >= 8:
                    break
                name = _decode_zip_filename(info)
                suffix = Path(name).suffix.lower()
                if suffix not in supported_inner or Path(name).name.startswith("~$"):
                    continue
                safe_name = f"item_{processed}{suffix}"
                inner_path = td / safe_name
                inner_path.write_bytes(zf.read(info.filename))
                try:
                    res = convert_uploaded_source_to_markdown(inner_path)
                    snippet = str(res["markdown"]).strip()[:3200]
                    if snippet:
                        extracted_sections.append(f"\n---\n## 讲义文档：{Path(name).name}\n\n{snippet}")
                        processed += 1
                except Exception:
                    continue

    lines.extend(extracted_sections)
    return "\n".join(lines).strip()


def convert_uploaded_source_to_markdown(file_path: Path) -> dict[str, str | int]:
    """Convert PDF/DOCX/PPTX/XLSX/LaTeX/HTML/ZIP/MD/TXT into clean Markdown."""
    ext = file_path.suffix.lower()
    if ext in {".md", ".markdown", ".txt", ".csv"}:
        text = _decode_bytes_auto(file_path.read_bytes())
        return {
            "markdown": text,
            "char_count": len(text),
            "converter": "native_text_auto_encoding",
        }
    if ext in {".tex", ".latex"}:
        md_text = _convert_tex_to_markdown(file_path)
        return {
            "markdown": md_text,
            "char_count": len(md_text),
            "converter": "beamer_tex_utf8_gbk",
        }
    if ext in {".html", ".htm"}:
        md_text = _convert_html_to_markdown(file_path)
        return {
            "markdown": md_text,
            "char_count": len(md_text),
            "converter": "html_structured_extractor",
        }
    if ext == ".zip":
        md_text = _convert_zip_to_markdown(file_path)
        return {
            "markdown": md_text,
            "char_count": len(md_text),
            "converter": "zip_course_pack_extractor",
        }

    out_md = file_path.with_suffix(".md")
    script = PPT_MASTER_SCRIPTS_DIR / "source_to_md.py"
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    proc = subprocess.run(
        [sys.executable, str(script), str(file_path), "-o", str(out_md)],
        cwd=str(UPLOADS_DIR),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=90,
    )
    if proc.returncode != 0 or not out_md.is_file():
        raise RuntimeError(f"source_to_md 解析失败 ({proc.returncode}): {proc.stdout}\n{proc.stderr}")

    md_text = out_md.read_text(encoding="utf-8", errors="replace")
    if ext == ".pdf":
        md_text = _clean_beamer_pdf_markdown(md_text)
    return {
        "markdown": md_text,
        "char_count": len(md_text),
        "converter": "ppt-master/source_to_md.py",
    }


def detect_garbled_pdf_text(text: str) -> tuple[bool, str]:
    """Detect mojibake / custom Type3/CID font encoding anomalies in extracted PDF text."""
    if not text or not text.strip():
        return True, "未提取到有效文字，可能是纯图片扫描件或特殊字库文件，建议上传可复制文本讲义。"
    non_ascii = [ch for ch in text if ord(ch) > 127]
    if len(non_ascii) >= 24:
        latin1_garbage = sum(1 for ch in non_ascii if 0x00C0 <= ord(ch) <= 0x024F)
        cjk_chars = sum(1 for ch in non_ascii if 0x4E00 <= ord(ch) <= 0x9FFF)
        if latin1_garbage > max(12, len(non_ascii) * 0.25) and cjk_chars < latin1_garbage:
            return True, "检测到旧版特殊内嵌字库或扫描页面，部分中文字符无法直接读取，建议优先上传原始文档或清晰文本。"
    return False, ""


def split_markdown_to_chapters(md_text: str, default_title: str = "文档正文") -> list[dict[str, str]]:
    """Split full markdown into semantically meaningful 500~1400-char chapter chunks."""
    text = (md_text or "").replace("\r\n", "\n").strip()
    if not text:
        return []

    heading_pat = re.compile(r"(?m)^(#{1,4}\s+.+|<!--\s*Page\s+\d+\s*-->)$")
    parts = heading_pat.split(text)
    raw_sections: list[tuple[str, str]] = []
    cur_title = default_title
    cur_buf: list[str] = []

    for part in parts:
        st = part.strip()
        if not st:
            continue
        if st.startswith("#"):
            if cur_buf:
                raw_sections.append((cur_title, "\n".join(cur_buf).strip()))
                cur_buf = []
            cur_title = st.lstrip("#").strip()[:80] or default_title
        elif st.startswith("<!--"):
            if cur_buf and len("\n".join(cur_buf)) > 650:
                raw_sections.append((cur_title, "\n".join(cur_buf).strip()))
                cur_buf = []
                cur_title = re.sub(r"[<>!-]", "", st).strip() or default_title
        else:
            cur_buf.append(st)

    if cur_buf:
        raw_sections.append((cur_title, "\n".join(cur_buf).strip()))
    if not raw_sections:
        raw_sections = [(default_title, text)]

    chunks: list[dict[str, str]] = []
    max_len = 1350
    for ch_title, body in raw_sections:
        if len(body) <= max_len:
            if len(body) >= 20:
                chunks.append({"chapter_title": ch_title, "content": body})
            continue
        # Split oversized chapter cleanly along paragraph breaks
        paras = [p.strip() for p in body.split("\n\n") if p.strip()]
        buf = ""
        part_idx = 1
        for p in paras:
            if len(buf) + len(p) + 2 <= max_len:
                buf = f"{buf}\n\n{p}".strip() if buf else p
            else:
                if buf:
                    chunks.append({"chapter_title": f"{ch_title}（片段 {part_idx}）", "content": buf})
                    part_idx += 1
                buf = p[:max_len]
        if buf:
            lbl = ch_title if part_idx == 1 else f"{ch_title}（片段 {part_idx}）"
            chunks.append({"chapter_title": lbl, "content": buf})
    return chunks


def extract_structured_chapters(file_path: Path) -> dict[str, Any]:
    """Extract full-length structured chapters across single files or up to 30 ZIP inner files."""
    ext = file_path.suffix.lower()
    if ext == ".zip":
        supported_inner = {".tex", ".latex", ".md", ".txt", ".html", ".htm", ".pptx", ".docx", ".pdf"}
        all_chunks: list[dict[str, str]] = []
        notes: list[str] = []
        total_chars = 0
        with zipfile.ZipFile(file_path, "r") as zf:
            entries = [i for i in zf.infolist() if not i.is_dir()]
            with tempfile.TemporaryDirectory() as tmpdir:
                td = Path(tmpdir)
                processed = 0
                for info in entries:
                    if processed >= 30:
                        break
                    name = _decode_zip_filename(info)
                    suffix = Path(name).suffix.lower()
                    if suffix not in supported_inner or Path(name).name.startswith("~$"):
                        continue
                    inner_path = td / f"item_{processed}{suffix}"
                    inner_path.write_bytes(zf.read(info.filename))
                    try:
                        res = convert_uploaded_source_to_markdown(inner_path)
                        md_full = str(res["markdown"]).strip()
                        garbled, g_note = detect_garbled_pdf_text(md_full) if suffix == ".pdf" else (False, "")
                        if garbled:
                            notes.append(f"{Path(name).name}: {g_note}")
                            continue
                        total_chars += len(md_full)
                        file_chunks = split_markdown_to_chapters(md_full, default_title=Path(name).stem)
                        for fc in file_chunks:
                            all_chunks.append(
                                {
                                    "chapter_title": f"{Path(name).name} · {fc['chapter_title']}",
                                    "content": fc["content"],
                                }
                            )
                        processed += 1
                    except Exception:
                        continue
        quality_note = "；".join(notes[:3]) if notes else ""
        return {
            "chunks": all_chunks,
            "char_count": total_chars,
            "quality_note": quality_note,
        }

    parsed = convert_uploaded_source_to_markdown(file_path)
    md_full = str(parsed["markdown"])
    garbled, g_note = detect_garbled_pdf_text(md_full) if ext == ".pdf" else (False, "")
    chunks = split_markdown_to_chapters(md_full, default_title=file_path.stem)
    return {
        "chunks": chunks,
        "char_count": len(md_full),
        "quality_note": g_note if garbled else "",
        "markdown": md_full,
        "converter": parsed["converter"],
    }
