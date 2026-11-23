"""Unified cross-module tool registry callable by the autonomous multi-step orchestrator."""

from __future__ import annotations

import json
import time
from typing import Any

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm_json
from engines.docx_compiler import compile_exam_docx, compile_lesson_docx
from engines.knowledge_index import search_source_chunks
from engines.math_verifier import extract_plottable_expression, sample_function_plot, verify_freeform_expression
from engines.memory_engine import build_memory_context_text, create_remediation_quiz, get_teacher_preferences
from engines.mindmap_engine import auto_layout_mindmap, compile_drawio_xml
from engines.pedagogy_kb import format_pedagogy_rag_context, retrieve_pedagogy_insights
from engines.ppt_bridge import compile_ppt_project, resolve_theme
from engines.question_bank_engine import assemble_from_bank, find_bank_match
from engines.self_repair import (
    sanitize_and_repair_slides,
    verify_and_repair_exam,
    verify_and_repair_tutor_solution,
)


async def tool_search_materials(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or ctx.get("goal") or "").strip()
    doc_id = str(args.get("doc_id") or "").strip() or None
    hits = search_source_chunks(query, doc_id=doc_id, limit=4)
    if not hits:
        # Automatic fallback to built-in 52-topic knowledge base
        topics = retrieve_pedagogy_insights(query, limit=2)
        if topics:
            fb_text = format_pedagogy_rag_context(topics)
            return {
                "ok": True,
                "summary": f"上传讲义中暂无直接匹配，已自动转入专题库补充 {len(topics)} 条资料（《{topics[0]['title']}》）。",
                "context_text": fb_text,
                "linked_item": None,
                "auto_repaired": True,
            }
        return {
            "ok": False,
            "summary": "暂未检索到匹配的上传讲义章节。",
            "context_text": "",
            "linked_item": None,
            "auto_repaired": False,
        }

    blocks = []
    titles = []
    for h in hits:
        titles.append(f"{h['doc_title']}·{h['chapter_title']}")
        blocks.append(f"[{h['doc_title']} - {h['chapter_title']}]\n{h['content']}")
    return {
        "ok": True,
        "summary": f"已检索到 {len(hits)} 段讲义资料：{'；'.join(titles[:3])}",
        "context_text": "\n\n".join(blocks)[:5000],
        "linked_item": None,
        "auto_repaired": False,
    }


async def tool_search_topics(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or ctx.get("goal") or "").strip()
    domain = str(args.get("domain") or "").strip()
    matches = retrieve_pedagogy_insights(query, domain_id=domain, limit=3)
    if not matches:
        return {"ok": False, "summary": "专题库未匹配到相关条目。", "context_text": "", "linked_item": None, "auto_repaired": False}
    return {
        "ok": True,
        "summary": f"已定位 {len(matches)} 个相关专题：{'、'.join(m['title'] for m in matches)}",
        "context_text": format_pedagogy_rag_context(matches),
        "linked_item": None,
        "auto_repaired": False,
    }


