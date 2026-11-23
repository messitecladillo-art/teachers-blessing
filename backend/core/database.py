"""SQLite persistence layer (WAL mode) for EduForge Studio."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

from core.config import DB_PATH


def _now_ts() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(DB_PATH), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL,      -- pptx | docx_lesson | docx_exam_student | docx_exam_teacher | docx_analytics | mp3 | ics | md
                module TEXT NOT NULL,        -- tutor | lesson | ppt | exam | analytics
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                verified_status TEXT NOT NULL DEFAULT 'verified',
                revision_count INTEGER NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tutor_sessions (
                id TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL,
                question_text TEXT NOT NULL,
                result_json TEXT NOT NULL,
                verification_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS error_book (
                id TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL,
                topic_tag TEXT NOT NULL,
                question_text TEXT NOT NULL,
                my_mistake TEXT NOT NULL DEFAULT '',
                key_takeaway TEXT NOT NULL DEFAULT '',
                solution_json TEXT NOT NULL DEFAULT '{}',
                mastery_level INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS study_plans (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                days_json TEXT NOT NULL,
                ics_artifact_id TEXT DEFAULT '',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lessons (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL,
                lesson_type TEXT NOT NULL,
                content_json TEXT NOT NULL,
                original_char_count INTEGER NOT NULL DEFAULT 0,
                edited_char_delta INTEGER NOT NULL DEFAULT 0,
                edit_count INTEGER NOT NULL DEFAULT 0,
                artifact_id TEXT DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ppt_decks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL,
                theme_id TEXT NOT NULL,
                project_dir TEXT NOT NULL,
                slides_json TEXT NOT NULL,
                quality_report_json TEXT NOT NULL DEFAULT '{}',
                pptx_audit_json TEXT NOT NULL DEFAULT '{}',
                pptx_artifact_id TEXT DEFAULT '',
                audio_artifact_id TEXT DEFAULT '',
                edit_count INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS exams (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL,
                exam_json TEXT NOT NULL,
                student_artifact_id TEXT DEFAULT '',
                teacher_artifact_id TEXT DEFAULT '',
                edit_count INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS analytics_reports (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                dataset_name TEXT NOT NULL,
                stats_json TEXT NOT NULL,
                ai_narrative_json TEXT NOT NULL,
                desensitize_summary_json TEXT NOT NULL,
                teacher_reviewed INTEGER NOT NULL DEFAULT 0,
                teacher_note TEXT NOT NULL DEFAULT '',
                artifact_id TEXT DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS telemetry_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module TEXT NOT NULL,
                action TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                verified_ok INTEGER NOT NULL DEFAULT 1,
                human_edited INTEGER NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mindmaps (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                domain_id TEXT NOT NULL DEFAULT '',
                branch TEXT NOT NULL DEFAULT '',
                graph_json TEXT NOT NULL,
                drawio_xml TEXT NOT NULL,
                artifact_id TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_threads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                plan_json TEXT NOT NULL DEFAULT '[]',
                pending_goal TEXT NOT NULL DEFAULT '',
                artifacts_json TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                plan_json TEXT NOT NULL DEFAULT '[]',
                tool_traces_json TEXT NOT NULL DEFAULT '[]',
                linked_items_json TEXT NOT NULL DEFAULT '[]',
                needs_confirmation INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS learner_memory (
                id TEXT PRIMARY KEY,
                topic_tag TEXT NOT NULL UNIQUE,
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL DEFAULT '高二年级',
                mastery_score REAL NOT NULL DEFAULT 55.0,
                mistake_patterns_json TEXT NOT NULL DEFAULT '[]',
                practice_count INTEGER NOT NULL DEFAULT 1,
                correct_count INTEGER NOT NULL DEFAULT 0,
                last_practiced_at REAL NOT NULL,
                next_review_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teacher_preferences (
                pref_key TEXT PRIMARY KEY,
                pref_value TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                char_count INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                quality_note TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                doc_title TEXT NOT NULL,
                chapter_title TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS exam_submissions (
                id TEXT PRIMARY KEY,
                exam_id TEXT NOT NULL,
                exam_title TEXT NOT NULL,
                score REAL NOT NULL,
                total_score REAL NOT NULL,
                duration_sec INTEGER NOT NULL DEFAULT 0,
                answers_json TEXT NOT NULL,
                item_results_json TEXT NOT NULL,
                weak_topics_json TEXT NOT NULL,
                analytics_report_id TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tutor_followups (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL,
                grade_level TEXT NOT NULL DEFAULT '高二年级',
                curator TEXT NOT NULL DEFAULT '知学教研组',
                source_label TEXT NOT NULL DEFAULT '知学课程库',
                cover_image TEXT NOT NULL DEFAULT '/assets/hk/course_calculus.png',
                status TEXT NOT NULL DEFAULT 'in_progress',
                progress_pct INTEGER NOT NULL DEFAULT 0,
                mode TEXT NOT NULL DEFAULT 'self_study',
                description TEXT NOT NULL DEFAULT '',
                units_json TEXT NOT NULL DEFAULT '[]',
                cheatsheet_json TEXT NOT NULL DEFAULT '{}',
                linked_ids_json TEXT NOT NULL DEFAULT '{}',
                weekly_sessions_json TEXT NOT NULL DEFAULT '{}',
                last_lecture_id TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS calendar_tasks (
                id TEXT PRIMARY KEY,
                date_str TEXT NOT NULL,
                title TEXT NOT NULL,
                course_title TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                minutes INTEGER NOT NULL DEFAULT 30,
                completed INTEGER NOT NULL DEFAULT 0,
                plan_id TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );
            """
        )


