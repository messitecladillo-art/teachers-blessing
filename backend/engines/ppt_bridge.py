"""Bridge to hugohe3/ppt-master for native editable PowerPoint (.pptx) generation and auditing."""

from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from pptx import Presentation

from core.config import EXPORTS_DIR, PPT_MASTER_SCRIPTS_DIR, PPT_PROJECTS_DIR
from engines.math_verifier import sample_function_plot

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


@dataclass(frozen=True)
class ThemePalette:
    id: str
    name: str
    short_name: str
    subtitle: str
    bg_primary: str
    bg_secondary: str
    surface: str
    surface_alt: str
    border: str
    ink_primary: str
    ink_secondary: str
    ink_muted: str
    accent: str
    accent_soft: str
    accent_alt: str
    accent_alt_soft: str
    warn: str
    warn_soft: str
    success: str
    success_soft: str
    font_title: str = "Microsoft YaHei"
    font_body: str = "Microsoft YaHei"


THEMES: dict[str, ThemePalette] = {
    "porcelain_daylight": ThemePalette(
        id="porcelain_daylight",
        name="宣白松烟 · 讲席刊印",
        short_name="宣白松烟",
        subtitle="宣白活页纸感配松烟墨绿与朱砂印记，久读不倦",
        bg_primary="#F4F1EA",
        bg_secondary="#EAE5DC",
        surface="#FDFCF9",
        surface_alt="#F6F3EC",
        border="#DFD8CB",
        ink_primary="#14191F",
        ink_secondary="#3E4750",
        ink_muted="#6E7781",
        accent="#1B4D3E",
        accent_soft="#E6EFEA",
        accent_alt="#B43B2A",
        accent_alt_soft="#FAECE9",
        warn="#9A5B13",
        warn_soft="#FEF3C7",
        success="#166534",
        success_soft="#DCFCE7",
    ),
    "azure_scholar": ThemePalette(
        id="azure_scholar",
        name="云海霁蓝 · 现代教研",
        short_name="云海霁蓝",
        subtitle="清晰学术结构层级与高辨识蓝绿对比卡片",
        bg_primary="#F7F9FC",
        bg_secondary="#E8F0FE",
        surface="#FFFFFF",
        surface_alt="#F1F5FB",
        border="#DADCE0",
        ink_primary="#1A202C",
        ink_secondary="#3C4043",
        ink_muted="#5F6368",
        accent="#1E56A0",
        accent_soft="#E8F0FE",
        accent_alt="#1B6B52",
        accent_alt_soft="#E6F4EA",
        warn="#B06000",
        warn_soft="#FEF7E0",
        success="#137333",
        success_soft="#E6F4EA",
    ),
    "emerald_chalkboard": ThemePalette(
        id="emerald_chalkboard",
        name="松烟黑板 · 微格讲堂",
        short_name="松烟黑板",
        subtitle="沉浸式师范微格教学黑板绿与粉笔金对比",
        bg_primary="#0F2922",
        bg_secondary="#15382E",
        surface="#173D32",
        surface_alt="#1E4B3E",
        border="#2E6B59",
        ink_primary="#F8FAFC",
        ink_secondary="#E2E8F0",
        ink_muted="#A7F3D0",
        accent="#34D399",
        accent_soft="#164E3F",
        accent_alt="#FBBF24",
        accent_alt_soft="#3E3219",
        warn="#FBBF24",
        warn_soft="#3E3219",
        success="#6EE7B7",
        success_soft="#164E3F",
    ),
    "rational_blueprint": ThemePalette(
        id="rational_blueprint",
        name="星轨蓝图 · 数理推演",
        short_name="星轨蓝图",
        subtitle="适合数学物理推导的高精网格与工程蓝调",
        bg_primary="#0B132B",
        bg_secondary="#1C2541",
        surface="#141E38",
        surface_alt="#1B2848",
        border="#2B3E6B",
        ink_primary="#F8FAFC",
        ink_secondary="#CBD5E1",
        ink_muted="#94A3B8",
        accent="#38BDF8",
        accent_soft="#16304F",
        accent_alt="#818CF8",
        accent_alt_soft="#262A56",
        warn="#F59E0B",
        warn_soft="#3A2910",
        success="#34D399",
        success_soft="#13382E",
    ),
    "warm_academy": ThemePalette(
        id="warm_academy",
        name="缃帙朱墨 · 书院讲义",
        short_name="缃帙朱墨",
        subtitle="温润仿古缃帙底色与赭石黛青典雅讲席风格",
        bg_primary="#FAF6F0",
        bg_secondary="#F1E8DA",
        surface="#FFFDF9",
        surface_alt="#F6EFE5",
        border="#E4D7C5",
        ink_primary="#2C221E",
        ink_secondary="#4E3F37",
        ink_muted="#7D6A5E",
        accent="#9A3412",
        accent_soft="#FDECE4",
        accent_alt="#1B4D3E",
        accent_alt_soft="#E6EFEA",
        warn="#B45309",
        warn_soft="#FEF3C7",
        success="#15803D",
        success_soft="#DCFCE7",
    ),
}

_THEME_ALIASES = {
    "apple_daylight": "porcelain_daylight",
    "google_material": "azure_scholar",
}


def resolve_theme(theme_id: str) -> ThemePalette:
    key = _THEME_ALIASES.get(theme_id, theme_id)
    return THEMES.get(key, THEMES["porcelain_daylight"])


def list_theme_summaries() -> list[dict[str, str]]:
    return [
        {
            "id": t.id,
            "name": t.name,
            "short_name": t.short_name,
            "subtitle": t.subtitle,
            "bg_primary": t.bg_primary,
            "surface": t.surface,
            "border": t.border,
            "accent": t.accent,
            "ink_primary": t.ink_primary,
        }
        for t in THEMES.values()
    ]


