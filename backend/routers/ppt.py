"""Native PPTX Studio API powered by hugohe3/ppt-master."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm_json, extract_json_payload, stream_llm
from core.sse import sse_event
from engines.ppt_bridge import (
    apply_text_edits_to_svg,
    compile_ppt_project,
    list_theme_summaries,
    resolve_theme,
)
from engines.pedagogy_kb import format_pedagogy_rag_context, retrieve_pedagogy_insights
from engines.memory_engine import update_teacher_preferences
from engines.self_repair import sanitize_and_repair_slides
from engines.tts_narrator import AVAILABLE_VOICES, synthesize_deck_narration

router = APIRouter(prefix="/api/ppt", tags=["ppt"])

_PPT_SYSTEM_PROMPT = """你是集成于 PPT Master 原生课件引擎的「教研演示设计师（Strategist）」。
请把用户提供的课题、教案内容或参考资料，转化为一份结构严谨、数形结合、可直接编译为 PowerPoint 原生可编辑形状的 6 到 8 页课件规划。

每页必须在以下 9 种专业教学版式中择优选择（第 1 页必须为 cover，数学/物理含函数规律课题必须包含至少 1 页 visual_graph，学情诊断类课题需包含 data_chart）：
1. "cover": 封面页。cards 放 3 个简短亮点胶囊 [{"heading":"亮点1"},{"heading":"亮点2"},{"heading":"亮点3"}]。
2. "objectives": 四象限卡片页（2×2）。cards 放 4 个卡片 [{"heading":"要点标题(<=12字)","body":"精炼说明(<=48字)"}]。
3. "visual_graph": 数形结合函数与导数坐标页（左侧自动绘制 SymPy 原生曲线与极值切线，右侧 3 条洞察栏）。需额外提供合法 Python 数学表达式字段 `"plot_expr": "x**3 - 3*x**2 + 2"`, `"plot_x_min": -1.5, "plot_x_max": 3.3`，cards 放 3 条右侧洞察 [{"heading":"直观模型","body":"<=45字"}, ...]。
4. "compare": 双栏对比辨析页（概念正反例/易错辨析）。cards 放 2 个对比栏 [{"heading":"左侧标题","tag":"正例标签","bullets":["要点1","要点2","要点3"]},{"heading":"右侧标题","tag":"易错警示","bullets":["要点1","要点2","要点3"]}]。
5. "steps": 三步推导流程页（带矢量箭头）。cards 放 3 个递进步骤 [{"heading":"步骤名","body":"具体推导或方法说明(<=65字)"}]。
6. "timeline": 四阶段微格时间轴页。cards 放 4 个教学阶段 [{"tag":"0-2 min","heading":"阶段标题","body":"活动描述(<=55字)"}]。
7. "data_chart": 原生矢量统计柱图与归因洞察页。需提供 `"chart_title": "..."`, `"chart_bars": [{"label":"维度1","value":91}, ...]`，cards 放 3 条右侧归因建议 [{"heading":"...","body":"..."}]。
8. "example": 典例精讲与核验页。cards 固定放 3 块：[{"heading":"典型例题","body":"完整题干"},{"heading":"规范分步推导","body":"第1步...\\n第2步...\\n第3步..."},{"heading":"易错点 & 核验结论","body":"警示与验算结果"}]。
9. "quiz": 课堂随堂微测与总结页（3列任务卡）。cards 放 3 个任务 [{"heading":"基础题/进阶题/课后任务","body":"题目与提示(<=65字)"}]。

排版铁律（避免文本溢出与裸源码）：
- 禁止使用 `$...$` 符号及 `\\frac`/`\\ln` 等反斜杠源码，请直接用标准 Unicode 数学符号（如 `f'(x) ≥ 0`、`x³`、`ln x`、`Δ ≤ 0`）。
- title 控制在 18 字以内；subtitle 控制在 34 字以内；takeaway 控制在 38 字以内。
- speaker_notes 写 60~140 字流畅自然的师范生试讲口语化逐字稿（可直接用于 TTS 教师示范配音）。

