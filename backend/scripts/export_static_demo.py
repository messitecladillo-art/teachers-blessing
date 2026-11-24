"""Export clean, secret-free showcase snapshot for GitHub Pages static demo runtime."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
OUT_PATH = PROJECT_ROOT / "frontend" / "public" / "demo-data" / "snapshot.json"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from core.bootstrap import ensure_showcase_data  # noqa: E402
from core.database import init_db, purge_all_tables  # noqa: E402
from main import app  # noqa: E402


def _assert_no_secrets(payload_str: str) -> None:
    if re.search(r"sk-[A-Za-z0-9]{16,}", payload_str):
        raise RuntimeError("Refusing to write snapshot: potential secret key matched!")


def main() -> None:
    init_db()
    purge_all_tables()
    ensure_showcase_data()

    with TestClient(app) as client:
        sys_status = client.get("/api/system/status").json()
        # Never leak local environment API key presence into static snapshot
        if isinstance(sys_status.get("llm"), dict):
            sys_status["llm"]["has_api_key"] = False
            sys_status["llm"]["key_source"] = "demo"

        telemetry = client.get("/api/system/telemetry").json()
        courses_res = client.get("/api/courses").json()
        mkt_curated = client.get("/api/courses/marketplace?tab=curated").json()
        mkt_teaching = client.get("/api/courses/marketplace?tab=teaching").json()
        ped_topics = client.get("/api/pedagogy/topics").json()
        ped_tax = client.get("/api/pedagogy/taxonomy").json()
        memory = client.get("/api/agent/memory").json()

        threads_list = client.get("/api/agent/threads").json().get("threads") or []
        thread_details: dict[str, Any] = {}
        for th in threads_list:
            tid = th.get("id")
            if tid:
                det = client.get(f"/api/agent/threads/{tid}").json().get("thread")
                if det:
                    thread_details[tid] = det

        docs_list = client.get("/api/sources/list").json().get("documents") or []
        source_chunks: dict[str, Any] = {}
        for doc in docs_list:
            did = doc.get("id")
            if did:
                source_chunks[did] = client.get(f"/api/sources/{did}/chunks").json().get("chunks") or []

        artifacts = client.get("/api/artifacts").json().get("artifacts") or []
        lessons = client.get("/api/lesson/list").json().get("lessons") or []
        ppt_themes = client.get("/api/ppt/themes").json()
        ppt_decks = client.get("/api/ppt/decks").json().get("decks") or []
        exam_catalog = client.get("/api/exam/bank/catalog").json()
        exams = client.get("/api/exam/list").json().get("exams") or []
        sample_csv = client.get("/api/analytics/sample-csv").json()
        analytics_reports = client.get("/api/analytics/reports").json().get("reports") or []
        mindmaps = client.get("/api/mindmap/list").json().get("mindmaps") or []
        error_book = client.get("/api/tutor/error-book").json().get("items") or []
        study_plans = client.get("/api/tutor/study-plans").json().get("plans") or []
        calendar_tasks = client.get("/api/tutor/calendar-tasks").json().get("tasks") or []

        # Precompute interactive 2D/3D plots so visual canvas renders real SymPy curves offline
        plots_2d: dict[str, Any] = {}
        for expr in ("x^3 - 3*x^2 + 2", "x^3 - 3*x", "x^3", "x^4", "x - ln(x)", "ln(x) + 0.5*x^2", "1/(x^2 + 0.35)"):
            try:
                p = client.post("/api/tutor/plot-function", json={"expression": expr}).json()
                if p.get("ok"):
                    plots_2d[expr] = p
            except Exception:
                pass

        surface_3d: dict[str, Any] = {}
        try:
            s3 = client.post("/api/tutor/plot-surface-3d", json={"expression": "sin(x)*cos(y)"}).json()
            if s3.get("ok"):
                surface_3d = s3
        except Exception:
            pass

    snapshot = {
        "system_status": sys_status,
        "telemetry": telemetry,
        "courses": courses_res.get("courses") or [],
        "weekly_tracker": courses_res.get("weekly_tracker") or {},
        "marketplace_curated": mkt_curated,
        "marketplace_teaching": mkt_teaching,
        "pedagogy_topics": ped_topics,
        "pedagogy_taxonomy": ped_tax,
        "memory": memory,
        "threads": threads_list,
        "thread_details": thread_details,
        "sources": docs_list,
        "source_chunks": source_chunks,
        "artifacts": artifacts,
        "lessons": lessons,
        "ppt_themes": ppt_themes,
        "ppt_decks": ppt_decks,
        "exam_catalog": exam_catalog,
        "exams": exams,
        "sample_csv": sample_csv,
        "analytics_reports": analytics_reports,
        "mindmaps": mindmaps,
        "error_book": error_book,
        "study_plans": study_plans,
        "calendar_tasks": calendar_tasks,
        "plots_2d": plots_2d,
        "surface_3d": surface_3d,
    }

    raw_json = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    _assert_no_secrets(raw_json)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(raw_json, encoding="utf-8")
    size_kb = round(OUT_PATH.stat().st_size / 1024, 1)
    print(f"EXPORTED_SNAPSHOT: {OUT_PATH} ({size_kb} KB)")


if __name__ == "__main__":
    main()