def _utf8_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def _run_ppt_master_script(script_name: str, args: list[str], cwd: Path | None = None, timeout: int = 90) -> subprocess.CompletedProcess:
    python_exe = sys.executable
    script_path = PPT_MASTER_SCRIPTS_DIR / script_name
    cmd = [python_exe, str(script_path), *args]
    return subprocess.run(
        cmd,
        cwd=str(cwd or PPT_MASTER_SCRIPTS_DIR.parent),
        env=_utf8_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def xml_escape(text: str) -> str:
    """Escape only XML reserved characters while preserving native UTF-8 symbols like — → •."""
    if text is None:
        return ""
    s = str(text)
    # Convert common HTML named entities if LLM leaked them
    named_map = {
        "&mdash;": "—",
        "&ndash;": "–",
        "&nbsp;": " ",
        "&rarr;": "→",
        "&larr;": "←",
        "&middot;": "·",
        "&bull;": "•",
        "&hellip;": "…",
        "&copy;": "©",
        "&reg;": "®",
        "&times;": "×",
        "&divide;": "÷",
        "&le;": "≤",
        "&ge;": "≥",
        "&ne;": "≠",
        "&approx;": "≈",
        "&plusmn;": "±",
    }
    for ent, ch in named_map.items():
        s = s.replace(ent, ch)
    # Unescape already escaped XML entities temporarily to avoid double-escaping
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    s = html.unescape(s)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _visual_len(ch: str) -> float:
    code = ord(ch)
    if 0x4E00 <= code <= 0x9FFF or 0x3000 <= code <= 0x303F or 0xFF00 <= code <= 0xFFEF:
        return 1.0
    if ch in "mwMW@%":
        return 0.78
    if ch in "il1.,:;!'|()[] ":
        return 0.38
    return 0.56


_KINSOKU_NO_START = frozenset("。，、；：！？）》】」』％.,;:!?)")


def wrap_text_lines(text: str, max_width_px: float, font_size: int, max_lines: int = 8) -> list[str]:
    """Deterministic CJK+Latin visual-width line wrapper with Kinsoku punctuation protection."""
    raw = str(text or "").strip()
    if not raw:
        return [""]
    capacity = max(4.0, max_width_px / max(font_size, 10))
    lines: list[str] = []
    for paragraph in raw.splitlines():
        p = paragraph.strip()
        if not p:
            continue
        cur: list[str] = []
        acc = 0.0
        for ch in p:
            w = _visual_len(ch)
            # Never wrap closing/sentence-end punctuation onto a brand new line by itself
            if ch in _KINSOKU_NO_START and cur:
                cur.append(ch)
                acc += w
                continue
            if acc + w > capacity and cur:
                lines.append("".join(cur).strip())
                cur = [ch]
                acc = w
                if len(lines) >= max_lines:
                    break
            else:
                cur.append(ch)
                acc += w
        if len(lines) < max_lines and cur:
            lines.append("".join(cur).strip())
        if len(lines) >= max_lines:
            break
    if not lines:
        return [""]
    return lines[:max_lines]


_SVG_MATH_MACROS = [
    (r"\mathbb{R}", "R"),
    (r"\mathbb{N}", "N"),
    (r"\mathbb{Z}", "Z"),
    (r"\mathbb{Q}", "Q"),
    (r"\Rightarrow", "⇒"),
    (r"\implies", "⇒"),
    (r"\Leftrightarrow", "⇔"),
    (r"\iff", "⇔"),
    (r"\notin", "∉"),
    (r"\in", "∈"),
    (r"\cup", "∪"),
    (r"\cap", "∩"),
    (r"\infty", "∞"),
    (r"\Delta", "Δ"),
    (r"\delta", "δ"),
    (r"\alpha", "α"),
    (r"\beta", "β"),
    (r"\gamma", "γ"),
    (r"\theta", "θ"),
    (r"\lambda", "λ"),
    (r"\mu", "μ"),
    (r"\sigma", "σ"),
    (r"\phi", "φ"),
    (r"\pi", "π"),
    (r"\ge", "≥"),
    (r"\geq", "≥"),
    (r"\le", "≤"),
    (r"\leq", "≤"),
    (r"\neq", "≠"),
    (r"\approx", "≈"),
    (r"\equiv", "≡"),
    (r"\pm", "±"),
    (r"\times", "×"),
    (r"\cdot", "·"),
    (r"\div", "÷"),
    (r"\to", "→"),
    (r"\rightarrow", "→"),
    (r"\ln", "ln"),
    (r"\log", "log"),
    (r"\sin", "sin"),
    (r"\cos", "cos"),
    (r"\tan", "tan"),
    (r"\lim", "lim"),
    (r"\left", ""),
    (r"\right", ""),
    (r"\varnothing", "∅"),
]

_SUP_MAP = str.maketrans("0123456789+-n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ")
_SUB_MAP = str.maketrans("0123456789+-nijk", "₀₁₂₃₄₅₆₇₈₉₊₋ₙᵢⱼₖ")


def _clean_math_for_svg(text: str) -> str:
    """Convert raw LaTeX notation inside slide strings into clean Unicode typography."""
    s = str(text or "")
    s = re.sub(r"\$\$(.*?)\$\$", r"\1", s, flags=re.DOTALL)
    s = re.sub(r"\$([^$\n]+?)\$", r"\1", s)
    s = re.sub(r"\\text\s*\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"(\1)/(\2)", s)
    s = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"√(\1)", s)
    for k, v in _SVG_MATH_MACROS:
        s = s.replace(k, v)
    s = re.sub(r"\^\{([0-9+\-n]+)\}", lambda m: m.group(1).translate(_SUP_MAP), s)
    s = re.sub(r"\^([0-9n])", lambda m: m.group(1).translate(_SUP_MAP), s)
    s = re.sub(r"_\{([0-9+\-nijk]+)\}", lambda m: m.group(1).translate(_SUB_MAP), s)
    s = re.sub(r"_([0-9nijk])", lambda m: m.group(1).translate(_SUB_MAP), s)
    return s.replace("{", "").replace("}", "").strip()


def _render_text_block(
    *,
    el_id: str,
    x: int,
    y: int,
    text: str,
    font_size: int,
    fill: str,
    max_width: int,
    line_height: float = 1.42,
    font_weight: str = "normal",
    font_family: str = "Microsoft YaHei",
    text_anchor: str = "start",
    max_lines: int = 6,
) -> str:
    clean_text = _clean_math_for_svg(text)
    lines = wrap_text_lines(clean_text, max_width_px=max_width, font_size=font_size, max_lines=max_lines)
    step = int(round(font_size * line_height))
    style = (
        f"fill:{fill};stroke:none;font-family:{font_family};font-size:{int(font_size)};"
        f"font-weight:{font_weight};text-anchor:{text_anchor}"
    )
    if len(lines) == 1:
        return f'<text id="{el_id}" x="{x}" y="{y}" style="{style}">{xml_escape(lines[0])}</text>'
    tspans = []
    for idx, line in enumerate(lines):
        dy = 0 if idx == 0 else step
        tspans.append(f'<tspan x="{x}" dy="{dy}">{xml_escape(line)}</tspan>')
    return f'<text id="{el_id}" x="{x}" y="{y}" style="{style}">' + "".join(tspans) + "</text>"


def sanitize_ppt_svg(svg_text: str, fallback_bg: str = "#F5F7FA") -> str:
    """Clean and normalize SVG text to satisfy ppt-master svg_quality_checker contract."""
    s = (svg_text or "").strip()
    if not s:
        raise ValueError("Empty SVG content")

    # Strip markdown code fence if wrapped
    m = re.search(r"```(?:svg|xml)?\s*(<svg[\s\S]*?</svg>)\s*```", s, re.IGNORECASE)
    if m:
        s = m.group(1).strip()

    # Replace named HTML entities except standard XML 5
    named_entities = {
        "&mdash;": "—",
        "&ndash;": "–",
        "&nbsp;": " ",
        "&rarr;": "→",
        "&larr;": "←",
        "&middot;": "·",
        "&bull;": "•",
        "&hellip;": "…",
        "&copy;": "©",
        "&reg;": "®",
        "&times;": "×",
        "&divide;": "÷",
        "&le;": "≤",
        "&ge;": "≥",
        "&ne;": "≠",
    }
    for k, v in named_entities.items():
        s = s.replace(k, v)

    # Remove forbidden tags like <style>...</style> or <script>...</script>
    s = re.sub(r"<style\b[^>]*>[\s\S]*?</style>", "", s, flags=re.IGNORECASE)
    s = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", s, flags=re.IGNORECASE)
    s = re.sub(r"<foreignObject\b[^>]*>[\s\S]*?</foreignObject>", "", s, flags=re.IGNORECASE)
    # Remove class="..." attributes
    s = re.sub(r'\s+class="[^"]*"', "", s)

    # Normalize font-size:24px -> font-size:24 inside style="" and attribute font-size="24px"
    s = re.sub(r"(font-size\s*:\s*\d+(?:\.\d+)?)px\b", r"\1", s)
    s = re.sub(r'(font-size="[^"]*?)px"', r'\1"', s)

    # Ensure SVG root has exact viewBox 0 0 1280 720
    s = re.sub(
        r"<svg\b([^>]*)>",
        lambda match: _normalize_svg_root(match.group(1)),
        s,
        count=1,
    )

    # Verify XML parses cleanly; if bare & or < inside text broke XML, escape text segments
    try:
        root = ET.fromstring(s)
    except ET.ParseError:
        s = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)", "&amp;", s)
        root = ET.fromstring(s)

    # Remove text-anchor from tspan styles if any
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        style = elem.attrib.get("style", "")
        if tag == "tspan" and "text-anchor" in style:
            parts = [p for p in style.split(";") if p.strip() and not p.strip().startswith("text-anchor")]
            elem.attrib["style"] = ";".join(parts)
        # Ensure uppercase 6-digit hex colors in style
        if style:
            elem.attrib["style"] = _normalize_hex_in_style(style)

    # Ensure background rect exists as first visible child after defs
    children = list(root)
    has_bg = any(
        c.tag.split("}")[-1] == "rect" and c.attrib.get("width") in ("1280", "100%")
        for c in children[:3]
    )
    if not has_bg:
        bg_rect = ET.Element(
            f"{{{SVG_NS}}}rect",
            {
                "id": "bg_canvas",
                "x": "0",
                "y": "0",
                "width": "1280",
                "height": "720",
                "style": f"fill:{fallback_bg.upper()};stroke:none",
            },
        )
        insert_idx = 1 if children and children[0].tag.split("}")[-1] == "defs" else 0
        root.insert(insert_idx, bg_rect)

    return ET.tostring(root, encoding="unicode", xml_declaration=False)