async def tool_verify_math(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    expr = str(args.get("expression") or "").strip()
    if not expr:
        return {"ok": False, "summary": "未提供待验算表达式。", "context_text": "", "linked_item": None, "auto_repaired": False}
    ver = verify_freeform_expression(expr)
    return {
        "ok": ver.get("status") == "verified",
        "summary": f"{ver.get('badge', '验算完成')}：{ver.get('detail', '')}",
        "context_text": ver.get("detail", ""),
        "linked_item": None,
        "auto_repaired": False,
    }


async def tool_create_mindmap(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    topic = str(args.get("topic") or ctx.get("goal") or "专题知识结构").strip()
    subject = str(args.get("subject") or get_teacher_preferences().get("preferred_subject", "高中数学"))
    domain = str(args.get("domain") or "")
    extra = str(args.get("source_context") or ctx.get("shared_context") or "")[:3200]

    prompt = f"主题：{topic}\n学科：{subject}\n"
    if extra:
        prompt += f"\n参考材料：\n{extra}\n"
    prompt += (
        "\n请设计 10~15 个节点的思维导图（包含左/右分支与 1 条跨分支连线），"
        '严格输出合法 JSON：{"title": "...", "layout": "mindmap_lr", "nodes": [{"id": "n_root", "label": "...", "parent_id": null, "level": 0, "side": "center", "category": "root", "note": "..."}], "cross_links": [{"id": "cl_1", "source": "n_b1", "target": "n_b2", "label": "关联"}]}'
    )
    graph, _ = await call_llm_json(
        system_prompt="你是教学知识图谱梳理助手，负责输出结构清晰、节点精炼的思维导图 JSON（禁止出现技术术语或修饰语）。",
        user_prompt=prompt,
        max_tokens=3200,
        temperature=0.2,
    )
    map_id = new_id("mmap")
    title = str(graph.get("title") or topic)[:36]
    laid = auto_layout_mindmap({**graph, "title": title})
    xml_str, file_path = compile_drawio_xml(laid, map_id)
    art = upsert_artifact(
        None,
        title=f"思维导图：{title}",
        category="drawio",
        module="tutor",
        filename=file_path.name,
        file_path=str(file_path),
        mime_type="application/xml",
        size_bytes=file_path.stat().st_size,
        verified_status="verified",
        meta={"mindmap_id": map_id, "node_count": len(laid.get("nodes") or [])},
    )
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO mindmaps (id, title, subject, domain_id, branch, graph_json, drawio_xml, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)
            """,
            (map_id, title, subject, domain, json.dumps(laid, ensure_ascii=False), xml_str, art["id"], now, now),
        )
    ctx["artifacts"]["mindmap_id"] = map_id
    return {
        "ok": True,
        "summary": f"已生成思维导图《{title}》（含 {len(laid.get('nodes') or [])} 个节点）。",
        "context_text": f"导图节点结构：{'、'.join(str(n.get('label', '')) for n in (laid.get('nodes') or [])[:8])}",
        "linked_item": {
            "kind": "mindmap",
            "id": map_id,
            "title": title,
            "subtitle": f"{subject} · {len(laid.get('nodes') or [])} 个节点",
            "artifact_id": art["id"],
            "download_url": art["download_url"],
        },
        "auto_repaired": False,
    }


async def tool_create_or_edit_lesson(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    prefs = get_teacher_preferences()
    target_id = str(args.get("lesson_id") or "").strip()
    if args.get("mode") == "edit" and not target_id:
        target_id = str(ctx.get("artifacts", {}).get("lesson_id") or "")
    instruction = str(args.get("instruction") or "").strip()

    if target_id and instruction:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM lessons WHERE id = ?", (target_id,)).fetchone()
        if row:
            content = json.loads(row["content_json"] or "{}")
            edit_prompt = (
                f"现有教案《{content.get('title', '')}》：\n{json.dumps(content, ensure_ascii=False)[:7500]}\n\n"
                f"需要联动修改的要求：{instruction}\n"
                + (f"\n同步参考上下文：\n{ctx.get('shared_context', '')[:2500]}\n" if ctx.get("shared_context") else "")
                + "\n请返回修改后的完整教案 JSON（保留所有原有字段名与类型）。"
            )
            updated, _ = await call_llm_json(
                system_prompt="你是精准教案修订助手，按修改要求同步更新教案对应环节或练习题并保持完整合法 JSON。",
                user_prompt=edit_prompt,
                max_tokens=5500,
                temperature=0.15,
            )
            if isinstance(updated, dict) and updated.get("teaching_steps"):
                edit_count = int(row["edit_count"]) + 1
                updated["id"] = target_id
                updated["edit_count"] = edit_count
                title = str(updated.get("title") or row["title"])
                docx_path = compile_lesson_docx(updated, target_id)
                art = upsert_artifact(
                    row["artifact_id"] or None,
                    title=f"教案：{title}",
                    category="docx_lesson",
                    module="lesson",
                    filename=docx_path.name,
                    file_path=str(docx_path),
                    mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size_bytes=docx_path.stat().st_size,
                    revision_count=edit_count,
                    meta={"lesson_id": target_id},
                )
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE lessons SET title = ?, content_json = ?, edit_count = ?, artifact_id = ?, updated_at = ? WHERE id = ?",
                        (title, json.dumps(updated, ensure_ascii=False), edit_count, art["id"], time.time(), target_id),
                    )
                return {
                    "ok": True,
                    "summary": f"已按要求同步更新教案《{title}》并重新生成文档。",
                    "context_text": f"已更新教案《{title}》教学过程与配套练习。",
                    "linked_item": {
                        "kind": "lesson",
                        "id": target_id,
                        "title": title,
                        "subtitle": f"{row['subject']} · {row['grade_level']} · 已更新",
                        "artifact_id": art["id"],
                        "download_url": art["download_url"],
                    },
                    "auto_repaired": False,
                }

    topic = str(args.get("topic") or ctx.get("goal") or "专题新授课").strip()
    subject = str(args.get("subject") or prefs.get("preferred_subject", "高中数学"))
    grade = str(args.get("grade_level") or prefs.get("preferred_grade", "高二年级"))
    ltype = str(args.get("lesson_type") or prefs.get("preferred_lesson_type", "45分钟新授课"))
    src_ctx = str(args.get("source_context") or ctx.get("shared_context") or "")[:4500]
    mem_ctx = build_memory_context_text("both")

    prompt = (
        f"学科：{subject} ｜ 学段：{grade} ｜ 课题：{topic} ｜ 课型：{ltype}\n"
        f"{mem_ctx}\n"
        + (f"\n参考资料与前置检索结果：\n{src_ctx}\n" if src_ctx else "")
        + '\n严格输出合法 JSON：{"title": "...", "subject": "...", "grade_level": "...", "lesson_type": "...", "duration": "...", "objectives": ["..."], "learner_analysis": "...", "key_points": "...", "difficult_points": "...", "teaching_steps": [{"phase": "...", "duration": "...", "teacher_activity": "...", "student_activity": "...", "design_intent": "..."}], "blackboard_design": "【主板书】...\\n【副板书】...", "exercises": [{"tier": "基础巩固", "question": "...", "solution": "..."}], "verification_checklist": ["..."]}'
    )
    lesson_obj, _ = await call_llm_json(
        system_prompt="你是资深教研员，负责生成结构完整、含时间轴、正副板书与分层练习的教学设计，只输出合法 JSON。",
        user_prompt=prompt,
        max_tokens=5500,
        temperature=0.2,
    )
    lesson_id = new_id("les")
    lesson_obj["id"] = lesson_id
    lesson_obj["edit_count"] = 0
    title = str(lesson_obj.get("title") or topic)
    docx_path = compile_lesson_docx(lesson_obj, lesson_id)
    art = upsert_artifact(
        None,
        title=f"教案：{title}",
        category="docx_lesson",
        module="lesson",
        filename=docx_path.name,
        file_path=str(docx_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=docx_path.stat().st_size,
        meta={"lesson_id": lesson_id},
    )
    now = time.time()
    raw_str = json.dumps(lesson_obj, ensure_ascii=False)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (lesson_id, title, subject, grade, ltype, raw_str, len(raw_str), art["id"], now, now),
        )
    ctx["artifacts"]["lesson_id"] = lesson_id
    steps_summary = " -> ".join(str(st.get("phase", "")) for st in (lesson_obj.get("teaching_steps") or [])[:4])
    return {
        "ok": True,
        "summary": f"已生成教案《{title}》（含 {len(lesson_obj.get('teaching_steps') or [])} 个教学环节与板书设计）。",
        "context_text": f"教案《{title}》重点：{lesson_obj.get('key_points', '')}；教学流程：{steps_summary}",
        "linked_item": {
            "kind": "lesson",
            "id": lesson_id,
            "title": title,
            "subtitle": f"{subject} · {grade} · {ltype}",
            "artifact_id": art["id"],
            "download_url": art["download_url"],
        },
        "auto_repaired": False,
    }


async def tool_create_or_edit_slides(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    prefs = get_teacher_preferences()
    target_id = str(args.get("deck_id") or "").strip()
    if args.get("mode") == "edit" and not target_id:
        target_id = str(ctx.get("artifacts", {}).get("deck_id") or "")
    instruction = str(args.get("instruction") or "").strip()

    if target_id and instruction:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (target_id,)).fetchone()
        if row:
            slides = json.loads(row["slides_json"] or "[]")
            slim = [{k: v for k, v in sl.items() if k not in ("svg_code", "editable_texts")} for sl in slides]
            slide_no = max(1, min(len(slim), int(args.get("slide_number") or len(slim))))
            prompt = (
                f"课件《{row['title']}》当前第 {slide_no} 页：\n{json.dumps(slim[slide_no - 1], ensure_ascii=False)}\n\n"
                f"修改指令：{instruction}\n"
                + (f"上下文补充：{ctx.get('shared_context', '')[:2000]}\n" if ctx.get("shared_context") else "")
                + "请输出修改后的这一页单个合法 JSON 对象。"
            )
            new_sl, _ = await call_llm_json(
                system_prompt="你是课件页面修订助手，严格保持页面数据结构并输出单个合法 JSON 对象（禁用 $ 和反斜杠源码）。",
                user_prompt=prompt,
                max_tokens=3200,
                temperature=0.15,
            )
            slim[slide_no - 1] = new_sl
            repaired_slides, fix_cnt = sanitize_and_repair_slides(slim)
            compiled = compile_ppt_project(
                deck_id=target_id,
                title=row["title"],
                slides=repaired_slides,
                theme_id=row["theme_id"],
            )
            edit_count = int(row["edit_count"]) + 1
            art = upsert_artifact(
                row["pptx_artifact_id"] or None,
                title=f"课件PPT：{row['title']}",
                category="pptx",
                module="ppt",
                filename=compiled["pptx_filename"],
                file_path=compiled["pptx_path"],
                mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes=compiled["size_bytes"],
                revision_count=edit_count,
                meta={"deck_id": target_id, "audit": compiled["pptx_audit"]},
            )
            with get_conn() as conn:
                conn.execute(
                    "UPDATE ppt_decks SET slides_json = ?, quality_report_json = ?, pptx_audit_json = ?, pptx_artifact_id = ?, edit_count = ?, updated_at = ? WHERE id = ?",
                    (
                        json.dumps(compiled["slides"], ensure_ascii=False),
                        json.dumps(compiled["quality_report"], ensure_ascii=False),
                        json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                        art["id"],
                        edit_count,
                        time.time(),
                        target_id,
                    ),
                )
            return {
                "ok": True,
                "summary": f"已更新课件《{row['title']}》第 {slide_no} 页并重编演示文稿。",
                "context_text": f"课件《{row['title']}》第 {slide_no} 页已同步修订。",
                "linked_item": {
                    "kind": "ppt",
                    "id": target_id,
                    "title": row["title"],
                    "subtitle": f"{len(compiled['slides'])} 页 · 已修订",
                    "artifact_id": art["id"],
                    "download_url": art["download_url"],
                },
                "auto_repaired": fix_cnt > 0,
            }

    title = str(args.get("title") or ctx.get("goal") or "专题教学课件").strip()
    subject = str(args.get("subject") or prefs.get("preferred_subject", "高中数学"))
    grade = str(args.get("grade_level") or prefs.get("preferred_grade", "高二年级"))
    slide_count = max(4, min(8, int(args.get("slide_count") or prefs.get("preferred_slide_count", 6) or 6)))
    theme_id = resolve_theme(str(args.get("theme_id") or prefs.get("preferred_theme", "porcelain_daylight"))).id
    src_mat = str(args.get("source_material") or ctx.get("shared_context") or "")[:4500]

    prompt = (
        f"课题：{title}\n学科：{subject}\n学段：{grade}\n页数：{slide_count} 页（第 1 页必须为 cover，其余搭配 objectives、visual_graph、compare、steps、example、quiz）\n"
        + (f"\n参考资料与教案：\n{src_mat}\n" if src_mat else "")
        + '\n排版要求：禁止使用 $ 符号与反斜杠源码；title <= 18字；subtitle <= 34字。\n严格输出合法 JSON：{"title": "...", "slides": [{"layout": "cover", "kicker": "...", "title": "...", "subtitle": "...", "cards": [{"heading": "..."}], "takeaway": "...", "speaker_notes": "..."}]}'
    )
    parsed, _ = await call_llm_json(
        system_prompt="你是教学课件规划助手，擅长将教案与讲义转为 6 页清晰版式幻灯片，只输出合法 JSON。",
        user_prompt=prompt,
        max_tokens=6000,
        temperature=0.2,
    )
    raw_slides = parsed.get("slides") or []
    slides, fix_cnt = sanitize_and_repair_slides(raw_slides)
    deck_id = new_id("deck")
    deck_title = str(parsed.get("title") or title)
    compiled = compile_ppt_project(deck_id=deck_id, title=deck_title, slides=slides, theme_id=theme_id)
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
                subject,
                grade,
                theme_id,
                compiled["project_dir"],
                json.dumps(compiled["slides"], ensure_ascii=False),
                json.dumps(compiled["quality_report"], ensure_ascii=False),
                json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                art["id"],
                now,
                now,
            ),
        )
    ctx["artifacts"]["deck_id"] = deck_id
    return {
        "ok": True,
        "summary": f"已制作 {len(compiled['slides'])} 页教学课件《{deck_title}》" + (f"（并自动修整 {fix_cnt} 处文字与图示）" if fix_cnt else "。"),
        "context_text": f"课件《{deck_title}》共 {len(compiled['slides'])} 页。",
        "linked_item": {
            "kind": "ppt",
            "id": deck_id,
            "title": deck_title,
            "subtitle": f"{subject} · {len(compiled['slides'])} 页",
            "artifact_id": art["id"],
            "download_url": art["download_url"],
        },
        "auto_repaired": fix_cnt > 0,
    }


async def tool_assemble_exam(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    prefs = get_teacher_preferences()
    target_id = str(args.get("exam_id") or "").strip()
    if args.get("mode") == "edit" and not target_id:
        target_id = str(ctx.get("artifacts", {}).get("exam_id") or "")
    instruction = str(args.get("instruction") or "").strip()

    if target_id and instruction:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM exams WHERE id = ?", (target_id,)).fetchone()
        if row:
            exam_obj = json.loads(row["exam_json"] or "{}")
            questions = exam_obj.get("questions") or []
            q_idx = max(0, min(len(questions) - 1, int(args.get("question_index") or 0)))
            old_q = questions[q_idx]
            new_q, _ = await call_llm_json(
                system_prompt="你是精确换题助手，必须输出单个完整题目 JSON 对象（含 id, type, score, difficulty, knowledge_point, stem, options, answer, analysis, intent, sympy_checks）。",
                user_prompt=f"原第 {q_idx + 1} 题：\n{json.dumps(old_q, ensure_ascii=False)}\n\n替换要求：{instruction}\n",
                max_tokens=3200,
                temperature=0.15,
            )
            repaired_sub, rep_cnt = await verify_and_repair_exam(
                {"subject": exam_obj.get("subject", ""), "grade_level": exam_obj.get("grade_level", ""), "questions": [new_q]},
                max_retries=1,
            )
            questions[q_idx] = repaired_sub["questions"][0]
            exam_obj["questions"] = questions
            exam_obj["total_score"] = sum(int(q.get("score") or 5) for q in questions)
            stu_path = compile_exam_docx(exam_obj, target_id, edition="student")
            tea_path = compile_exam_docx(exam_obj, target_id, edition="teacher")
            edit_count = int(row["edit_count"]) + 1
            stu_art = upsert_artifact(
                row["student_artifact_id"] or None,
                title=f"{row['title']}（学生卷）",
                category="docx_exam_student",
                module="exam",
                filename=stu_path.name,
                file_path=str(stu_path),
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size_bytes=stu_path.stat().st_size,
                revision_count=edit_count,
                meta={"exam_id": target_id},
            )
            tea_art = upsert_artifact(
                row["teacher_artifact_id"] or None,
                title=f"{row['title']}（教师解析卷）",
                category="docx_exam_teacher",
                module="exam",
                filename=tea_path.name,
                file_path=str(tea_path),
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size_bytes=tea_path.stat().st_size,
                revision_count=edit_count,
                meta={"exam_id": target_id},
            )
            with get_conn() as conn:
                conn.execute(
                    "UPDATE exams SET exam_json = ?, edit_count = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(exam_obj, ensure_ascii=False), edit_count, time.time(), target_id),
                )
            replaced_stem = str(questions[q_idx].get("stem") or "")
            return {
                "ok": True,
                "summary": f"已将《{row['title']}》第 {q_idx + 1} 题替换为新题并重新核对答案。",
                "context_text": f"新替换第 {q_idx + 1} 题题干：{replaced_stem}；答案：{questions[q_idx].get('answer', '')}",
                "linked_item": {
                    "kind": "exam",
                    "id": target_id,
                    "title": row["title"],
                    "subtitle": f"{len(questions)} 题 · 第 {q_idx + 1} 题已更新",
                    "artifact_id": stu_art["id"],
                    "download_url": stu_art["download_url"],
                },
                "auto_repaired": rep_cnt > 0,
            }

    kp = str(args.get("knowledge_points") or args.get("query") or ctx.get("goal") or "集合与函数").strip()
    subject = str(args.get("subject") or prefs.get("preferred_subject", "高中数学"))
    grade = str(args.get("grade_level") or prefs.get("preferred_grade", "高一年级"))
    count = max(3, min(8, int(args.get("count") or 5)))

    exam_obj: dict[str, Any] | None = None
    repaired_cnt = 0
    bank_match = find_bank_match(kp) if ("数学" in subject or "集合" in kp or "导数" in kp or "函数" in kp) else None
    if bank_match:
        try:
            q_cnt = max(4, min(8, count))
            bank_res = assemble_from_bank(
                unit=bank_match["unit"],
                topics=bank_match["topics"] or None,
                mode="strategy",
                preference="balanced",
                count=q_cnt,
                duration=q_cnt * 4,
                versions=1,
            )
            if bank_res.get("papers"):
                exam_obj = bank_res["papers"][0]
        except Exception:
            exam_obj = None

    if exam_obj is None:
        src_ctx = str(args.get("source_context") or ctx.get("shared_context") or "")[:3000]
        prompt = (
            f"学科：{subject} ｜ 学段：{grade} ｜ 考查要点：{kp} ｜ 题量：{count} 道（含选择、填空或解答题）\n"
            + (f"\n参考资料：\n{src_ctx}\n" if src_ctx else "")
            + '\n严格输出合法 JSON：{"title": "...", "subject": "...", "grade_level": "...", "total_score": 30, "duration_minutes": 20, "questions": [{"id": "q1", "type": "单选题", "score": 5, "difficulty": "基础", "knowledge_point": "...", "stem": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "analysis": "...", "intent": "...", "sympy_checks": []}]}'
        )
        raw_exam, _ = await call_llm_json(
            system_prompt="你是严谨的命题老师，确保题干条件完备且所有选项互不相同，只输出合法 JSON。",
            user_prompt=prompt,
            max_tokens=5000,
            temperature=0.2,
        )
        exam_obj, repaired_cnt = await verify_and_repair_exam(raw_exam, max_retries=2)

    eid = new_id("exam")
    exam_obj["id"] = eid
    title = str(exam_obj.get("title") or f"{kp[:16]} · 随堂测验")
    stu_path = compile_exam_docx(exam_obj, eid, edition="student")
    tea_path = compile_exam_docx(exam_obj, eid, edition="teacher")
    stu_art = upsert_artifact(
        None,
        title=f"{title}（学生卷）",
        category="docx_exam_student",
        module="exam",
        filename=stu_path.name,
        file_path=str(stu_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=stu_path.stat().st_size,
        meta={"exam_id": eid},
    )
    tea_art = upsert_artifact(
        None,
        title=f"{title}（教师解析卷）",
        category="docx_exam_teacher",
        module="exam",
        filename=tea_path.name,
        file_path=str(tea_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=tea_path.stat().st_size,
        meta={"exam_id": eid},
    )
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO exams (id, title, subject, grade_level, exam_json, student_artifact_id, teacher_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (eid, title, str(exam_obj.get("subject") or subject), str(exam_obj.get("grade_level") or grade), json.dumps(exam_obj, ensure_ascii=False), stu_art["id"], tea_art["id"], now, now),
        )
    ctx["artifacts"]["exam_id"] = eid
    qs = exam_obj.get("questions") or []
    return {
        "ok": True,
        "summary": f"已组卷《{title}》（共 {len(qs)} 题，满分 {exam_obj.get('total_score', 30)} 分，支持直接在线作答）。",
        "context_text": f"试卷《{title}》首题：{qs[0].get('stem', '') if qs else ''}",
        "linked_item": {
            "kind": "exam",
            "id": eid,
            "title": title,
            "subtitle": f"{len(qs)} 题 · 满分 {exam_obj.get('total_score', 30)} 分",
            "artifact_id": stu_art["id"],
            "download_url": stu_art["download_url"],
        },
        "auto_repaired": repaired_cnt > 0,
    }


async def tool_build_remediation_quiz(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    topics = args.get("topics") or []
    count = int(args.get("count") or 4)
    res = await create_remediation_quiz(topic_tags=topics, count=count)
    rec = res["exam_record"]
    ctx["artifacts"]["exam_id"] = rec["id"]
    return {
        "ok": True,
        "summary": f"已结合学习记录薄弱点生成靶向巩固卷《{rec['title']}》（覆盖：{'、'.join(res['target_topics'])}）。",
        "context_text": f"巩固小测《{rec['title']}》，可直接点击进入在线作答。",
        "linked_item": {
            "kind": "exam",
            "id": rec["id"],
            "title": rec["title"],
            "subtitle": f"薄弱点靶向巩固 · {len(rec['exam']['questions'])} 题",
            "artifact_id": rec["student_artifact_id"],
            "download_url": res["student_artifact"]["download_url"],
        },
        "auto_repaired": False,
    }


async def tool_solve_question(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    question = str(args.get("question") or ctx.get("goal") or "").strip()
    subject = str(args.get("subject") or "高中数学")
    grade = str(args.get("grade_level") or "高二年级")
    prompt = (
        f"学科：{subject} ｜ 学段：{grade}\n问题：\n{question}\n"
        + (f"\n参考资料：\n{ctx.get('shared_context', '')[:2500]}\n" if ctx.get("shared_context") else "")
        + '\n严格输出合法 JSON：{"topic_tag": "...", "known_conditions": ["..."], "missing_condition_check": {"has_ambiguity": false, "prompt": "..."}, "hints": [{"level": 1, "title": "...", "content": "..."}], "steps": [{"step": 1, "title": "...", "derivation": "...", "theorem_basis": "..."}], "final_answer": "...", "sympy_checks": [], "evidence_checks": []}'
    )
    parsed, _ = await call_llm_json(
        system_prompt="你是严谨的学科答疑助手，需分步给出清晰解答与依据，只输出合法 JSON。",
        user_prompt=prompt,
        max_tokens=4500,
        temperature=0.15,
    )
    parsed, verification = await verify_and_repair_tutor_solution(
        question=question,
        subject=subject,
        parsed=parsed,
        max_retries=2,
    )
    session_id = new_id("tut")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO tutor_sessions (id, subject, grade_level, question_text, result_json, verification_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, subject, grade, question, json.dumps(parsed, ensure_ascii=False), json.dumps(verification, ensure_ascii=False), time.time()),
        )
    ctx["artifacts"]["tutor_session_id"] = session_id
    return {
        "ok": True,
        "summary": f"已完成解题与核对（{verification.get('badge', '已完成核查')}）：{parsed.get('final_answer', '')}",
        "context_text": f"解题结论：{parsed.get('final_answer', '')}",
        "linked_item": {
            "kind": "tutor",
            "id": session_id,
            "title": str(parsed.get("topic_tag") or question[:24]),
            "subtitle": verification.get("badge", "已完成核对"),
            "question_text": question,
            "subject": subject,
            "grade_level": grade,
        },
        "auto_repaired": bool(verification.get("auto_repaired")),
    }


async def tool_craft_course(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    from routers.courses import _pick_cover_for_text, _pick_preset_for_text, _recompute_progress, _topic_to_course_payload

    prefs = get_teacher_preferences()
    topic = str(args.get("topic") or ctx.get("goal") or "专题系统课程").strip()
    subject = str(args.get("subject") or prefs.get("preferred_subject", "高中数学"))
    grade = str(args.get("grade_level") or prefs.get("preferred_grade", "高二年级"))
    mode = "teaching" if str(args.get("mode") or "") == "teaching" else "self_study"
    cover = _pick_cover_for_text(topic)
    preset = _pick_preset_for_text(topic)
    cid = new_id("crs")
    now = time.time()

    payload = _topic_to_course_payload(
        {
            "title": topic[:36],
            "subject": subject,
            "grade_level": grade,
            "board_punchline": str(ctx.get("shared_context") or f"围绕「{topic}」建立系统框架、白板推演与随堂检测。")[:120],
            "teaching_flow": [
                f"1. 核心直观引入：梳理「{topic}」的关键概念与适用范围",
                "2. 标准推理与反例：拆解关键步骤并排查常见误区",
                "3. 变式综合演练：完成阶梯自测题组并检验结论",
            ],
            "pitfalls_and_counterexamples": ["忽略定义前提或约束条件", "缺少端点与临界情况核对"],
        },
        course_id=cid,
        cover_image=cover,
        preset=preset,
    )

    try:
        crafted, _ = await call_llm_json(
            system_prompt="你是课程结构设计师。请将学习主题拆成 2 个紧凑单元（每单元 2 讲），文字平实简明，公式用 `$...$`。输出 JSON：{\"title\":\"...\",\"description\":\"...\",\"units\":[{\"unit_index\":1,\"title\":\"...\",\"summary\":\"...\",\"lectures\":[{\"title\":\"...\",\"summary\":\"...\",\"duration_min\":16,\"board_blocks\":[{\"heading\":\"...\",\"lines\":[\"...\",\"...\"],\"highlight_note\":\"...\"}],\"opening_dialogue\":\"...\",\"quiz\":{\"question\":\"...\",\"options\":[\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"],\"answer\":\"A\",\"explanation\":\"...\"}}]}]}",
            user_prompt=f"主题：{topic} ｜ 学科：{subject} ｜ 学段：{grade}\n背景资料：{str(ctx.get('shared_context') or '')[:1200]}",
            max_tokens=3600,
            temperature=0.2,
        )
        if isinstance(crafted, dict) and crafted.get("units"):
            payload["title"] = str(crafted.get("title") or payload["title"])[:36]
            payload["description"] = str(crafted.get("description") or payload["description"])
            units_norm = []
            for ui, u in enumerate(crafted["units"][:3], start=1):
                lecs_norm = []
                for li, l in enumerate((u.get("lectures") or [])[:3], start=1):
                    lid = f"lec_{cid}_{ui}_{li}"
                    blks = [
                        {
                            "id": f"blk_{ui}_{li}_{bi}",
                            "heading": str(b.get("heading") or f"要点 {bi}"),
                            "lines": [str(x) for x in (b.get("lines") or [])][:4],
                            "highlight_note": str(b.get("highlight_note") or ""),
                        }
                        for bi, b in enumerate((l.get("board_blocks") or [])[:3], start=1)
                    ]
                    if not blks:
                        blks = [{"id": f"blk_{ui}_{li}_1", "heading": str(l.get("title") or "核心板书"), "lines": [str(l.get("summary") or "按核心步骤推导与检验")], "highlight_note": "先定范围再求解"}]
                    q_raw = l.get("quiz")
                    q_items = []
                    if isinstance(q_raw, dict) and q_raw.get("question"):
                        q_items.append({
                            "id": f"q_{ui}_{li}_1",
                            "question": str(q_raw["question"]),
                            "options": [str(o) for o in (q_raw.get("options") or [])][:4],
                            "answer": str(q_raw.get("answer") or "A")[:1].upper(),
                            "explanation": str(q_raw.get("explanation") or ""),
                        })
                    lecs_norm.append({
                        "id": lid,
                        "title": str(l.get("title") or f"第 {li} 讲"),
                        "summary": str(l.get("summary") or ""),
                        "kind": "quiz" if (q_items and li == len(u.get("lectures") or [])) else "lecture",
                        "mastery": "unstarted",
                        "duration_min": int(l.get("duration_min") or 16),
                        "visualizer_preset": preset,
                        "board_pages": [{"page_index": 1, "roadmap_title": "本讲学习路线", "blocks": blks}],
                        "messages": [{"id": new_id("wmsg"), "role": "assistant", "content": str(l.get("opening_dialogue") or f"欢迎来到《{l.get('title', '本讲')}》，左侧已列出核心板书要点。"), "board_anchor_id": blks[0]["id"], "created_at": now}],
                        "quiz_items": q_items,
                    })
                units_norm.append({"unit_index": ui, "title": str(u.get("title") or f"第 {ui} 单元"), "summary": str(u.get("summary") or ""), "lectures": lecs_norm})
            if units_norm:
                payload["units"] = units_norm
    except Exception:
        pass

    pct, status, _ = _recompute_progress(payload["units"])
    first_lid = payload["units"][0]["lectures"][0]["id"] if payload["units"] and payload["units"][0].get("lectures") else ""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO courses (
                id, title, subtitle, subject, grade_level, curator, source_label, cover_image,
                status, progress_pct, mode, description, units_json, cheatsheet_json,
                linked_ids_json, weekly_sessions_json, last_lecture_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, '知学工作台 · 协同建课', '快速协同创建', ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?)
            """,
            (
                cid,
                payload["title"],
                payload["subtitle"],
                payload["subject"],
                payload["grade_level"],
                cover,
                status,
                pct,
                mode,
                payload["description"],
                json.dumps(payload["units"], ensure_ascii=False),
                json.dumps(payload["cheatsheet"], ensure_ascii=False),
                first_lid,
                now,
                now,
            ),
        )
    ctx["artifacts"]["course_id"] = cid
    return {
        "ok": True,
        "summary": f"已创建课程《{payload['title']}》（含 {len(payload['units'])} 个单元，支持直接进入互动白板学习）。",
        "context_text": f"课程《{payload['title']}》已纳入我的课程库。",
        "linked_item": {
            "kind": "course",
            "id": cid,
            "title": payload["title"],
            "subtitle": f"{payload['subject']} · {len(payload['units'])} 个单元",
        },
        "auto_repaired": False,
    }


async def tool_generate_cheatsheet(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    from routers.courses import CustomCheatsheetReq, generate_custom_cheatsheet

    prefs = get_teacher_preferences()
    topic = str(args.get("topic") or ctx.get("goal") or "核心要点复习").strip()
    subject = str(args.get("subject") or prefs.get("preferred_subject", "高中数学"))
    grade = str(args.get("grade_level") or prefs.get("preferred_grade", "高二年级"))
    res = await generate_custom_cheatsheet(CustomCheatsheetReq(topic=topic, subject=subject, grade_level=grade))
    cs_obj = res["cheatsheet"]
    return {
        "ok": True,
        "summary": f"已生成高密度速查表《{cs_obj.get('title', topic)}》（含 {len(cs_obj.get('sections') or [])} 个板块，支持一键打印）。",
        "context_text": f"速查表《{cs_obj.get('title', topic)}》已就绪。",
        "linked_item": {
            "kind": "cheatsheet",
            "id": f"cs_{int(time.time())}",
            "title": str(cs_obj.get("title") or f"{topic} · 重点速查表"),
            "subtitle": str(cs_obj.get("subtitle") or f"{subject} · {grade}"),
            "cheatsheet_data": cs_obj,
        },
        "auto_repaired": False,
    }


async def tool_schedule_study_plan(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    from routers.tutor import StudyPlanRequest, create_study_plan

    title = str(args.get("title") or ctx.get("goal") or "7日专项提升计划").strip()[:32]
    goal = str(args.get("goal") or ctx.get("goal") or f"围绕「{title}」每日定量突破").strip()[:120]
    raw_topics = args.get("weak_topics") or [title]
    topics = [str(t).strip() for t in raw_topics if str(t).strip()] or [title]
    mins = max(15, min(180, int(args.get("daily_minutes") or 40)))
    res = await create_study_plan(StudyPlanRequest(title=title, goal=goal, weak_topics=topics, daily_minutes=mins))
    plan = res["plan"]
    docx_art = plan["docx_artifact"]
    ctx["artifacts"]["plan_id"] = plan["id"]
    return {
        "ok": True,
        "summary": f"已制定 7 日学习计划《{title}》，并自动排入每日学习日历（每日 {mins} 分钟）。",
        "context_text": f"7日计划《{title}》已入库并生成打卡表与日历待办。",
        "linked_item": {
            "kind": "plan",
            "id": plan["id"],
            "title": title,
            "subtitle": f"7日学习流待办 · 每日 {mins} 分钟",
            "artifact_id": docx_art["id"],
            "download_url": docx_art["download_url"],
        },
        "auto_repaired": False,
    }


TOOL_REGISTRY = {
    "search_materials": tool_search_materials,
    "search_topics": tool_search_topics,
    "verify_math": tool_verify_math,
    "create_mindmap": tool_create_mindmap,
    "create_or_edit_lesson": tool_create_or_edit_lesson,
    "create_or_edit_slides": tool_create_or_edit_slides,
    "assemble_exam": tool_assemble_exam,
    "build_remediation_quiz": tool_build_remediation_quiz,
    "solve_question": tool_solve_question,
    "craft_course": tool_craft_course,
    "generate_cheatsheet": tool_generate_cheatsheet,
    "schedule_study_plan": tool_schedule_study_plan,
}