必须严格输出合法 JSON：
{
  "title": "课件总标题",
  "subject": "学科",
  "grade_level": "学段",
  "slides": [
    {
      "layout": "cover",
      "kicker": "高二数学 · 微格示范课",
      "title": "...",
      "subtitle": "...",
      "cards": [...],
      "takeaway": "...",
      "speaker_notes": "..."
    }
  ]
}"""


class PptGenerateReq(BaseModel):
    title: str
    subject: str = "高中数学"
    grade_level: str = "高二年级"
    domain: str = ""
    branch: str = ""
    theme_id: str = "porcelain_daylight"
    slide_count: int = 6
    source_material: str = ""
    transition: str = "fade"


class SlideEditReq(BaseModel):
    edits: dict[str, str]
    speaker_notes: str | None = None
    font_scale: float = 1.0


class SlideRegenReq(BaseModel):
    instruction: str


class ThemeSwitchReq(BaseModel):
    theme_id: str


class NarrateReq(BaseModel):
    voice: str = "zh-CN-XiaoxiaoNeural"


def _row_to_deck(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["slides"] = json.loads(d.pop("slides_json") or "[]")
    d["quality_report"] = json.loads(d.pop("quality_report_json") or "{}")
    d["pptx_audit"] = json.loads(d.pop("pptx_audit_json") or "{}")
    return d


@router.get("/themes")
async def get_themes() -> dict[str, Any]:
    return {"ok": True, "themes": list_theme_summaries(), "voices": AVAILABLE_VOICES}


@router.get("/decks")
async def list_decks() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ppt_decks ORDER BY updated_at DESC").fetchall()
    return {"ok": True, "decks": [_row_to_deck(r) for r in rows]}


@router.get("/decks/{deck_id}")
async def get_deck(deck_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (deck_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课件不存在")
    return {"ok": True, "deck": _row_to_deck(row)}


@router.post("/generate")
async def generate_ppt_stream(req: PptGenerateReq) -> StreamingResponse:
    async def event_gen():
        t0 = time.time()
        yield sse_event("stage", {"stage": "strategist", "message": "正在规划课件大纲与版式…"})

        pedagogy_matches = retrieve_pedagogy_insights(
            req.title,
            subject=req.subject,
            domain_id=req.domain,
            branch=req.branch,
            limit=2,
        )
        rag_block = format_pedagogy_rag_context(pedagogy_matches)

        domain_line = f"细分分支：{req.domain} · {req.branch}\n" if (req.domain or req.branch) else ""
        user_prompt = (
            f"课题：{req.title}\n"
            f"学科：{req.subject}\n"
            f"{domain_line}"
            f"学段：{req.grade_level}\n"
            f"建议页数：{max(4, min(10, req.slide_count))} 页（包含 cover、objectives、compare、steps、example、quiz 等多样版式）\n"
        )
        if rag_block:
            user_prompt += f"\n{rag_block}\n"
        if req.source_material.strip():
            user_prompt += f"\n教案/参考资料：\n{req.source_material[:6000]}\n"

        full_text = ""
        try:
            async for chunk in stream_llm(system_prompt=_PPT_SYSTEM_PROMPT, user_prompt=user_prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            yield sse_event("stage", {"stage": "compiling", "message": "正在自动检查排版并生成课件文件…"})
            parsed = extract_json_payload(full_text)
            raw_slides = parsed.get("slides") or []
            if not raw_slides:
                raise ValueError("模型未能输出有效 slides 列表")
            slides, _ = sanitize_and_repair_slides(raw_slides)
            update_teacher_preferences(
                {
                    "preferred_subject": req.subject,
                    "preferred_grade": req.grade_level,
                    "preferred_slide_count": str(len(slides)),
                    "preferred_theme": resolve_theme(req.theme_id).id,
                }
            )

            deck_id = new_id("deck")
            deck_title = str(parsed.get("title") or req.title)
            eff_theme_id = resolve_theme(req.theme_id).id
            compiled = compile_ppt_project(
                deck_id=deck_id,
                title=deck_title,
                slides=slides,
                theme_id=eff_theme_id,
                transition=req.transition,
            )

            art = upsert_artifact(
                None,
                title=f"课件PPT：{deck_title}",
                category="pptx",
                module="ppt",
                filename=compiled["pptx_filename"],
                file_path=compiled["pptx_path"],
                mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes=compiled["size_bytes"],
                verified_status="verified" if compiled["pptx_audit"].get("native_verified") else "needs_review",
                meta={"deck_id": deck_id, "audit": compiled["pptx_audit"]},
            )

            now = time.time()
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO ppt_decks (id, title, subject, grade_level, theme_id, project_dir, slides_json, quality_report_json, pptx_audit_json, pptx_artifact_id, edit_count, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (
                        deck_id,
                        deck_title,
                        req.subject,
                        req.grade_level,
                        eff_theme_id,
                        compiled["project_dir"],
                        json.dumps(compiled["slides"], ensure_ascii=False),
                        json.dumps(compiled["quality_report"], ensure_ascii=False),
                        json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                        art["id"],
                        now,
                        now,
                    ),
                )

            duration_ms = int((time.time() - t0) * 1000)
            log_telemetry("ppt", "generate_pptx", duration_ms=duration_ms, verified_ok=True)
            yield sse_event(
                "result",
                {
                    "deck": {
                        "id": deck_id,
                        "title": deck_title,
                        "subject": req.subject,
                        "grade_level": req.grade_level,
                        "theme_id": eff_theme_id,
                        "slides": compiled["slides"],
                        "quality_report": compiled["quality_report"],
                        "pptx_audit": compiled["pptx_audit"],
                        "pptx_artifact_id": art["id"],
                        "edit_count": 0,
                    },
                    "artifact": art,
                    "pedagogy_refs": pedagogy_matches,
                    "duration_ms": duration_ms,
                },
            )
        except Exception as exc:
            log_telemetry("ppt", "generate_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"原生课件生成失败：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/decks/{deck_id}/theme")
async def switch_deck_theme(deck_id: str, req: ThemeSwitchReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课件不存在")
        deck = _row_to_deck(row)

    # Clear raw svg_code so structured slides re-render cleanly in the new theme
    clean_slides = []
    for sl in deck["slides"]:
        copy_sl = {k: v for k, v in sl.items() if k != "svg_code"}
        clean_slides.append(copy_sl)

    eff_theme_id = resolve_theme(req.theme_id).id
    compiled = compile_ppt_project(
        deck_id=deck_id,
        title=deck["title"],
        slides=clean_slides,
        theme_id=eff_theme_id,
    )
    edit_count = int(deck.get("edit_count", 0)) + 1
    art = upsert_artifact(
        deck.get("pptx_artifact_id") or None,
        title=f"课件PPT：{deck['title']}",
        category="pptx",
        module="ppt",
        filename=compiled["pptx_filename"],
        file_path=compiled["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=compiled["size_bytes"],
        verified_status="verified",
        revision_count=edit_count,
        meta={"deck_id": deck_id, "audit": compiled["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE ppt_decks SET theme_id = ?, slides_json = ?, quality_report_json = ?, pptx_audit_json = ?, pptx_artifact_id = ?, edit_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                eff_theme_id,
                json.dumps(compiled["slides"], ensure_ascii=False),
                json.dumps(compiled["quality_report"], ensure_ascii=False),
                json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                art["id"],
                edit_count,
                time.time(),
                deck_id,
            ),
        )
    log_telemetry("ppt", "switch_theme", verified_ok=True, human_edited=True)
    return {"ok": True, "theme_id": eff_theme_id, "slides": compiled["slides"], "pptx_audit": compiled["pptx_audit"], "artifact": art}


def _sync_structured_fields_from_edits(slide: dict[str, Any], edits: dict[str, str]) -> None:
    """Keep structured slide metadata in sync with inline SVG text edits so theme switches preserve user edits."""
    cards: list[dict[str, Any]] = list(slide.get("cards") or [])
    for tid, raw_val in edits.items():
        val = str(raw_val).strip()
        if tid.endswith("_title"):
            slide["title"] = val
        elif tid.endswith("_subtitle"):
            slide["subtitle"] = val
        elif tid.endswith("_kicker"):
            slide["kicker"] = val
        elif tid.endswith("_takeaway"):
            slide["takeaway"] = val.removeprefix("核心结论：").strip()
        elif "_pill_" in tid:
            idx = int(tid.rsplit("_", 1)[-1]) - 1
            while len(cards) <= idx:
                cards.append({})
            cards[idx]["heading"] = val
        elif "_g" in tid and (tid.endswith("_head") or tid.endswith("_body")):
            part = tid.split("_g", 1)[1]
            idx = int(part.split("_", 1)[0]) - 1
            while len(cards) <= idx:
                cards.append({})
            if tid.endswith("_head"):
                cards[idx]["heading"] = val
            else:
                cards[idx]["body"] = val
        elif "_st" in tid and (tid.endswith("_head") or tid.endswith("_body")):
            part = tid.split("_st", 1)[1]
            idx = int(part.split("_", 1)[0]) - 1
            while len(cards) <= idx:
                cards.append({})
            if tid.endswith("_head"):
                cards[idx]["heading"] = val
            else:
                cards[idx]["body"] = val
        elif "_c" in tid:
            part = tid.split("_c", 1)[1]
            idx = int(part.split("_", 1)[0]) - 1
            while len(cards) <= idx:
                cards.append({})
            if tid.endswith("_head"):
                cards[idx]["heading"] = val
            elif tid.endswith("_tag"):
                cards[idx]["tag"] = val
            elif "_b" in tid:
                b_idx = int(tid.rsplit("_b", 1)[-1]) - 1
                bullets = list(cards[idx].get("bullets") or [])
                while len(bullets) <= b_idx:
                    bullets.append("")
                bullets[b_idx] = val
                cards[idx]["bullets"] = bullets
        elif "_prob_" in tid or "_sol_" in tid or "_trap_" in tid:
            idx = 0 if "_prob_" in tid else (1 if "_sol_" in tid else 2)
            while len(cards) <= idx:
                cards.append({})
            if tid.endswith("_head"):
                cards[idx]["heading"] = val
            else:
                cards[idx]["body"] = val
    if cards:
        slide["cards"] = cards


@router.put("/decks/{deck_id}/slides/{slide_number}")
async def edit_slide_inline(deck_id: str, slide_number: int, req: SlideEditReq) -> dict[str, Any]:
    """Apply live canvas inline text edits to SVG and recompile native .pptx via ppt-master."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课件不存在")
        deck = _row_to_deck(row)

    slides = deck["slides"]
    idx = slide_number - 1
    if idx < 0 or idx >= len(slides):
        raise HTTPException(status_code=400, detail="幻灯片页码越界")

    target_slide = slides[idx]
    _sync_structured_fields_from_edits(target_slide, req.edits)
    updated_svg = apply_text_edits_to_svg(target_slide["svg_code"], req.edits, font_scale=req.font_scale)
    target_slide["svg_code"] = updated_svg
    if req.speaker_notes is not None:
        target_slide["speaker_notes"] = req.speaker_notes

    compiled = compile_ppt_project(
        deck_id=deck_id,
        title=deck["title"],
        slides=slides,
        theme_id=deck["theme_id"],
    )
    edit_count = int(deck.get("edit_count", 0)) + 1
    art = upsert_artifact(
        deck.get("pptx_artifact_id") or None,
        title=f"课件PPT：{deck['title']}",
        category="pptx",
        module="ppt",
        filename=compiled["pptx_filename"],
        file_path=compiled["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=compiled["size_bytes"],
        verified_status="verified",
        revision_count=edit_count,
        meta={"deck_id": deck_id, "audit": compiled["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE ppt_decks SET slides_json = ?, quality_report_json = ?, pptx_audit_json = ?, pptx_artifact_id = ?, edit_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(compiled["slides"], ensure_ascii=False),
                json.dumps(compiled["quality_report"], ensure_ascii=False),
                json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                art["id"],
                edit_count,
                time.time(),
                deck_id,
            ),
        )
    log_telemetry("ppt", "inline_canvas_edit", verified_ok=True, human_edited=True)
    return {
        "ok": True,
        "slides": compiled["slides"],
        "pptx_audit": compiled["pptx_audit"],
        "artifact": art,
        "edit_count": edit_count,
    }


@router.post("/decks/{deck_id}/slides/{slide_number}/regenerate")
async def regenerate_single_slide(deck_id: str, slide_number: int, req: SlideRegenReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课件不存在")
        deck = _row_to_deck(row)

    slides = deck["slides"]
    idx = slide_number - 1
    if idx < 0 or idx >= len(slides):
        raise HTTPException(status_code=400, detail="幻灯片页码越界")

    cur = {k: v for k, v in slides[idx].items() if k not in ("svg_code", "editable_texts")}
    prompt = (
        f"所属课件：《{deck['title']}》（{deck['subject']} / {deck['grade_level']}）\n"
        f"当前第 {slide_number} 页 JSON：\n{json.dumps(cur, ensure_ascii=False)}\n\n"
        f"用户优化指令：{req.instruction}\n\n"
        "请只输出重构后的这一页单个 JSON 对象（字段与原结构一致，包含 layout, kicker, title, subtitle, cards, takeaway, speaker_notes）。"
    )
    new_slide, _ = await call_llm_json(
        system_prompt="你是单页幻灯片结构精修助手，严格输出一个符合 ppt-master 结构规范的合法 JSON 对象。",
        user_prompt=prompt,
        max_tokens=4500,
    )
    slides[idx] = new_slide

    compiled = compile_ppt_project(
        deck_id=deck_id,
        title=deck["title"],
        slides=slides,
        theme_id=deck["theme_id"],
    )
    edit_count = int(deck.get("edit_count", 0)) + 1
    art = upsert_artifact(
        deck.get("pptx_artifact_id") or None,
        title=f"课件PPT：{deck['title']}",
        category="pptx",
        module="ppt",
        filename=compiled["pptx_filename"],
        file_path=compiled["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=compiled["size_bytes"],
        verified_status="verified",
        revision_count=edit_count,
        meta={"deck_id": deck_id, "audit": compiled["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE ppt_decks SET slides_json = ?, quality_report_json = ?, pptx_audit_json = ?, pptx_artifact_id = ?, edit_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(compiled["slides"], ensure_ascii=False),
                json.dumps(compiled["quality_report"], ensure_ascii=False),
                json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                art["id"],
                edit_count,
                time.time(),
                deck_id,
            ),
        )
    log_telemetry("ppt", "regenerate_slide", verified_ok=True, human_edited=True)
    return {"ok": True, "slides": compiled["slides"], "pptx_audit": compiled["pptx_audit"], "artifact": art}


@router.post("/decks/{deck_id}/narrate")
async def narrate_deck(deck_id: str, req: NarrateReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课件不存在")
        deck = _row_to_deck(row)

    res = await synthesize_deck_narration(
        deck_id=deck_id,
        title=deck["title"],
        slides=deck["slides"],
        voice=req.voice,
    )
    art = upsert_artifact(
        deck.get("audio_artifact_id") or None,
        title=f"微格试讲语音：{deck['title']}",
        category="mp3",
        module="ppt",
        filename=res["filename"],
        file_path=res["audio_path"],
        mime_type=res.get("mime_type", "audio/mpeg"),
        size_bytes=res["size_bytes"],
        verified_status="verified",
        meta={"deck_id": deck_id, "voice": req.voice, "engine": res.get("engine", "edge-tts")},
    )
    with get_conn() as conn:
        conn.execute(
            "UPDATE ppt_decks SET audio_artifact_id = ?, updated_at = ? WHERE id = ?",
            (art["id"], time.time(), deck_id),
        )
    log_telemetry("ppt", "tts_narrate", verified_ok=True)
    return {"ok": True, "audio_artifact": art}