def _normalize_svg_root(attrs_str: str) -> str:
    if "viewBox" not in attrs_str:
        attrs_str += ' viewBox="0 0 1280 720"'
    if "width=" not in attrs_str:
        attrs_str += ' width="1280"'
    if "height=" not in attrs_str:
        attrs_str += ' height="720"'
    if "xmlns=" not in attrs_str:
        attrs_str += ' xmlns="http://www.w3.org/2000/svg"'
    return f"<svg{attrs_str}>"


def _normalize_hex_in_style(style: str) -> str:
    def _upper_hex(m: re.Match) -> str:
        hx = m.group(1)
        if len(hx) == 3:
            hx = "".join(c * 2 for c in hx)
        return f"#{hx.upper()}"

    return re.sub(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b", _upper_hex, style)


def _render_visual_graph_panel(slide: dict[str, Any], slide_index: int, theme: ThemePalette) -> str:
    """Render a native vector mathematical coordinate graph + derivative curve on the left half (x=64..724)."""
    raw_expr = str(slide.get("plot_expr") or "x**3 - 3*x**2 + 2").strip()
    x_min = float(slide.get("plot_x_min", -1.5))
    x_max = float(slide.get("plot_x_max", 3.3))
    plot = sample_function_plot(raw_expr, x_min=x_min, x_max=x_max, samples=96)
    if not plot.get("ok"):
        plot = sample_function_plot("x**3 - 3*x**2 + 2", x_min=-1.5, x_max=3.3, samples=96)

    x_lo, x_hi = plot["x_domain"]
    y_lo, y_hi = plot["y_domain"]
    if x_hi - x_lo < 0.2:
        x_lo, x_hi = -2.0, 3.0
    if y_hi - y_lo < 0.5:
        y_lo -= 2.0
        y_hi += 2.0

    px0, py0, pw, ph = 116.0, 252.0, 576.0, 326.0

    def to_sx(vx: float) -> float:
        t = max(0.0, min(1.0, (vx - x_lo) / (x_hi - x_lo)))
        return px0 + t * pw

    def to_sy(vy: float) -> float:
        t = max(0.0, min(1.0, (vy - y_lo) / (y_hi - y_lo)))
        return py0 + (1.0 - t) * ph

    parts: list[str] = [
        f'<g id="visual_graph_panel_{slide_index}">',
        f'<rect x="64" y="192" width="660" height="420" rx="16" ry="16" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>',
        _render_text_block(
            el_id=f"txt_s{slide_index}_graph_cap",
            x=90,
            y=224,
            text=f"数形对照：y = {raw_expr.replace('**', '^').replace('*', '')}",
            font_size=15,
            fill=theme.ink_primary,
            max_width=380,
            font_weight="bold",
            max_lines=1,
        ),
        # Legend markers
        f'<line x1="486" y1="219" x2="516" y2="219" style="stroke:{theme.accent};stroke-width:3.5"/>',
        _render_text_block(
            el_id=f"txt_s{slide_index}_leg_f",
            x=522,
            y=224,
            text="原函数 f(x)",
            font_size=12,
            fill=theme.ink_secondary,
            max_width=82,
            max_lines=1,
        ),
        f'<line x1="604" y1="219" x2="634" y2="219" style="stroke:{theme.accent_alt};stroke-width:2;stroke-dasharray:6,4"/>',
        _render_text_block(
            el_id=f"txt_s{slide_index}_leg_df",
            x=640,
            y=224,
            text="导数 f'(x)",
            font_size=12,
            fill=theme.ink_secondary,
            max_width=76,
            max_lines=1,
        ),
    ]

    # Grid lines
    for step_i in range(5):
        gy = py0 + step_i * (ph / 4.0)
        parts.append(
            f'<line x1="{px0:.1f}" y1="{gy:.1f}" x2="{px0+pw:.1f}" y2="{gy:.1f}" '
            f'style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
        )
    for step_j in range(5):
        gx = px0 + step_j * (pw / 4.0)
        parts.append(
            f'<line x1="{gx:.1f}" y1="{py0:.1f}" x2="{gx:.1f}" y2="{py0+ph:.1f}" '
            f'style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
        )

    # Axes (y=0 and x=0) with crisp vector arrow triangles + integer ticks
    ay = to_sy(0.0) if y_lo <= 0.0 <= y_hi else (py0 + ph)
    ax = to_sx(0.0) if x_lo <= 0.0 <= x_hi else px0
    parts.append(f'<line x1="{px0:.1f}" y1="{ay:.1f}" x2="{px0+pw:.1f}" y2="{ay:.1f}" style="stroke:{theme.ink_muted};stroke-width:1.6"/>')
    parts.append(f'<polygon points="{px0+pw+8:.1f},{ay:.1f} {px0+pw-2:.1f},{ay-4.5:.1f} {px0+pw-2:.1f},{ay+4.5:.1f}" style="fill:{theme.ink_muted};stroke:none"/>')
    parts.append(f'<line x1="{ax:.1f}" y1="{py0+ph:.1f}" x2="{ax:.1f}" y2="{py0:.1f}" style="stroke:{theme.ink_muted};stroke-width:1.6"/>')
    parts.append(f'<polygon points="{ax:.1f},{py0-8:.1f} {ax-4.5:.1f},{py0+2:.1f} {ax+4.5:.1f},{py0+2:.1f}" style="fill:{theme.ink_muted};stroke:none"/>')

    # Axis ticks at integer/domain bounds + origin O
    if x_lo <= 0.0 <= x_hi and y_lo <= 0.0 <= y_hi:
        parts.append(
            _render_text_block(
                el_id=f"txt_s{slide_index}_origin",
                x=int(max(px0 + 6, ax - 14)),
                y=int(min(py0 + ph - 4, ay + 16)),
                text="O",
                font_size=12,
                fill=theme.ink_muted,
                max_width=24,
                font_weight="bold",
                max_lines=1,
            )
        )
    parts.append(
        _render_text_block(
            el_id=f"txt_s{slide_index}_ymin",
            x=int(px0 - 8),
            y=int(py0 + ph),
            text=f"{y_lo:g}",
            font_size=11,
            fill=theme.ink_muted,
            max_width=40,
            text_anchor="end",
            max_lines=1,
        )
        + _render_text_block(
            el_id=f"txt_s{slide_index}_ymax",
            x=int(px0 - 8),
            y=int(py0 + 10),
            text=f"{y_hi:g}",
            font_size=11,
            fill=theme.ink_muted,
            max_width=40,
            text_anchor="end",
            max_lines=1,
        )
    )
    parts.append(
        _render_text_block(
            el_id=f"txt_s{slide_index}_xmin",
            x=int(px0),
            y=int(py0 + ph + 20),
            text=f"x={x_lo:g}",
            font_size=12,
            fill=theme.ink_muted,
            max_width=80,
            max_lines=1,
        )
        + _render_text_block(
            el_id=f"txt_s{slide_index}_xmax",
            x=int(px0 + pw),
            y=int(py0 + ph + 20),
            text=f"x={x_hi:g}",
            font_size=12,
            fill=theme.ink_muted,
            max_width=80,
            text_anchor="end",
            max_lines=1,
        )
    )

    # Derivative segments (dashed)
    for seg_i, seg in enumerate(plot.get("df_segments") or []):
        pts_str = " ".join(f"{to_sx(pt[0]):.1f},{to_sy(pt[1]):.1f}" for pt in seg)
        parts.append(
            f'<polyline id="curve_df_{slide_index}_{seg_i}" points="{pts_str}" '
            f'style="fill:none;stroke:{theme.accent_alt};stroke-width:2.2;stroke-dasharray:6,4"/>'
        )

    # Primary function segments (solid thick curve)
    for seg_i, seg in enumerate(plot.get("f_segments") or []):
        pts_str = " ".join(f"{to_sx(pt[0]):.1f},{to_sy(pt[1]):.1f}" for pt in seg)
        parts.append(
            f'<polyline id="curve_f_{slide_index}_{seg_i}" points="{pts_str}" '
            f'style="fill:none;stroke:{theme.accent};stroke-width:3.5"/>'
        )

    # Critical points with direction-aware offset pill so labels never collide with curve strokes
    for cp_i, cp in enumerate((plot.get("critical_points") or [])[:3]):
        cxp = to_sx(float(cp["x"]))
        cyp = to_sy(float(cp["y"]))
        tan_l = max(px0, cxp - 44.0)
        tan_r = min(px0 + pw, cxp + 44.0)
        is_min = cp.get("kind") == "min"
        anchor = "end" if cxp > px0 + pw - 130 else "start"
        lbl_x = int(cxp - 12) if anchor == "end" else int(cxp + 12)
        lbl_y = int(min(py0 + ph - 14, cyp + 24)) if is_min else int(max(py0 + 20, cyp - 18))
        pill_w = 132
        pill_x = int(lbl_x - pill_w + 4) if anchor == "end" else int(lbl_x - 4)
        parts.append(
            f'<line x1="{tan_l:.1f}" y1="{cyp:.1f}" x2="{tan_r:.1f}" y2="{cyp:.1f}" '
            f'style="stroke:{theme.warn};stroke-width:2;stroke-dasharray:4,3"/>'
            f'<line x1="{cxp:.1f}" y1="{cyp:.1f}" x2="{lbl_x:.1f}" y2="{lbl_y-4:.1f}" '
            f'style="stroke:{theme.accent_alt};stroke-opacity:0.5;stroke-width:1"/>'
            f'<rect x="{pill_x}" y="{lbl_y-15}" width="{pill_w}" height="20" rx="5" ry="5" style="fill:{theme.surface};fill-opacity:0.92;stroke:none"/>'
            f'<circle cx="{cxp:.1f}" cy="{cyp:.1f}" r="6" style="fill:{theme.surface};stroke:{theme.accent_alt};stroke-width:3"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_cp_{cp_i+1}",
                x=lbl_x,
                y=lbl_y,
                text=str(cp.get("label", "")),
                font_size=12,
                fill=theme.accent_alt,
                max_width=130,
                font_weight="bold",
                text_anchor=anchor,
                max_lines=1,
            )
        )

    parts.append("</g>")
    return "".join(parts)


