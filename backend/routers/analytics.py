"""Privacy-preserving Learning Analytics API: Local PII Desensitization + Deterministic Psychometrics + DOCX Export."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import extract_json_payload, stream_llm
from core.sse import sse_event
from engines.analytics_engine import (
    SAMPLE_CSV_CONTENT,
    compute_deterministic_analytics,
    desensitize_csv_text,
)
from engines.docx_compiler import compile_analytics_docx

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

_ANALYTICS_SYSTEM_PROMPT = """你是一名教育测量与精准教学诊断专家。
注意：所有学生 PII（姓名、学号、手机号）已在本地脱敏，且所有描述性统计指标（均值、中位数、标准差、及格率、各题掌握率、区分度）均已由确定性 Python 算法精确算好。
你不得臆造任何未提供的新数值！请严格引用系统提供的统计结果，撰写教学归因诊断与靶向干预建议。

严格输出合法 JSON：
{
  "overall_diagnosis": "一段简洁专业的整体学情判断（严格引用给定均分、及格率与分布特点）",
  "weakness_attribution": "结合各小题掌握率与区分度，分析核心认知卡点与薄弱群体特征",
  "teaching_interventions": [
    "针对性课堂讲评策略1",
    "分层课后巩固建议2",
    "微格试讲改进焦点3"
  ]
}"""


class DesensitizePreviewReq(BaseModel):
    csv_text: str


class AnalyzeReq(BaseModel):
    title: str = "单元测验学情诊断分析报告"
    dataset_name: str = "成绩单.csv"
    csv_text: str
    teacher_note: str = ""


class TeacherReviewReq(BaseModel):
    teacher_reviewed: bool
    teacher_note: str


@router.get("/sample-csv")
async def get_sample_csv() -> dict[str, Any]:
    return {
        "ok": True,
        "dataset_name": "高二数学导数与极值单元测验_48人明细.csv",
        "csv_text": SAMPLE_CSV_CONTENT.strip(),
    }


@router.get("/reports")
async def list_analytics_reports() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM analytics_reports ORDER BY updated_at DESC").fetchall()
    reports = []
    for r in rows:
        d = dict(r)
        d["stats"] = json.loads(d.pop("stats_json") or "{}")
        d["ai_narrative"] = json.loads(d.pop("ai_narrative_json") or "{}")
        d["desensitize_summary"] = json.loads(d.pop("desensitize_summary_json") or "{}")
        d["teacher_reviewed"] = bool(d["teacher_reviewed"])
        reports.append(d)
    return {"ok": True, "reports": reports}


@router.post("/desensitize-preview")
async def preview_desensitize(req: DesensitizePreviewReq) -> dict[str, Any]:
    try:
        res = desensitize_csv_text(req.csv_text)
        return {
            "ok": True,
            "student_count": res["student_count"],
            "dropped_columns": res["dropped_columns"],
            "masked_columns": res["masked_columns"],
            "redacted_fields_count": res["redacted_fields_count"],
            "sample_before": res["sample_before"],
            "sample_after": res["sample_after"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analyze")
async def analyze_scores_stream(req: AnalyzeReq) -> StreamingResponse:
    async def event_gen():
        t0 = time.time()
        try:
            yield sse_event("stage", {"stage": "desensitizing", "message": "正在执行本地姓名学号自动脱敏…"})
            desens = desensitize_csv_text(req.csv_text)
            report_id = new_id("ana")

            yield sse_event("stage", {"stage": "computing", "message": "正在计算分数分布与区分度指标…"})
            stats = compute_deterministic_analytics(desens, report_id)

            yield sse_event("stage", {"stage": "diagnosing", "message": "正在生成薄弱点分析与教学建议…"})
            prompt = (
                f"报告标题：{req.title}\n"
                f"脱敏统计事实（已确定性计算）：\n"
                f"- 有效样本 N = {stats['student_count']}，满分 = {stats['full_score']}\n"
                f"- 核心统计：{json.dumps(stats['summary'], ensure_ascii=False)}\n"
                f"- 分数段分布：{json.dumps(stats['distribution'], ensure_ascii=False)}\n"
                f"- 小题与知识点掌握率：{json.dumps(stats['item_metrics'], ensure_ascii=False)}\n"
                f"- 重点关注（低于及格线）人数：{stats['cohorts']['attention_count']} 名\n"
            )

            full_text = ""
            async for chunk in stream_llm(system_prompt=_ANALYTICS_SYSTEM_PROMPT, user_prompt=prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            narrative = extract_json_payload(full_text)
            desens_meta = {k: v for k, v in desens.items() if k != "masked_csv"}
            report_obj = {
                "id": report_id,
                "title": req.title,
                "dataset_name": req.dataset_name,
                "stats": stats,
                "ai_narrative": narrative,
                "desensitize_summary": desens_meta,
                "teacher_reviewed": False,
                "teacher_note": req.teacher_note,
            }
            docx_path = compile_analytics_docx(report_obj, report_id)
            art = upsert_artifact(
                None,
                title=f"学情报告：{req.title}",
                category="docx_analytics",
                module="analytics",
                filename=docx_path.name,
                file_path=str(docx_path),
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size_bytes=docx_path.stat().st_size,
                verified_status="needs_review",
                meta={"report_id": report_id},
            )
            now = time.time()
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO analytics_reports (id, title, dataset_name, stats_json, ai_narrative_json, desensitize_summary_json, teacher_reviewed, teacher_note, artifact_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                    """,
                    (
                        report_id,
                        req.title,
                        req.dataset_name,
                        json.dumps(stats, ensure_ascii=False),
                        json.dumps(narrative, ensure_ascii=False),
                        json.dumps(desens_meta, ensure_ascii=False),
                        req.teacher_note,
                        art["id"],
                        now,
                        now,
                    ),
                )

            duration_ms = int((time.time() - t0) * 1000)
            log_telemetry("analytics", "analyze", duration_ms=duration_ms, verified_ok=True)
            report_obj["artifact_id"] = art["id"]
            yield sse_event("result", {"report": report_obj, "artifact": art, "duration_ms": duration_ms})
        except Exception as exc:
            log_telemetry("analytics", "analyze_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"学情诊断失败：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.put("/{report_id}/review")
async def teacher_sign_off_report(report_id: str, req: TeacherReviewReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM analytics_reports WHERE id = ?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="学情报告不存在")

        report_obj = {
            "id": report_id,
            "title": row["title"],
            "stats": json.loads(row["stats_json"] or "{}"),
            "ai_narrative": json.loads(row["ai_narrative_json"] or "{}"),
            "desensitize_summary": json.loads(row["desensitize_summary_json"] or "{}"),
            "teacher_reviewed": req.teacher_reviewed,
            "teacher_note": req.teacher_note,
        }
        docx_path = compile_analytics_docx(report_obj, report_id)
        art = upsert_artifact(
            row["artifact_id"] or None,
            title=f"学情报告：{row['title']}",
            category="docx_analytics",
            module="analytics",
            filename=docx_path.name,
            file_path=str(docx_path),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=docx_path.stat().st_size,
            verified_status="verified" if req.teacher_reviewed else "needs_review",
            meta={"report_id": report_id},
        )
        conn.execute(
            """
            UPDATE analytics_reports SET teacher_reviewed = ?, teacher_note = ?, artifact_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (1 if req.teacher_reviewed else 0, req.teacher_note, art["id"], time.time(), report_id),
        )
    log_telemetry("analytics", "teacher_review", verified_ok=True, human_edited=True)
    return {"ok": True, "artifact": art, "teacher_reviewed": req.teacher_reviewed}