def log_telemetry(
    module: str,
    action: str,
    duration_ms: int = 0,
    verified_ok: bool = True,
    human_edited: bool = False,
    meta: dict[str, Any] | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO telemetry_events (module, action, duration_ms, verified_ok, human_edited, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                module,
                action,
                int(duration_ms),
                1 if verified_ok else 0,
                1 if human_edited else 0,
                json.dumps(meta or {}, ensure_ascii=False),
                _now_ts(),
            ),
        )


def upsert_artifact(
    artifact_id: str | None,
    *,
    title: str,
    category: str,
    module: str,
    filename: str,
    file_path: str,
    mime_type: str,
    size_bytes: int,
    verified_status: str = "verified",
    revision_count: int = 0,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = _now_ts()
    aid = artifact_id or new_id("art")
    with get_conn() as conn:
        existing = conn.execute("SELECT id, created_at, revision_count FROM artifacts WHERE id = ?", (aid,)).fetchone()
        if existing:
            rev = revision_count if revision_count > 0 else int(existing["revision_count"]) + 1
            conn.execute(
                """
                UPDATE artifacts
                SET title = ?, category = ?, module = ?, filename = ?, file_path = ?,
                    mime_type = ?, size_bytes = ?, verified_status = ?, revision_count = ?,
                    meta_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    title,
                    category,
                    module,
                    filename,
                    file_path,
                    mime_type,
                    int(size_bytes),
                    verified_status,
                    rev,
                    json.dumps(meta or {}, ensure_ascii=False),
                    now,
                    aid,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO artifacts (
                    id, title, category, module, filename, file_path, mime_type,
                    size_bytes, verified_status, revision_count, meta_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    aid,
                    title,
                    category,
                    module,
                    filename,
                    file_path,
                    mime_type,
                    int(size_bytes),
                    verified_status,
                    revision_count,
                    json.dumps(meta or {}, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (aid,)).fetchone()
    return _row_to_artifact(row)


def _row_to_artifact(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {}
    d = dict(row)
    try:
        d["meta"] = json.loads(d.pop("meta_json") or "{}")
    except Exception:
        d["meta"] = {}
    d["download_url"] = f"/api/artifacts/{d['id']}/download"
    return d


def list_artifacts(module: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if module:
            rows = conn.execute(
                "SELECT * FROM artifacts WHERE module = ? ORDER BY updated_at DESC",
                (module,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM artifacts ORDER BY updated_at DESC").fetchall()
    return [_row_to_artifact(r) for r in rows]


def get_artifact(artifact_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
    return _row_to_artifact(row) if row else None


def delete_artifact(artifact_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM artifacts WHERE id = ?", (artifact_id,))
        return cur.rowcount > 0


def get_telemetry_summary() -> dict[str, Any]:
    with get_conn() as conn:
        total_artifacts = conn.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
        total_events = conn.execute("SELECT COUNT(*) FROM telemetry_events").fetchone()[0]
        verified_events = conn.execute("SELECT COUNT(*) FROM telemetry_events WHERE verified_ok = 1").fetchone()[0]
        edited_events = conn.execute("SELECT COUNT(*) FROM telemetry_events WHERE human_edited = 1").fetchone()[0]
        avg_ms_row = conn.execute("SELECT AVG(duration_ms) FROM telemetry_events WHERE duration_ms > 0").fetchone()[0]
        error_book_count = conn.execute("SELECT COUNT(*) FROM error_book").fetchone()[0]
        lessons_count = conn.execute("SELECT COUNT(*) FROM lessons").fetchone()[0]
        decks_count = conn.execute("SELECT COUNT(*) FROM ppt_decks").fetchone()[0]
        exams_count = conn.execute("SELECT COUNT(*) FROM exams").fetchone()[0]
        analytics_count = conn.execute("SELECT COUNT(*) FROM analytics_reports").fetchone()[0]
        agent_threads_count = conn.execute("SELECT COUNT(*) FROM agent_threads").fetchone()[0]
        source_docs_count = conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]
        exam_submissions_count = conn.execute("SELECT COUNT(*) FROM exam_submissions").fetchone()[0]
        by_module = conn.execute(
            "SELECT module, COUNT(*) as cnt FROM telemetry_events GROUP BY module"
        ).fetchall()

    return {
        "total_artifacts": total_artifacts,
        "total_runs": total_events,
        "verification_pass_rate": round((verified_events / total_events) * 100, 1) if total_events else 100.0,
        "human_revision_rate": round((edited_events / max(total_events, 1)) * 100, 1),
        "avg_generation_sec": round((avg_ms_row or 0) / 1000.0, 2),
        "counts": {
            "error_book": error_book_count,
            "lessons": lessons_count,
            "ppt_decks": decks_count,
            "exams": exams_count,
            "analytics": analytics_count,
            "agent_threads": agent_threads_count,
            "source_docs": source_docs_count,
            "exam_submissions": exam_submissions_count,
        },
        "runs_by_module": {r["module"]: r["cnt"] for r in by_module},
    }


def purge_all_tables() -> dict[str, int]:
    """Delete all user records and telemetry from SQLite."""
    tables = [
        "artifacts",
        "tutor_sessions",
        "tutor_followups",
        "error_book",
        "study_plans",
        "lessons",
        "ppt_decks",
        "exams",
        "exam_submissions",
        "analytics_reports",
        "mindmaps",
        "agent_threads",
        "agent_messages",
        "learner_memory",
        "teacher_preferences",
        "source_documents",
        "source_chunks",
        "courses",
        "calendar_tasks",
        "telemetry_events",
    ]
    deleted: dict[str, int] = {}
    with get_conn() as conn:
        for t in tables:
            cur = conn.execute(f"DELETE FROM {t}")
            deleted[t] = cur.rowcount
    return deleted