def _render_data_chart_panel(slide: dict[str, Any], slide_index: int, theme: ThemePalette) -> str:
    """Render a native vector column chart comparing item mastery or survey metrics (x=64..724)."""
    bars = slide.get("chart_bars") or [
        {"label": "定域优先", "value": 92},
        {"label": "求导运算", "value": 86},
        {"label": "驻点辨析", "value": 76},
        {"label": "含参讨论", "value": 64},
    ]
    bars = [b for b in bars if isinstance(b, dict)][:6] or [{"label": "指标1", "value": 80}]
    max_val = max(100.0, max(float(b.get("value", 0)) for b in bars))

    px0, py0, pw, ph = 116.0, 256.0, 574.0, 304.0
    parts: list[str] = [
        f'<g id="data_chart_panel_{slide_index}">',
        f'<rect x="64" y="192" width="660" height="420" rx="16" ry="16" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>',
        _render_text_block(
            el_id=f"txt_s{slide_index}_chart_head",
            x=90,
            y=226,
            text=str(slide.get("chart_title") or "关键题型掌握率 / 对比柱状分布（%）"),
            font_size=16,
            fill=theme.ink_primary,
            max_width=610,
            font_weight="bold",
            max_lines=1,
        ),
    ]
    for g_idx, pct in enumerate([0, 25, 50, 75, 100]):
        gy = py0 + ph - (pct / 100.0) * ph
        parts.append(
            f'<line x1="{px0:.1f}" y1="{gy:.1f}" x2="{px0+pw:.1f}" y2="{gy:.1f}" '
            f'style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_yaxis_{g_idx}",
                x=int(px0 - 10),
                y=int(gy + 4),
                text=f"{int(round(max_val * pct / 100.0))}",
                font_size=12,
                fill=theme.ink_muted,
                max_width=40,
                text_anchor="end",
                max_lines=1,
            )
        )
    parts.append(f'<line x1="{px0:.1f}" y1="{py0+ph:.1f}" x2="{px0+pw:.1f}" y2="{py0+ph:.1f}" style="stroke:{theme.ink_muted};stroke-width:2"/>')

    slot_w = pw / len(bars)
    bar_w = min(68.0, slot_w * 0.52)
    for idx, bar in enumerate(bars):
        val = max(0.0, float(bar.get("value", 0)))
        bh = max(6.0, (val / max_val) * ph)
        bx = px0 + idx * slot_w + (slot_w - bar_w) / 2.0
        by = py0 + ph - bh
        color = theme.warn if val < 70 else (theme.accent if idx % 2 == 0 else theme.accent_alt)
        parts.append(
            f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" rx="6" ry="6" style="fill:{color};stroke:none"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_bval_{idx+1}",
                x=int(bx + bar_w / 2.0),
                y=int(by - 8),
                text=f"{val:g}%",
                font_size=14,
                fill=theme.ink_primary,
                max_width=int(slot_w),
                font_weight="bold",
                text_anchor="middle",
                max_lines=1,
            )
            + _render_text_block(
                el_id=f"txt_s{slide_index}_blbl_{idx+1}",
                x=int(bx + bar_w / 2.0),
                y=int(py0 + ph + 24),
                text=str(bar.get("label", f"项{idx+1}"))[:10],
                font_size=13,
                fill=theme.ink_secondary,
                max_width=int(slot_w),
                font_weight="bold",
                text_anchor="middle",
                max_lines=1,
            )
        )
    parts.append("</g>")
    return "".join(parts)


