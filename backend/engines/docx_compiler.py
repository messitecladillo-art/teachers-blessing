"""High-precision Chinese educational Word (.docx) and iCalendar (.ics) document compiler."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Inches, Pt, RGBColor

from core.config import EXPORTS_DIR
from engines.math_verifier import extract_plottable_expression, sample_function_plot


_LATEX_DOCX_MACROS = [
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
    (r"\sum", "∑"),
    (r"\int", "∫"),
    (r"\prod", "∏"),
    (r"\partial", "∂"),
    (r"\nabla", "∇"),
    (r"\gtrless", "≷"),
    (r"\subseteq", "⊆"),
    (r"\subset", "⊂"),
    (r"\propto", "∝"),
    (r"\circ", "°"),
    (r"\xi", "ξ"),
    (r"\omega", "ω"),
    (r"\rho", "ρ"),
    (r"\varnothing", "∅"),
    (r"\,", " "),
    (r"\;", " "),
    (r"\!", ""),
    (r"\left", ""),
    (r"\right", ""),
]


def _normalize_latex_in_str(text: str) -> str:
    """Clean LaTeX dollar wrappers and macro commands while keeping ^/_ tokens for native Word super/subscript."""
    s = str(text or "")

    def _clean_math_segment(seg: str) -> str:
        t = seg
        t = re.sub(r"\\(?:text|mathrm|mathbf|boldsymbol)\s*\{([^{}]*)\}", r"\1", t)
        for _ in range(3):
            t = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", lambda m: f"{m.group(1)}/{m.group(2)}" if len(m.group(1)) <= 2 and len(m.group(2)) <= 2 else f"({m.group(1)})/({m.group(2)})", t)
            t = re.sub(r"\\sqrt\s*\{([^{}]+)\}", lambda m: f"√{m.group(1)}" if len(m.group(1)) <= 2 else f"√({m.group(1)})", t)
        for k, v in _LATEX_DOCX_MACROS:
            t = t.replace(k, v)
        return t

    s = re.sub(r"\$\$([\s\S]*?)\$\$", lambda m: _clean_math_segment(m.group(1)), s)
    s = re.sub(r"\$([^$\n]+?)\$", lambda m: _clean_math_segment(m.group(1)), s)
    # Also clean stray macros outside $ delimiters
    s = _clean_math_segment(s)
    return s.replace("$", "")


_SCRIPT_TOKEN_RE = re.compile(
    r"(\^\{[^{}]+\}|\^[0-9]+|\^n|\{[^{}]+\}_\{[^{}]+\}|_\{[0-9a-zA-Z+\-]+\}|\b([a-zA-Z])_([0-9ijkmn]+)\b)"
)


def _safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', "_", (name or "").strip()).strip("_")
    return cleaned[:48] or fallback


def _setup_doc_base() -> Document:
    doc = Document()
    for sec in doc.sections:
        sec.top_margin = Cm(2.2)
        sec.bottom_margin = Cm(2.2)
        sec.left_margin = Cm(2.5)
        sec.right_margin = Cm(2.5)
        sec.different_first_page_header_footer = False

        hdr = sec.header.paragraphs[0]
        hdr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r_h = hdr.add_run("教学与学习工作台 ｜ 标准排版文档")
        r_h.font.size = Pt(8.5)
        r_h.font.color.rgb = RGBColor(0x6E, 0x77, 0x81)
        r_h.font.name = "Times New Roman"
        r_pr = r_h._element.get_or_add_rPr()
        rf = OxmlElement("w:rFonts")
        rf.set(qn("w:eastAsia"), "微软雅黑")
        r_pr.insert(0, rf)

        ftr = sec.footer.paragraphs[0]
        ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_f = ftr.add_run("内容与公式排版已核对 ｜ 支持编辑修订")
        r_f.font.size = Pt(8.5)
        r_f.font.color.rgb = RGBColor(0x6E, 0x77, 0x81)
        r_f.font.name = "Times New Roman"
        r_prf = r_f._element.get_or_add_rPr()
        rff = OxmlElement("w:rFonts")
        rff.set(qn("w:eastAsia"), "宋体")
        r_prf.insert(0, rff)

    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(0x14, 0x19, 0x1F)
    r_pr = normal.element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.insert(0, r_fonts)
    r_fonts.set(qn("w:eastAsia"), "宋体")
    return doc


def _add_raw_cn_run(
    p: Any,
    text: str,
    *,
    bold: bool = False,
    size: float = 11,
    color: tuple[int, int, int] = (20, 25, 31),
    cn_font: str = "宋体",
    superscript: bool = False,
    subscript: bool = False,
) -> Any:
    run = p.add_run(str(text))
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"
    run.font.color.rgb = RGBColor(*color)
    if superscript:
        run.font.superscript = True
    if subscript:
        run.font.subscript = True
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.insert(0, r_fonts)
    r_fonts.set(qn("w:eastAsia"), cn_font)
    return run


def _add_cn_run(
    p: Any,
    text: str,
    *,
    bold: bool = False,
    size: float = 11,
    color: tuple[int, int, int] = (20, 25, 31),
    cn_font: str = "宋体",
) -> None:
    """Clean LaTeX expressions and emit native Word superscript/subscript runs with zero raw `$`."""
    cleaned = _normalize_latex_in_str(text)
    pos = 0
    for m in _SCRIPT_TOKEN_RE.finditer(cleaned):
        if m.start() > pos:
            _add_raw_cn_run(p, cleaned[pos : m.start()], bold=bold, size=size, color=color, cn_font=cn_font)
        tok = m.group(0)
        if tok.startswith("^"):
            val = tok[2:-1] if tok.startswith("^{") else tok[1:]
            _add_raw_cn_run(p, val, bold=bold, size=size, color=color, cn_font=cn_font, superscript=True)
        elif m.group(2) is not None and m.group(3) is not None:
            _add_raw_cn_run(p, m.group(2), bold=bold, size=size, color=color, cn_font=cn_font)
            _add_raw_cn_run(p, m.group(3), bold=bold, size=size, color=color, cn_font=cn_font, subscript=True)
        elif tok.startswith("_{"):
            _add_raw_cn_run(p, tok[2:-1], bold=bold, size=size, color=color, cn_font=cn_font, subscript=True)
        pos = m.end()
    if pos < len(cleaned):
        _add_raw_cn_run(p, cleaned[pos:], bold=bold, size=size, color=color, cn_font=cn_font)


def _add_title_banner(doc: Document, title: str, subtitle: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    _add_cn_run(p, title, bold=True, size=18, color=(20, 25, 31), cn_font="黑体")

    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p2.paragraph_format.space_after = Pt(10)
    _add_cn_run(p2, subtitle, bold=False, size=10, color=(110, 119, 129), cn_font="微软雅黑")


def _add_section_heading(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(11)
    p.paragraph_format.space_after = Pt(5)
    _add_cn_run(p, text, bold=True, size=13, color=(27, 77, 62), cn_font="黑体")


def _render_lesson_plot_png(lesson: dict[str, Any], lesson_id: str) -> Path | None:
    """Render a clean Matplotlib mathematical schematic for lessons mentioning a univariate f(x)."""
    probe_text = " ".join(
        [
            str(lesson.get("title", "")),
            str(lesson.get("key_points", "")),
            " ".join(str(ex.get("question", "")) for ex in (lesson.get("exercises") or [])),
            " ".join(str(st.get("teacher_activity", "")) for st in (lesson.get("teaching_steps") or [])),
        ]
    )
    plottable = extract_plottable_expression(probe_text, [])
    if not plottable:
        return None
    expr_str, (x0, x1) = plottable
    plot = sample_function_plot(expr_str, x_min=x0, x_max=x1, samples=160)
    if not plot.get("ok"):
        return None

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
        plt.rcParams["axes.unicode_minus"] = False

        fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=220)
        fig.patch.set_facecolor("#FDFCF9")
        ax.set_facecolor("#FFFFFF")
        ax.axhline(0, color="#94A3B8", linewidth=1.0)
        ax.axvline(0, color="#94A3B8", linewidth=1.0)
        ax.grid(True, linestyle="--", alpha=0.35, color="#CBD5E1")

        for idx, seg in enumerate(plot.get("f_segments") or []):
            xs = [pt[0] for pt in seg]
            ys = [pt[1] for pt in seg]
            ax.plot(xs, ys, color="#1B4D3E", linewidth=2.4, label="原函数 y = f(x)" if idx == 0 else None)

        for idx, seg in enumerate(plot.get("df_segments") or []):
            xs = [pt[0] for pt in seg]
            ys = [pt[1] for pt in seg]
            ax.plot(xs, ys, color="#B43B2A", linewidth=1.6, linestyle="--", label="一阶导 y = f'(x)" if idx == 0 else None)

        for cp in plot.get("critical_points") or []:
            cx, cy = float(cp["x"]), float(cp["y"])
            ax.scatter([cx], [cy], color="#FDFCF9", edgecolor="#B43B2A", linewidth=2.0, s=46, zorder=5)
            ax.annotate(
                cp.get("label", f"({cx}, {cy})"),
                xy=(cx, cy),
                xytext=(6, 8),
                textcoords="offset points",
                fontsize=8.5,
                color="#B43B2A",
                fontweight="bold",
            )

        ax.set_title(f"数形结合直观示意图：f(x) = {expr_str}", fontsize=10.5, color="#14191F", pad=8)
        ax.legend(loc="upper right", frameon=True, facecolor="#FDFCF9", edgecolor="#DFD8CB", fontsize=8.5)
        plt.tight_layout()
        png_path = EXPORTS_DIR / f"lesson_plot_{lesson_id}.png"
        fig.savefig(str(png_path), dpi=220)
        plt.close(fig)
        return png_path
    except Exception:
        return None


def _style_booktabs_table(table: Any) -> None:
    """Apply clean academic three-line (Booktabs) borders to a python-docx table."""
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_pr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        '<w:top w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>'
        '<w:bottom w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>'
        '<w:left w:val="none"/><w:right w:val="none"/>'
        '<w:insideH w:val="none"/><w:insideV w:val="none"/>'
        "</w:tblBorders>"
    )
    tbl_pr.append(borders)

    if len(table.rows) > 0:
        for cell in table.rows[0].cells:
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_borders = parse_xml(
                f'<w:tcBorders {nsdecls("w")}>'
                '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="334155"/>'
                "</w:tcBorders>"
            )
            tc_pr.append(tc_borders)
            shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F1F5F9"/>')
            tc_pr.append(shading)


def _fill_cell(cell: Any, text: str, *, bold: bool = False, size: int = 10, color: tuple[int, int, int] = (30, 41, 59)) -> None:
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(3)
    _add_cn_run(p, text, bold=bold, size=size, color=color, cn_font="微软雅黑" if bold else "宋体")


def compile_lesson_docx(lesson: dict[str, Any], lesson_id: str) -> Path:
    doc = _setup_doc_base()
    title = str(lesson.get("title", "教学设计方案"))
    subject = str(lesson.get("subject", "数学"))
    grade = str(lesson.get("grade_level", "高中"))
    ltype = str(lesson.get("lesson_type", "微格试讲/新授课"))
    duration = str(lesson.get("duration", "45 分钟"))

    _add_title_banner(
        doc,
        title,
        f"学科：{subject}  ｜  学段：{grade}  ｜  课型：{ltype}  ｜  建议时长：{duration}",
    )

    # Meta verification bar
    meta_p = doc.add_paragraph()
    meta_p.paragraph_format.space_after = Pt(8)
    _add_cn_run(
        meta_p,
        f"教学设计文档 ｜ 修订次数：{lesson.get('edit_count', 0)} 次",
        size=9,
        color=(71, 85, 105),
        cn_font="微软雅黑",
    )

    # Section 1: Objectives
    _add_section_heading(doc, "一、教学目标与核心素养")
    for obj in lesson.get("objectives", []):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.5)
        p.paragraph_format.space_after = Pt(3)
        _add_cn_run(p, f"• {obj}", size=11)

    # Section 2: Key points & Learner analysis
    _add_section_heading(doc, "二、学情预判与教学重难点")
    for label, key in [
        ("学情前置分析", "learner_analysis"),
        ("教学重点", "key_points"),
        ("教学难点与突破策略", "difficult_points"),
    ]:
        val = lesson.get(key, "")
        if isinstance(val, list):
            val = "；".join(str(x) for x in val)
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        _add_cn_run(p, f"{label}：", bold=True, size=11, cn_font="黑体")
        _add_cn_run(p, str(val), size=11)

    # Section 3: Timeline Table
    _add_section_heading(doc, "三、结构化教学过程（带时间轴）")
    steps = lesson.get("teaching_steps", [])
    if steps:
        tbl = doc.add_table(rows=len(steps) + 1, cols=4)
        headers = ["教学环节与时长", "教师主导活动", "学生主体探究", "设计意图与核验要点"]
        for c, h in enumerate(headers):
            _fill_cell(tbl.rows[0].cells[c], h, bold=True, size=10, color=(15, 23, 42))
        for r_idx, st in enumerate(steps, start=1):
            phase = f"{st.get('phase', '')}\n({st.get('duration', '')})"
            _fill_cell(tbl.rows[r_idx].cells[0], phase, bold=True, size=9)
            _fill_cell(tbl.rows[r_idx].cells[1], str(st.get("teacher_activity", "")), size=9)
            _fill_cell(tbl.rows[r_idx].cells[2], str(st.get("student_activity", "")), size=9)
            _fill_cell(tbl.rows[r_idx].cells[3], str(st.get("design_intent", "")), size=9)
        _style_booktabs_table(tbl)

    # Section 4: Dual-column Blackboard Design + Optional Math Figure
    _add_section_heading(doc, "四、结构化板书设计与数形对照")
    bb = str(lesson.get("blackboard_design", "") or "")
    if "【副板书】" in bb:
        left_bb, right_bb = bb.split("【副板书】", 1)
        left_bb = left_bb.replace("【主板书】", "").strip()
        right_bb = right_bb.strip()
    else:
        left_bb = bb.replace("【主板书】", "").strip()
        right_bb = str(lesson.get("difficult_points", "") or "重点核验边界与易错反例")
    bb_tbl = doc.add_table(rows=2, cols=2)
    _fill_cell(bb_tbl.rows[0].cells[0], "主板书 · 核心框架与规范推导", bold=True, size=9.5, color=(27, 77, 62))
    _fill_cell(bb_tbl.rows[0].cells[1], "副板书 · 直观模型与反例警示", bold=True, size=9.5, color=(180, 59, 42))
    _fill_cell(bb_tbl.rows[1].cells[0], left_bb, size=9.5)
    _fill_cell(bb_tbl.rows[1].cells[1], right_bb, size=9.5)
    _style_booktabs_table(bb_tbl)

    plot_png = _render_lesson_plot_png(lesson, lesson_id)
    if plot_png and plot_png.is_file():
        p_img = doc.add_paragraph()
        p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img.paragraph_format.space_before = Pt(8)
        p_img.paragraph_format.space_after = Pt(6)
        p_img.add_run().add_picture(str(plot_png), width=Inches(5.6))

    for v_idx, vis in enumerate(lesson.get("inserted_visuals") or [], start=1):
        v_expr = str(vis.get("expr") or "").strip()
        v_title = str(vis.get("title") or f"画板插图 {v_idx}")
        if v_expr:
            vis_png = _render_lesson_plot_png({"title": v_title, "key_points": f"f(x)={v_expr}"}, f"{lesson_id}_v{v_idx}")
            if vis_png and vis_png.is_file():
                p_lbl = doc.add_paragraph()
                p_lbl.alignment = WD_ALIGN_PARAGRAPH.CENTER
                _add_cn_run(p_lbl, f"附图 {v_idx}：{v_title}", bold=True, size=9.5, color=(27, 77, 62))
                p_vimg = doc.add_paragraph()
                p_vimg.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p_vimg.add_run().add_picture(str(vis_png), width=Inches(5.4))

    # Section 5: Layered Practice
    _add_section_heading(doc, "五、配套分层练习与参考解析")
    for idx, ex in enumerate(lesson.get("exercises", []), start=1):
        p_q = doc.add_paragraph()
        p_q.paragraph_format.space_before = Pt(4)
        _add_cn_run(p_q, f"[{ex.get('tier', '基础')}] {idx}. {ex.get('question', '')}", bold=True, size=10)
        p_a = doc.add_paragraph()
        p_a.paragraph_format.left_indent = Cm(0.5)
        _add_cn_run(p_a, f"参考答案与解析：{ex.get('solution', '')}", size=10, color=(51, 65, 85))

    # Section 6: Verification & Sign-off Checklist
    _add_section_heading(doc, "六、准确性复核与师范生试讲自查清单")
    for chk in lesson.get("verification_checklist", []):
        p_c = doc.add_paragraph()
        _add_cn_run(p_c, f"[  ] {chk}", size=10)

    out_path = EXPORTS_DIR / f"教案_{_safe_filename(title, lesson_id)}_{lesson_id}.docx"
    doc.save(str(out_path))
    return out_path


def compile_exam_docx(exam: dict[str, Any], exam_id: str, *, edition: str) -> Path:
    """Compile either 'student' (blank printable test) or 'teacher' (verified answer key & spec matrix) DOCX."""
    doc = _setup_doc_base()
    title = str(exam.get("title", "单元测验试卷"))
    subject = str(exam.get("subject", "数学"))
    grade = str(exam.get("grade_level", "高中"))
    total_score = exam.get("total_score", 100)
    duration = exam.get("duration_minutes", 45)
    is_teacher = edition == "teacher"

    tag = "【教师解析卷】" if is_teacher else "【学生卷】"
    _add_title_banner(
        doc,
        f"{title} {tag}",
        f"学科：{subject}  ｜  学段：{grade}  ｜  满分：{total_score} 分  ｜  建议用时：{duration} 分钟",
    )

    if not is_teacher:
        bind_p = doc.add_paragraph()
        bind_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        bind_p.paragraph_format.space_after = Pt(4)
        _add_cn_run(bind_p, "— — — — 独立作答完成后再核对教师解析卷 — — — —", size=8.5, color=(110, 119, 129), cn_font="微软雅黑")

        info_p = doc.add_paragraph()
        info_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        info_p.paragraph_format.space_after = Pt(6)
        _add_cn_run(info_p, "班级：______________    姓名：______________    学号：______________    得分：________", size=10)

        # Standard Exam Score Box Table
        q_list = exam.get("questions", [])
        stbl = doc.add_table(rows=2, cols=len(q_list) + 2)
        _fill_cell(stbl.rows[0].cells[0], "题号", bold=True, size=9)
        _fill_cell(stbl.rows[1].cells[0], "得分", bold=True, size=9)
        for q_i, qq in enumerate(q_list, start=1):
            _fill_cell(stbl.rows[0].cells[q_i], f"第{q_i}题 ({qq.get('score', 5)}分)", bold=True, size=9)
            _fill_cell(stbl.rows[1].cells[q_i], "", size=9)
        _fill_cell(stbl.rows[0].cells[len(q_list) + 1], f"总分 ({total_score}分)", bold=True, size=9)
        _fill_cell(stbl.rows[1].cells[len(q_list) + 1], "", size=9)
        _style_booktabs_table(stbl)
    else:
        # Blueprint specification table for teachers
        _add_section_heading(doc, "一、试题分布与知识点明细")
        questions = exam.get("questions", [])
        if questions:
            tbl = doc.add_table(rows=len(questions) + 1, cols=5)
            for c, h in enumerate(["题号", "题型", "考查知识点", "预估难度/分值", "答案核对"]):
                _fill_cell(tbl.rows[0].cells[c], h, bold=True, size=9)
            for idx, q in enumerate(questions, start=1):
                _fill_cell(tbl.rows[idx].cells[0], f"第 {idx} 题", size=9)
                _fill_cell(tbl.rows[idx].cells[1], str(q.get("type", "")), size=9)
                _fill_cell(tbl.rows[idx].cells[2], str(q.get("knowledge_point", "")), size=9)
                _fill_cell(tbl.rows[idx].cells[3], f"{q.get('difficulty', '中等')} / {q.get('score', 5)}分", size=9)
                v_badge = (q.get("verification") or {}).get("badge", "人工复核")
                _fill_cell(tbl.rows[idx].cells[4], str(v_badge), size=9)
            _style_booktabs_table(tbl)

    _add_section_heading(doc, "二、试题正文与参考解析" if is_teacher else "试题正文")
    for idx, q in enumerate(exam.get("questions", []), start=1):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(3)
        qtype = q.get("type", "解答题")
        score = q.get("score", 5)
        _add_cn_run(p, f"{idx}. [{qtype} · {score}分] ", bold=True, size=11, color=(27, 77, 62), cn_font="黑体")
        _add_cn_run(p, str(q.get("stem", "")), size=11)

        options = q.get("options") or []
        if options:
            opt_p = doc.add_paragraph()
            opt_p.paragraph_format.left_indent = Cm(0.6)
            opt_p.paragraph_format.space_after = Pt(4)
            _add_cn_run(opt_p, "    ".join(str(o) for o in options), size=10.5)

        parts = q.get("parts") or []
        if parts:
            for p_i, pt in enumerate(parts, start=1):
                part_p = doc.add_paragraph()
                part_p.paragraph_format.left_indent = Cm(0.6)
                part_p.paragraph_format.space_after = Pt(2)
                p_pts = pt.get("points")
                pts_txt = f"（{p_pts}分）" if p_pts else ""
                _add_cn_run(part_p, f"（{p_i}）{pt.get('prompt', '')}{pts_txt}", size=10.5)
                if not is_teacher:
                    for _ in range(2):
                        doc.add_paragraph()

        if is_teacher:
            if parts:
                for p_i, pt in enumerate(parts, start=1):
                    pa = doc.add_paragraph()
                    pa.paragraph_format.left_indent = Cm(0.8)
                    _add_cn_run(pa, f"（{p_i}）答案：", bold=True, size=10, color=(4, 120, 87), cn_font="黑体")
                    _add_cn_run(pa, str(pt.get("answer", "")), size=10, color=(4, 120, 87))
                    pe = doc.add_paragraph()
                    pe.paragraph_format.left_indent = Cm(0.8)
                    _add_cn_run(pe, "解析：", bold=True, size=10, cn_font="黑体")
                    _add_cn_run(pe, str(pt.get("explanation", "")), size=10, color=(51, 65, 85))
            else:
                ans_p = doc.add_paragraph()
                ans_p.paragraph_format.left_indent = Cm(0.5)
                _add_cn_run(ans_p, "【标准答案】", bold=True, size=10, color=(4, 120, 87), cn_font="黑体")
                _add_cn_run(ans_p, str(q.get("answer", "")), size=10, color=(4, 120, 87))

                sol_p = doc.add_paragraph()
                sol_p.paragraph_format.left_indent = Cm(0.5)
                _add_cn_run(sol_p, "【分步解析】", bold=True, size=10, cn_font="黑体")
                _add_cn_run(sol_p, str(q.get("analysis", "")), size=10, color=(51, 65, 85))

            ver_p = doc.add_paragraph()
            ver_p.paragraph_format.left_indent = Cm(0.5)
            ver_p.paragraph_format.space_after = Pt(6)
            v_info = q.get("verification") or {}
            _add_cn_run(
                ver_p,
                f"【核对状态】{v_info.get('badge', '已核对')} ｜ {q.get('intent', '检测核心概念应用')}",
                size=9,
                color=(100, 116, 139),
                cn_font="微软雅黑",
            )
        else:
            # Leave clean answer space for students when not already left per part
            if not parts and ("解答" in str(qtype) or "计算" in str(qtype) or "证明" in str(qtype)):
                for _ in range(4):
                    doc.add_paragraph()

    prefix = "教师解析卷" if is_teacher else "学生原卷"
    out_path = EXPORTS_DIR / f"{prefix}_{_safe_filename(title, exam_id)}_{exam_id}.docx"
    doc.save(str(out_path))
    return out_path


def compile_analytics_docx(report: dict[str, Any], report_id: str) -> Path:
    doc = _setup_doc_base()
    title = str(report.get("title", "教学学情诊断分析报告"))
    stats = report.get("stats") or {}
    summary = stats.get("summary") or {}
    narrative = report.get("ai_narrative") or {}
    desens = report.get("desensitize_summary") or {}

    _add_title_banner(
        doc,
        title,
        f"有效脱敏样本：N={stats.get('student_count', 0)} ｜ 隐私脱敏盾：已遮蔽 {desens.get('redacted_fields_count', 0)} 项敏感字段",
    )

    _add_section_heading(doc, "一、数据脱敏与统计口径声明")
    p_priv = doc.add_paragraph()
    _add_cn_run(
        p_priv,
        f"本报告已在本地完成姓名/学号/手机脱敏（已移除列：{', '.join(desens.get('dropped_columns') or ['无'])}；"
        f"已代号替换列：{', '.join(desens.get('masked_columns') or ['无'])}），"
        "全部统计与区分度指标均经确定性计算并支持教师复核。",
        size=10,
        color=(51, 65, 85),
    )

    _add_section_heading(doc, "二、总体成绩分布与核心指标（三线表）")
    tbl = doc.add_table(rows=2, cols=8)
    headers = ["样本量 N", "平均分", "中位数", "标准差", "最高分", "最低分", "及格率", "优秀率"]
    vals = [
        str(stats.get("student_count", 0)),
        str(summary.get("mean", "-")),
        str(summary.get("median", "-")),
        str(summary.get("std", "-")),
        str(summary.get("max", "-")),
        str(summary.get("min", "-")),
        f"{summary.get('pass_rate', 0)}%",
        f"{summary.get('excellent_rate', 0)}%",
    ]
    for c, h in enumerate(headers):
        _fill_cell(tbl.rows[0].cells[c], h, bold=True, size=9)
        _fill_cell(tbl.rows[1].cells[c], vals[c], size=9)
    _style_booktabs_table(tbl)

    chart_path = Path(str(stats.get("chart_path", "")))
    if chart_path.is_file():
        p_img = doc.add_paragraph()
        p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img.paragraph_format.space_before = Pt(8)
        p_img.paragraph_format.space_after = Pt(8)
        p_img.add_run().add_picture(str(chart_path), width=Inches(6.0))

    _add_section_heading(doc, "三、各题与知识点掌握度诊断")
    items = stats.get("item_metrics") or []
    if items:
        itbl = doc.add_table(rows=len(items) + 1, cols=5)
        for c, h in enumerate(["题目/知识点", "满分", "平均得分", "掌握率", "区分度 / 状态"]):
            _fill_cell(itbl.rows[0].cells[c], h, bold=True, size=9)
        for idx, it in enumerate(items, start=1):
            _fill_cell(itbl.rows[idx].cells[0], str(it.get("item", "")), size=9)
            _fill_cell(itbl.rows[idx].cells[1], str(it.get("full_score", "")), size=9)
            _fill_cell(itbl.rows[idx].cells[2], str(it.get("mean_score", "")), size=9)
            _fill_cell(itbl.rows[idx].cells[3], f"{it.get('mastery_pct', 0)}%", size=9)
            _fill_cell(itbl.rows[idx].cells[4], f"D={it.get('discrimination', 0)} ({it.get('status', '')})", size=9)
        _style_booktabs_table(itbl)

    _add_section_heading(doc, "四、教学诊断归因与靶向干预建议")
    for k, label in [
        ("overall_diagnosis", "整体学情判断"),
        ("weakness_attribution", "薄弱环节归因"),
        ("teaching_interventions", "下一步分层教学策略"),
    ]:
        val = narrative.get(k, "")
        if isinstance(val, list):
            val = "\n".join(f"• {x}" for x in val)
        p_n = doc.add_paragraph()
        p_n.paragraph_format.space_after = Pt(5)
        _add_cn_run(p_n, f"{label}：", bold=True, size=10.5, cn_font="黑体")
        _add_cn_run(p_n, str(val), size=10.5)

    cohorts = stats.get("cohorts") or {}
    p_co = doc.add_paragraph()
    _add_cn_run(p_co, "重点跟进脱敏代号名单（低于及格线）：", bold=True, size=10, cn_font="黑体")
    _add_cn_run(p_co, ", ".join(cohorts.get("attention_aliases") or ["暂无"]), size=10)

    _add_section_heading(doc, "五、教师人工复核确认栏")
    p_rev = doc.add_paragraph()
    status_txt = "已人工复核确认" if report.get("teacher_reviewed") else "待教师复核确认"
    _add_cn_run(p_rev, f"复核状态：{status_txt}\n教师批注：{report.get('teacher_note') or '（暂无附加批注）'}", size=10)

    out_path = EXPORTS_DIR / f"学情分析报告_{_safe_filename(title, report_id)}_{report_id}.docx"
    doc.save(str(out_path))
    return out_path


def compile_study_plan_ics_and_docx(plan_id: str, title: str, goal: str, days: list[dict[str, Any]]) -> tuple[Path, Path]:
    """Export both an executable .ics calendar file and a printable .docx check-in sheet."""
    # 1. ICS file
    start_date = datetime.now().date() + timedelta(days=1)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//EduForge Studio//StudyPlan//ZH",
        "CALSCALE:GREGORIAN",
    ]
    for idx, d in enumerate(days):
        day_date = start_date + timedelta(days=idx)
        dt_start = f"{day_date.strftime('%Y%m%d')}T190000"
        dt_end = f"{day_date.strftime('%Y%m%d')}T200000"
        summary = f"【EduForge复习】{d.get('focus', f'Day {idx+1}')}"
        desc = f"任务：{d.get('task', '')} | 自测标准：{d.get('checkpoint', '')}".replace("\n", "\\n")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{plan_id}-day{idx+1}@eduforge.local",
                f"DTSTART:{dt_start}",
                f"DTEND:{dt_end}",
                f"SUMMARY:{summary}",
                f"DESCRIPTION:{desc}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    ics_path = EXPORTS_DIR / f"7日复习计划_{_safe_filename(title, plan_id)}_{plan_id}.ics"
    ics_path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")

    # 2. DOCX sheet
    doc = _setup_doc_base()
    _add_title_banner(doc, f"个性化 7 日可执行复习打卡表：{title}", f"学习目标：{goal}")
    _add_section_heading(doc, "一、复习节奏与艾宾浩斯遗忘曲线说明")
    p_intro = doc.add_paragraph()
    _add_cn_run(p_intro, "本计划依据当前错题本薄弱专题自动编排，建议配合同步导出的 .ics 日历文件设置每日晚间 19:00 固定复习提醒。", size=10)
    _add_section_heading(doc, "二、每日可执行微任务与自查验收表（三线表）")
    if days:
        tbl = doc.add_table(rows=len(days) + 1, cols=5)
        for c, h in enumerate(["日程", "核心主题", "可执行微任务", "预计耗时", "验收标准 / 打卡"]):
            _fill_cell(tbl.rows[0].cells[c], h, bold=True, size=9.5)
        for idx, d in enumerate(days, start=1):
            _fill_cell(tbl.rows[idx].cells[0], str(d.get("day", f"第 {idx} 天")), bold=True, size=9.5)
            _fill_cell(tbl.rows[idx].cells[1], str(d.get("focus", "")), size=9.5)
            _fill_cell(tbl.rows[idx].cells[2], str(d.get("task", "")), size=9.5)
            _fill_cell(tbl.rows[idx].cells[3], f"{d.get('minutes', 45)} 分钟", size=9.5)
            _fill_cell(tbl.rows[idx].cells[4], f"[ ] {d.get('checkpoint', '')}", size=9.5)
        _style_booktabs_table(tbl)
    p_tail = doc.add_paragraph()
    p_tail.paragraph_format.space_before = Pt(8)
    _add_cn_run(p_tail, "每日完成验收标准后请在右侧 [ ] 勾选，遇到概念疑问可随时回到题目答疑页核对推导过程。", size=9.5, color=(110, 119, 129))
    docx_path = EXPORTS_DIR / f"7日复习打卡表_{_safe_filename(title, plan_id)}_{plan_id}.docx"
    doc.save(str(docx_path))
    return ics_path, docx_path