def render_structured_slide_svg(slide: dict[str, Any], slide_index: int, total_slides: int, theme: ThemePalette) -> str:
    """Compile a structured instructional slide dict into a strictly conforming ppt-master 1280x720 SVG."""
    layout = str(slide.get("layout", "steps")).strip().lower()
    if layout not in {"cover", "objectives", "compare", "steps", "timeline", "visual_graph", "data_chart", "example", "quiz"}:
        layout = "steps"

    title = str(slide.get("title", f"第 {slide_index} 页")).strip()
    subtitle = str(slide.get("subtitle", "")).strip()
    kicker = str(slide.get("kicker", f"SLIDE {slide_index:02d}")).strip()
    takeaway = str(slide.get("takeaway", "")).strip()
    cards: list[dict[str, Any]] = slide.get("cards") or []

    kicker_short = kicker[:22]
    kicker_w = max(188, min(420, int(sum(_visual_len(c) for c in kicker_short) * 14.5) + 44))

    header_pill = (
        f'<g id="slide_header_{slide_index}">'
        f'<rect x="64" y="40" width="{kicker_w}" height="32" rx="16" ry="16" style="fill:{theme.accent_soft};stroke:{theme.accent};stroke-width:1"/>'
        + _render_text_block(
            el_id=f"txt_s{slide_index}_kicker",
            x=64 + kicker_w // 2,
            y=61,
            text=kicker_short,
            font_size=13,
            fill=theme.accent,
            max_width=kicker_w - 22,
            font_weight="bold",
            text_anchor="middle",
            max_lines=1,
        )
        + _render_text_block(
            el_id=f"txt_s{slide_index}_page_num",
            x=1216,
            y=61,
            text=f"{slide_index:02d} / {total_slides:02d}",
            font_size=14,
            fill=theme.ink_muted,
            max_width=110,
            font_weight="bold",
            text_anchor="end",
            max_lines=1,
        )
        + _render_text_block(
            el_id=f"txt_s{slide_index}_title",
            x=64,
            y=114,
            text=title,
            font_size=34,
            fill=theme.ink_primary,
            font_family="SimSun",
            max_width=1140,
            font_weight="bold",
            max_lines=1,
        )
        + _render_text_block(
            el_id=f"txt_s{slide_index}_subtitle",
            x=64,
            y=150,
            text=subtitle,
            font_size=17,
            fill=theme.ink_muted,
            max_width=1140,
            max_lines=1,
        )
        + f'<line x1="64" y1="170" x2="1216" y2="170" style="stroke:{theme.border};stroke-width:1"/>'
        + "</g>"
    )

    footer_takeaway = ""
    if takeaway and layout != "cover":
        footer_takeaway = (
            f'<g id="takeaway_bar_{slide_index}">'
            f'<rect x="64" y="636" width="1152" height="52" rx="12" ry="12" style="fill:{theme.surface_alt};stroke:{theme.border};stroke-width:1"/>'
            f'<rect x="64" y="636" width="6" height="52" rx="3" ry="3" style="fill:{theme.accent};stroke:none"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_takeaway",
                x=88,
                y=668,
                text=f"核心结论：{takeaway}",
                font_size=16,
                fill=theme.ink_secondary,
                max_width=1100,
                font_weight="bold",
                max_lines=1,
            )
            + "</g>"
        )

    body_parts: list[str] = []

    if layout == "cover":
        badge_1 = str(cards[0].get("heading", "可核验推理")) if len(cards) > 0 else "师范生微格教学"
        badge_2 = str(cards[1].get("heading", "原生可编辑课件")) if len(cards) > 1 else "AI × SymPy 双重核验"
        badge_3 = str(cards[2].get("heading", "分层探究练习")) if len(cards) > 2 else "学情闭环导学"
        body_parts.append(
            f'<g id="hero_decor_{slide_index}">'
            f'<rect x="0" y="0" width="1280" height="720" style="fill:{theme.bg_primary};stroke:none"/>'
            f'<circle cx="1120" cy="140" r="220" style="fill:{theme.accent_soft};fill-opacity:0.75;stroke:none"/>'
            f'<circle cx="1180" cy="540" r="180" style="fill:{theme.accent_alt_soft};fill-opacity:0.7;stroke:none"/>'
            f'<rect x="76" y="76" width="1128" height="568" rx="22" ry="22" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
            f'<rect x="76" y="76" width="16" height="568" rx="8" ry="8" style="fill:{theme.accent};stroke:none"/>'
            f'<line x1="940" y1="220" x2="1156" y2="220" style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
            f'<line x1="940" y1="300" x2="1156" y2="300" style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
            f'<line x1="1048" y1="140" x2="1048" y2="380" style="stroke:{theme.border};stroke-width:1;stroke-dasharray:4,4"/>'
            f'<polyline points="948,348 980,290 1018,224 1052,256 1094,296 1128,236 1152,162" style="fill:none;stroke:{theme.accent};stroke-width:3.5"/>'
            f'<circle cx="1018" cy="224" r="6" style="fill:{theme.surface};stroke:{theme.accent_alt};stroke-width:3"/>'
            f'<circle cx="1094" cy="296" r="6" style="fill:{theme.surface};stroke:{theme.accent_alt};stroke-width:3"/>'
            "</g>"
        )
        hero_kicker = kicker[:24]
        hero_kw = max(236, min(480, int(sum(_visual_len(c) for c in hero_kicker) * 16.0) + 48))
        body_parts.append(
            f'<g id="hero_content_{slide_index}">'
            f'<rect x="136" y="136" width="{hero_kw}" height="38" rx="19" ry="19" style="fill:{theme.accent_soft};stroke:{theme.accent};stroke-width:1"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_kicker",
                x=136 + hero_kw // 2,
                y=161,
                text=hero_kicker,
                font_size=15,
                fill=theme.accent,
                max_width=hero_kw - 24,
                font_weight="bold",
                text_anchor="middle",
                max_lines=1,
            )
            + _render_text_block(
                el_id=f"txt_s{slide_index}_title",
                x=136,
                y=246,
                text=title,
                font_size=46,
                fill=theme.ink_primary,
                font_family="SimSun",
                max_width=770,
                font_weight="bold",
                line_height=1.28,
                max_lines=2,
            )
            + _render_text_block(
                el_id=f"txt_s{slide_index}_subtitle",
                x=136,
                y=384,
                text=subtitle or "面向师范生微格教学与高校深度学习的可核验课件系统",
                font_size=21,
                fill=theme.ink_secondary,
                max_width=780,
                line_height=1.45,
                max_lines=2,
            )
            + f'<line x1="136" y1="472" x2="1144" y2="472" style="stroke:{theme.border};stroke-width:1"/>'
            + "</g>"
        )
        # 3 capability pills at bottom of cover
        for i, btxt in enumerate([badge_1, badge_2, badge_3]):
            bx = 136 + i * 338
            body_parts.append(
                f'<g id="cover_pill_{i+1}">'
                f'<rect x="{bx}" y="512" width="312" height="72" rx="14" ry="14" style="fill:{theme.surface_alt};stroke:{theme.border};stroke-width:1"/>'
                f'<circle cx="{bx+30}" cy="548" r="10" style="fill:{theme.accent if i%2==0 else theme.accent_alt};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_pill_{i+1}",
                    x=bx + 54,
                    y=554,
                    text=btxt,
                    font_size=17,
                    fill=theme.ink_primary,
                    max_width=242,
                    font_weight="bold",
                    max_lines=1,
                )
                + "</g>"
            )
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">'
            + "".join(body_parts)
            + "</svg>"
        )

    # Non-cover layouts share clean background + header + footer
    body_parts.append(
        f'<rect id="bg_canvas" x="0" y="0" width="1280" height="720" style="fill:{theme.bg_primary};stroke:none"/>'
    )
    body_parts.append(header_pill)

    if layout in ("visual_graph", "data_chart"):
        if layout == "visual_graph":
            body_parts.append(_render_visual_graph_panel(slide, slide_index, theme))
        else:
            body_parts.append(_render_data_chart_panel(slide, slide_index, theme))

        right_cards = (cards or [
            {"heading": "直观观察锚点", "body": "观察曲线升降区间与导数在零点两侧的正负变号规律。"},
            {"heading": "核心逻辑闭环", "body": "驻点未必是极值点，需同时检验左右两侧导数符号是否异号。"},
            {"heading": "教学板演贴士", "body": "课堂演示先画导数正负草图，再反推原函数增减轮廓。"},
        ])[:3]
        for idx, card in enumerate(right_cards):
            cy = 192 + idx * 144
            is_warn = idx == 2
            ac = theme.accent_alt if is_warn else theme.accent
            soft = theme.accent_alt_soft if is_warn else theme.accent_soft
            body_parts.append(
                f'<g id="side_insight_{idx+1}">'
                f'<rect x="748" y="{cy}" width="468" height="130" rx="14" ry="14" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
                f'<rect x="748" y="{cy}" width="6" height="130" rx="3" ry="3" style="fill:{ac};stroke:none"/>'
                f'<rect x="772" y="{cy+18}" width="32" height="24" rx="8" ry="8" style="fill:{soft};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_vg{idx+1}_num",
                    x=788,
                    y=cy + 35,
                    text=f"0{idx+1}",
                    font_size=12,
                    fill=ac,
                    max_width=28,
                    font_weight="bold",
                    text_anchor="middle",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_vg{idx+1}_head",
                    x=814,
                    y=cy + 36,
                    text=str(card.get("heading", f"洞察 {idx+1}")),
                    font_size=18,
                    fill=theme.ink_primary,
                    max_width=384,
                    font_weight="bold",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_vg{idx+1}_body",
                    x=772,
                    y=cy + 68,
                    text=str(card.get("body", "")),
                    font_size=15,
                    fill=theme.ink_secondary,
                    max_width=424,
                    line_height=1.42,
                    max_lines=3,
                )
                + "</g>"
            )

    elif layout == "timeline":
        four_cards = (cards + [{"heading": "课堂收束", "body": "回顾核心方法与随堂检验。"}] * 4)[:4]
        body_parts.append(
            f'<g id="timeline_backbone_{slide_index}">'
            f'<line x1="160" y1="262" x2="1120" y2="262" style="stroke:{theme.border};stroke-width:4"/>'
            "</g>"
        )
        for idx, card in enumerate(four_cards):
            cx = 64 + idx * 294
            nx = cx + 135
            ac = theme.accent if idx % 2 == 0 else theme.accent_alt
            soft = theme.accent_soft if idx % 2 == 0 else theme.accent_alt_soft
            dur_txt = str(card.get("tag") or card.get("duration") or f"阶段 {idx+1}")
            body_parts.append(
                f'<g id="timeline_node_{idx+1}">'
                f'<rect x="{nx-48}" y="206" width="96" height="28" rx="14" ry="14" style="fill:{soft};stroke:{ac};stroke-width:1"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_tl{idx+1}_time",
                    x=nx,
                    y=225,
                    text=dur_txt[:10],
                    font_size=13,
                    fill=ac,
                    max_width=86,
                    font_weight="bold",
                    text_anchor="middle",
                    max_lines=1,
                )
                + f'<circle cx="{nx}" cy="262" r="14" style="fill:{theme.surface};stroke:{ac};stroke-width:4"/>'
                + f'<circle cx="{nx}" cy="262" r="5" style="fill:{ac};stroke:none"/>'
                + f'<rect x="{cx}" y="300" width="270" height="312" rx="16" ry="16" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
                + f'<rect x="{cx}" y="300" width="270" height="8" rx="4" ry="4" style="fill:{ac};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_tl{idx+1}_head",
                    x=cx + 22,
                    y=346,
                    text=str(card.get("heading", f"环节 {idx+1}")),
                    font_size=20,
                    fill=theme.ink_primary,
                    max_width=226,
                    font_weight="bold",
                    line_height=1.3,
                    max_lines=2,
                )
                + f'<line x1="{cx+22}" y1="398" x2="{cx+248}" y2="398" style="stroke:{theme.border};stroke-width:1"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_tl{idx+1}_body",
                    x=cx + 22,
                    y=432,
                    text=str(card.get("body", "")),
                    font_size=16,
                    fill=theme.ink_secondary,
                    max_width=226,
                    line_height=1.48,
                    max_lines=6,
                )
                + "</g>"
            )

    elif layout == "compare":
        left = cards[0] if len(cards) > 0 else {"heading": "核心概念 A", "body": "定义与判定条件说明", "tag": "正例特征"}
        right = cards[1] if len(cards) > 1 else {"heading": "核心概念 B / 易错辨析", "body": "对比差异与常见误区警示", "tag": "辨析对照"}
        for idx, (card, is_warn) in enumerate([(left, False), (right, True)]):
            cx = 64 + idx * 592
            accent_c = theme.warn if is_warn else theme.accent
            soft_c = theme.warn_soft if is_warn else theme.accent_soft
            heading = str(card.get("heading", f"维度 {idx+1}"))
            body = str(card.get("body", ""))
            tag = str(card.get("tag", "对比视角"))
            bullets = card.get("bullets") or ([b.strip() for b in body.split("；") if b.strip()] if "；" in body else [body])
            body_parts.append(
                f'<g id="compare_card_{idx+1}">'
                f'<rect x="{cx}" y="196" width="560" height="416" rx="18" ry="18" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
                f'<rect x="{cx}" y="196" width="560" height="10" rx="5" ry="5" style="fill:{accent_c};stroke:none"/>'
                f'<rect x="{cx+28}" y="228" width="120" height="28" rx="14" ry="14" style="fill:{soft_c};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_c{idx+1}_tag",
                    x=cx + 88,
                    y=247,
                    text=tag[:12],
                    font_size=13,
                    fill=accent_c,
                    max_width=108,
                    font_weight="bold",
                    text_anchor="middle",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_c{idx+1}_head",
                    x=cx + 28,
                    y=292,
                    text=heading,
                    font_size=24,
                    fill=theme.ink_primary,
                    max_width=504,
                    font_weight="bold",
                    max_lines=1,
                )
                + f'<line x1="{cx+28}" y1="312" x2="{cx+532}" y2="312" style="stroke:{theme.border};stroke-width:1"/>'
            )
            for bi, btext in enumerate(bullets[:4]):
                by = 352 + bi * 64
                body_parts.append(
                    f'<circle cx="{cx+38}" cy="{by-5}" r="5" style="fill:{accent_c};stroke:none"/>'
                    + _render_text_block(
                        el_id=f"txt_s{slide_index}_c{idx+1}_b{bi+1}",
                        x=cx + 56,
                        y=by,
                        text=str(btext),
                        font_size=18,
                        fill=theme.ink_secondary,
                        max_width=476,
                        line_height=1.35,
                        max_lines=2,
                    )
                )
            body_parts.append("</g>")
        # Center VS medallion
        body_parts.append(
            f'<g id="compare_vs_{slide_index}">'
            f'<circle cx="640" cy="404" r="24" style="fill:{theme.surface};stroke:{theme.accent};stroke-width:2"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_vs",
                x=640,
                y=410,
                text="VS",
                font_size=14,
                fill=theme.accent,
                max_width=40,
                font_weight="bold",
                text_anchor="middle",
                max_lines=1,
            )
            + "</g>"
        )

    elif layout == "example":
        main_card = cards[0] if len(cards) > 0 else {"heading": "典型例题题干", "body": "请在此补充例题条件与求解目标。"}
        step_card = cards[1] if len(cards) > 1 else {"heading": "规范求解步骤", "body": "第 1 步：确定定义域；第 2 步：求导找驻点；第 3 步：列表判单调性与极值。"}
        trap_card = cards[2] if len(cards) > 2 else {"heading": "易错警示与核验", "body": "注意端点与不可导点检验；通过 SymPy 符号计算验证极值点。"}

        body_parts.append(
            f'<g id="example_problem_box">'
            f'<rect x="64" y="192" width="1152" height="128" rx="16" ry="16" style="fill:{theme.accent_soft};stroke:{theme.accent};stroke-width:1.5"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_prob_head",
                x=92,
                y=226,
                text=str(main_card.get("heading", "典型例题")),
                font_size=20,
                fill=theme.accent,
                max_width=1090,
                font_weight="bold",
                max_lines=1,
            )
            + _render_text_block(
                el_id=f"txt_s{slide_index}_prob_body",
                x=92,
                y=260,
                text=str(main_card.get("body", "")),
                font_size=19,
                fill=theme.ink_primary,
                max_width=1090,
                line_height=1.42,
                max_lines=2,
            )
            + "</g>"
        )
        body_parts.append(
            f'<g id="example_solution_box">'
            f'<rect x="64" y="340" width="724" height="274" rx="16" ry="16" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_sol_head",
                x=92,
                y=380,
                text=str(step_card.get("heading", "分步规范推导")),
                font_size=22,
                fill=theme.ink_primary,
                max_width=668,
                font_weight="bold",
                max_lines=1,
            )
            + f'<line x1="92" y1="398" x2="760" y2="398" style="stroke:{theme.border};stroke-width:1"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_sol_body",
                x=92,
                y=432,
                text=str(step_card.get("body", "")),
                font_size=18,
                fill=theme.ink_secondary,
                max_width=668,
                line_height=1.48,
                max_lines=6,
            )
            + "</g>"
        )
        body_parts.append(
            f'<g id="example_trap_box">'
            f'<rect x="812" y="340" width="404" height="274" rx="16" ry="16" style="fill:{theme.warn_soft};stroke:{theme.warn};stroke-width:1.5"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_trap_head",
                x=840,
                y=380,
                text=str(trap_card.get("heading", "易错点 & SymPy 核验")),
                font_size=21,
                fill=theme.warn,
                max_width=348,
                font_weight="bold",
                max_lines=1,
            )
            + f'<line x1="840" y1="398" x2="1188" y2="398" style="stroke:{theme.warn};stroke-opacity:0.35;stroke-width:1"/>'
            + _render_text_block(
                el_id=f"txt_s{slide_index}_trap_body",
                x=840,
                y=434,
                text=str(trap_card.get("body", "")),
                font_size=18,
                fill=theme.ink_primary,
                max_width=348,
                line_height=1.48,
                max_lines=6,
            )
            + "</g>"
        )

    elif layout == "objectives":
        grid_cards = (cards + [{"heading": "课堂巩固", "body": "完成对应练习巩固知识。"}] * 4)[:4]
        for idx, card in enumerate(grid_cards):
            col = idx % 2
            row = idx // 2
            cx = 64 + col * 588
            cy = 194 + row * 212
            is_alt = idx in (1, 2)
            ac = theme.accent_alt if is_alt else theme.accent
            soft = theme.accent_alt_soft if is_alt else theme.accent_soft
            body_parts.append(
                f'<g id="grid_card_{idx+1}">'
                f'<rect x="{cx}" y="{cy}" width="564" height="192" rx="16" ry="16" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
                f'<rect x="{cx}" y="{cy}" width="564" height="6" rx="3" ry="3" style="fill:{ac};stroke:none"/>'
                f'<rect x="{cx+24}" y="{cy+26}" width="44" height="44" rx="12" ry="12" style="fill:{soft};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_g{idx+1}_num",
                    x=cx + 46,
                    y=cy + 55,
                    text=f"0{idx+1}",
                    font_size=19,
                    fill=ac,
                    max_width=40,
                    font_weight="bold",
                    text_anchor="middle",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_g{idx+1}_head",
                    x=cx + 84,
                    y=cy + 55,
                    text=str(card.get("heading", f"要点 {idx+1}")),
                    font_size=22,
                    fill=theme.ink_primary,
                    max_width=456,
                    font_weight="bold",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_g{idx+1}_body",
                    x=cx + 24,
                    y=cy + 100,
                    text=str(card.get("body", "")),
                    font_size=17,
                    fill=theme.ink_secondary,
                    max_width=516,
                    line_height=1.42,
                    max_lines=3,
                )
                + "</g>"
            )

    else:
        # "steps" or "quiz": 3-column architectural flow with vector polygon arrowheads
        three_cards = (cards + [{"heading": "拓展归纳", "body": "迁移到同类综合题型。"}] * 3)[:3]
        for idx, card in enumerate(three_cards):
            cx = 64 + idx * 394
            ac = theme.accent if idx != 1 else theme.accent_alt
            soft = theme.accent_soft if idx != 1 else theme.accent_alt_soft
            step_label = "STEP" if layout == "steps" else "TASK"
            body_parts.append(
                f'<g id="step_card_{idx+1}">'
                f'<rect x="{cx}" y="198" width="364" height="414" rx="18" ry="18" style="fill:{theme.surface};stroke:{theme.border};stroke-width:1.5"/>'
                f'<rect x="{cx+26}" y="226" width="96" height="30" rx="15" ry="15" style="fill:{soft};stroke:none"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_st{idx+1}_badge",
                    x=cx + 74,
                    y=247,
                    text=f"{step_label} 0{idx+1}",
                    font_size=13,
                    fill=ac,
                    max_width=88,
                    font_weight="bold",
                    text_anchor="middle",
                    max_lines=1,
                )
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_st{idx+1}_head",
                    x=cx + 26,
                    y=292,
                    text=str(card.get("heading", f"阶段 {idx+1}")),
                    font_size=24,
                    fill=theme.ink_primary,
                    max_width=312,
                    font_weight="bold",
                    line_height=1.32,
                    max_lines=2,
                )
                + f'<line x1="{cx+26}" y1="348" x2="{cx+338}" y2="348" style="stroke:{theme.border};stroke-width:1"/>'
                + _render_text_block(
                    el_id=f"txt_s{slide_index}_st{idx+1}_body",
                    x=cx + 26,
                    y=386,
                    text=str(card.get("body", "")),
                    font_size=18,
                    fill=theme.ink_secondary,
                    max_width=312,
                    line_height=1.48,
                    max_lines=6,
                )
                + "</g>"
            )
            if idx < 2:
                ax1 = cx + 368
                ax2 = cx + 382
                body_parts.append(
                    f'<g id="arrow_{idx+1}">'
                    f'<line x1="{ax1}" y1="404" x2="{ax2}" y2="404" style="stroke:{theme.accent};stroke-width:3"/>'
                    f'<polygon points="{ax2+10},404 {ax2-1},397 {ax2-1},411" style="fill:{theme.accent};stroke:none"/>'
                    "</g>"
                )

    if footer_takeaway:
        body_parts.append(footer_takeaway)

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">'
        + "".join(body_parts)
        + "</svg>"
    )


def extract_editable_texts(svg_content: str) -> list[dict[str, str]]:
    """Extract editable text items from SVG <text id=...> elements for interactive canvas editing."""
    root = ET.fromstring(svg_content)
    items: list[dict[str, str]] = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag != "text":
            continue
        tid = elem.attrib.get("id", "")
        if not tid:
            continue
        # Join direct text and tspans with newlines
        parts: list[str] = []
        if elem.text and elem.text.strip():
            parts.append(elem.text.strip())
        for child in elem:
            ctag = child.tag.split("}")[-1]
            if ctag == "tspan" and child.text is not None:
                parts.append(child.text.strip())
        full_text = "\n".join([p for p in parts if p])
        style = elem.attrib.get("style", "")
        role = "title" if "title" in tid else ("subtitle" if "subtitle" in tid else ("heading" if "head" in tid else "body"))
        items.append({"id": tid, "role": role, "text": full_text, "style": style})
    return items


def apply_text_edits_to_svg(svg_content: str, edits: dict[str, str], font_scale: float = 1.0) -> str:
    """Apply user inline text edits to specific <text id=...> elements in an SVG and preserve layout wrapping."""
    root = ET.fromstring(svg_content)
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag != "text":
            continue
        tid = elem.attrib.get("id", "")
        if tid not in edits:
            continue
        new_text = _clean_math_for_svg(str(edits[tid]).strip())
        style = elem.attrib.get("style", "")
        # Extract font-size and x coordinate
        fs_match = re.search(r"font-size\s*:\s*(\d+(?:\.\d+)?)", style)
        fs = int(float(fs_match.group(1))) if fs_match else 18
        if abs(font_scale - 1.0) > 0.01:
            fs = max(12, min(64, int(round(fs * font_scale))))
            style = re.sub(r"font-size\s*:\s*\d+(?:\.\d+)?", f"font-size:{fs}", style)
            elem.attrib["style"] = style

        x_val = elem.attrib.get("x", "64")
        # Estimate available width heuristically from role/id
        max_w = (
            1080
            if ("title" in tid or "subtitle" in tid or "takeaway" in tid or "prob_" in tid)
            else (
                640
                if "sol_" in tid
                else (470 if "_c" in tid or "_g" in tid else (410 if "_vg" in tid else (226 if "_tl" in tid else 310)))
            )
        )
        lines = wrap_text_lines(new_text, max_width_px=max_w, font_size=fs, max_lines=6)
        # Clear children and text
        for child in list(elem):
            elem.remove(child)
        if len(lines) <= 1:
            elem.text = lines[0] if lines else ""
        else:
            elem.text = None
            step = int(round(fs * 1.42))
            for idx, ln in enumerate(lines):
                tspan = ET.SubElement(elem, f"{{{SVG_NS}}}tspan", {"x": x_val, "dy": str(0 if idx == 0 else step)})
                tspan.text = ln

    return ET.tostring(root, encoding="unicode", xml_declaration=False)


def _walk_shapes_stats(shapes: Any) -> tuple[int, int]:
    """Recursively count leaf native shapes and non-empty editable text frames (including inside GroupShapes)."""
    shape_count = 0
    text_count = 0
    for sh in shapes:
        if hasattr(sh, "shapes"):
            sub_s, sub_t = _walk_shapes_stats(sh.shapes)
            shape_count += sub_s
            text_count += sub_t
        else:
            shape_count += 1
            if getattr(sh, "has_text_frame", False) and sh.text_frame.text.strip():
                text_count += 1
    return shape_count, text_count


def audit_pptx_native_objects(pptx_path: Path) -> dict[str, Any]:
    """Inspect a compiled .pptx using python-pptx to verify real native DrawingML shapes and editable text."""
    prs = Presentation(str(pptx_path))
    slides_detail = []
    total_shapes = 0
    total_text_frames = 0
    slides_with_notes = 0
    for idx, slide in enumerate(prs.slides, start=1):
        top_groups = len(slide.shapes)
        shape_count, text_count = _walk_shapes_stats(slide.shapes)
        has_notes = bool(slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip())
        total_shapes += shape_count
        total_text_frames += text_count
        if has_notes:
            slides_with_notes += 1
        slides_detail.append(
            {
                "slide": idx,
                "top_level_groups": top_groups,
                "native_shapes": shape_count,
                "editable_text_boxes": text_count,
                "has_speaker_notes": has_notes,
            }
        )
    return {
        "slide_count": len(prs.slides),
        "total_native_shapes": total_shapes,
        "total_editable_text_boxes": total_text_frames,
        "slides_with_notes": slides_with_notes,
        "native_verified": len(prs.slides) > 0 and total_text_frames >= len(prs.slides) * 3,
        "slides": slides_detail,
    }


def compile_ppt_project(
    *,
    deck_id: str,
    title: str,
    slides: list[dict[str, Any]],
    theme_id: str = "porcelain_daylight",
    transition: str = "fade",
    animation: str = "auto",
) -> dict[str, Any]:
    """Create/update a ppt-master workspace, validate SVGs via svg_quality_checker, finalize, and export native PPTX."""
    theme = resolve_theme(theme_id)
    project_dir = PPT_PROJECTS_DIR / deck_id
    if not project_dir.exists():
        # Initialize via official ppt-master project_manager.py --quick-generate
        project_dir.mkdir(parents=True, exist_ok=True)

    svg_output_dir = project_dir / "svg_output"
    notes_dir = project_dir / "notes"
    validation_dir = project_dir / "validation"
    exports_dir = project_dir / "exports"
    for d in (svg_output_dir, notes_dir, validation_dir, exports_dir):
        d.mkdir(parents=True, exist_ok=True)

    # Clear previous slide files when slide count changes
    for old_svg in svg_output_dir.glob("slide_*.svg"):
        old_svg.unlink(missing_ok=True)
    for old_md in notes_dir.glob("slide_*.md"):
        old_md.unlink(missing_ok=True)

    total = len(slides)
    rendered_slides: list[dict[str, Any]] = []
    for idx, slide_data in enumerate(slides, start=1):
        custom_svg = slide_data.get("svg_code")
        if custom_svg and isinstance(custom_svg, str) and "<svg" in custom_svg:
            raw_svg = custom_svg
        else:
            raw_svg = render_structured_slide_svg(slide_data, idx, total, theme)

        clean_svg = sanitize_ppt_svg(raw_svg, fallback_bg=theme.bg_primary)
        svg_filename = f"slide_{idx:02d}.svg"
        (svg_output_dir / svg_filename).write_text(clean_svg, encoding="utf-8")

        note_text = str(slide_data.get("speaker_notes") or f"第 {idx} 页讲解：{slide_data.get('title', '')}。{slide_data.get('takeaway', '')}").strip()
        (notes_dir / f"slide_{idx:02d}.md").write_text(f"# Slide {idx}\n\n{note_text}\n", encoding="utf-8")

        editable_items = extract_editable_texts(clean_svg)
        rendered_slides.append(
            {
                **slide_data,
                "slide_number": idx,
                "svg_filename": svg_filename,
                "svg_code": clean_svg,
                "speaker_notes": note_text,
                "editable_texts": editable_items,
            }
        )

    # 1. Quality Gate: svg_quality_checker.py --stage final --quick-generate --json
    checker_res = _run_ppt_master_script(
        "svg_quality_checker.py",
        [str(project_dir), "--stage", "final", "--quick-generate", "--format", "ppt169", "--json"],
    )
    report_path = validation_dir / "svg_quality_report.json"
    quality_report: dict[str, Any] = {"exit_code": checker_res.returncode, "stdout": checker_res.stdout[:800], "stderr": checker_res.stderr[:800]}
    if report_path.is_file():
        try:
            quality_report["report"] = json.loads(report_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    if checker_res.returncode != 0:
        raise RuntimeError(f"PPT Master SVG quality check failed ({checker_res.returncode}): {checker_res.stdout}\n{checker_res.stderr}")

    # 2. Finalize SVG preview
    fin_res = _run_ppt_master_script("finalize_svg.py", [str(project_dir)])
    if fin_res.returncode != 0:
        raise RuntimeError(f"finalize_svg.py failed: {fin_res.stdout}\n{fin_res.stderr}")

    # 3. Compile native DrawingML PPTX via svg_to_pptx.py
    safe_name = re.sub(r'[\\/:*?"<>|\s]+', "_", title).strip("_")[:48] or deck_id
    export_pptx_path = EXPORTS_DIR / f"{safe_name}_{deck_id}.pptx"
    pptx_res = _run_ppt_master_script(
        "svg_to_pptx.py",
        [
            str(project_dir),
            "--quick-generate",
            "--with-notes",
            "--primary-language",
            "zh-CN",
            "-t",
            transition,
            "-a",
            animation,
            "-o",
            str(export_pptx_path),
        ],
    )
    if pptx_res.returncode != 0 or not export_pptx_path.is_file():
        raise RuntimeError(f"svg_to_pptx.py failed ({pptx_res.returncode}): {pptx_res.stdout}\n{pptx_res.stderr}")

    # 4. Native object audit
    audit = audit_pptx_native_objects(export_pptx_path)

    return {
        "project_dir": str(project_dir),
        "pptx_path": str(export_pptx_path),
        "pptx_filename": export_pptx_path.name,
        "size_bytes": export_pptx_path.stat().st_size,
        "slides": rendered_slides,
        "quality_report": quality_report,
        "pptx_audit": audit,
    }
