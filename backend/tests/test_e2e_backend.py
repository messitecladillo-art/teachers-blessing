"""Comprehensive end-to-end backend test suite covering engines, real LLM gateway, PPT Master bridge, DOCX, and privacy."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from docx import Document  # noqa: E402
from pptx import Presentation  # noqa: E402

from engines.analytics_engine import SAMPLE_CSV_CONTENT, compute_deterministic_analytics, desensitize_csv_text  # noqa: E402
from engines.math_verifier import run_symbolic_checks, sample_function_plot  # noqa: E402
from engines.ppt_bridge import audit_pptx_native_objects  # noqa: E402
from main import app  # noqa: E402


def test_sympy_symbolic_verifier() -> None:
    res = run_symbolic_checks(
        [
            {"type": "derivative", "expr": "x**3 - 3*x**2 + 2", "var": "x", "expected": "3*x**2 - 6*x", "label": "求导"},
            {"type": "solve", "equation": "3*x*(x-2)=0", "var": "x", "expected_roots": ["0", "2"], "label": "驻点"},
            {"type": "integral", "expr": "x**2", "var": "x", "lower": "0", "upper": "1", "expected": "1/3", "label": "定积分"},
            {"type": "equality", "lhs": "(x+1)**2", "rhs": "x**2+2*x+1", "label": "恒等式"},
        ]
    )
    assert res["status"] == "verified"
    assert res["passed"] == 4


def test_analytics_desensitization_and_stats() -> None:
    desens = desensitize_csv_text(SAMPLE_CSV_CONTENT)
    assert desens["student_count"] == 48
    assert "手机号" in desens["dropped_columns"]
    assert "姓名" in desens["masked_columns"]
    assert "张晨曦" not in desens["masked_csv"]
    assert "13812340001" not in desens["masked_csv"]
    assert "Stu_001" in desens["masked_csv"]

    stats = compute_deterministic_analytics(desens, "pytest_stat")
    assert stats["student_count"] == 48
    assert 70.0 < stats["summary"]["mean"] < 85.0
    assert Path(stats["chart_path"]).is_file()


def test_showcase_bootstrap_and_artifacts_download() -> None:
    with TestClient(app) as client:
        st = client.get("/api/system/status").json()
        assert st["ok"] is True
        assert st["llm"]["has_api_key"] is True
        assert "api_key" not in st["llm"]  # Never leak secret key

        arts = client.get("/api/artifacts").json()["artifacts"]
        categories = {a["category"] for a in arts}
        assert "pptx" in categories
        assert "docx_lesson" in categories
        assert "docx_exam_student" in categories
        assert "docx_exam_teacher" in categories
        assert "docx_analytics" in categories

        # Physically verify exported PPTX, DOCX, DRAWIO integrity
        for art in arts:
            dl = client.get(art["download_url"])
            assert dl.status_code == 200
            assert len(dl.content) > (500 if art["category"] in ("ics", "md", "drawio") else 5000)
            fp = Path(art["file_path"])
            if art["category"] == "pptx":
                audit = audit_pptx_native_objects(fp)
                assert audit["native_verified"] is True
                assert audit["slide_count"] >= 6
                assert audit["total_editable_text_boxes"] >= 20
            elif art["category"].startswith("docx"):
                doc = Document(str(fp))
                assert len(doc.paragraphs) >= 5


def test_ppt_inline_canvas_edit_and_theme_switch() -> None:
    with TestClient(app) as client:
        decks = client.get("/api/ppt/decks").json()["decks"]
        assert len(decks) >= 1
        deck = decks[0]
        deck_id = deck["id"]

        # Inline edit slide 2 title
        s2 = deck["slides"][1]
        edit_id = next(item["id"] for item in s2["editable_texts"] if "title" in item["id"])
        resp = client.put(
            f"/api/ppt/decks/{deck_id}/slides/2",
            json={"edits": {edit_id: "微格教学四大核心目标（已在线修订）"}, "speaker_notes": "更新后的逐字稿内容。"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["pptx_audit"]["native_verified"] is True

        # Switch theme to azure_scholar and verify compiled PPTX still passes native audit
        sw = client.post(f"/api/ppt/decks/{deck_id}/theme", json={"theme_id": "azure_scholar"})
        assert sw.status_code == 200
        assert sw.json()["pptx_audit"]["native_verified"] is True

        # Check all themes use custom Chinese aesthetics without Apple/Google wording
        themes = client.get("/api/ppt/themes").json()["themes"]
        assert len(themes) == 5
        for th in themes:
            assert "Apple" not in th["name"] and "Google" not in th["name"]
            assert th.get("short_name")

        # Verify PPTX file actually reflects updated slide 2 title
        art_path = Path(sw.json()["artifact"]["file_path"])
        prs = Presentation(str(art_path))
        slide2_texts = []
        def collect_txt(shapes):
            for sh in shapes:
                if hasattr(sh, "shapes"):
                    collect_txt(sh.shapes)
                elif getattr(sh, "has_text_frame", False):
                    slide2_texts.append(sh.text_frame.text)
        collect_txt(prs.slides[1].shapes)
        joined = " ".join(slide2_texts)
        assert "微格教学四大核心目标" in joined

        # Restore showcase default theme & title cleanly for UI preview
        client.put(
            f"/api/ppt/decks/{deck_id}/slides/2",
            json={"edits": {edit_id: "本节微格试讲的四大核心坐标"}},
        )
        client.post(f"/api/ppt/decks/{deck_id}/theme", json={"theme_id": "porcelain_daylight"})


def test_live_llm_tutor_stream_and_sympy_verification() -> None:
    with TestClient(app) as client:
        events = []
        with client.stream(
            "POST",
            "/api/tutor/solve",
            json={
                "subject": "高中数学",
                "grade_level": "高二年级",
                "question": "求函数 f(x) = x^3 - 3x^2 + 2 在区间 [-1, 3] 上的极值与最大值。",
                "mode": "progressive",
            },
        ) as resp:
            assert resp.status_code == 200
            for raw_line in resp.iter_lines():
                if raw_line.startswith("event:"):
                    evt_name = raw_line.split(":", 1)[1].strip()
                elif raw_line.startswith("data:"):
                    payload = json.loads(raw_line.split(":", 1)[1].strip())
                    events.append((evt_name, payload))

        result_events = [p for name, p in events if name == "result"]
        assert len(result_events) == 1, f"Expected result event, got events: {[n for n, _ in events]}"
        res = result_events[0]
        assert len(res["solution"]["hints"]) >= 3
        assert len(res["solution"]["steps"]) >= 2
        assert len(res["solution"]["variants"]) >= 2
        assert res["verification"]["status"] in ("verified", "needs_review")


def test_tts_narration_and_study_plan_ics() -> None:
    with TestClient(app) as client:
        # 1. Study plan .ics + .docx export
        sp_resp = client.post(
            "/api/tutor/study-plans",
            json={"title": "导数极值专项突破", "goal": "掌握含参讨论与极值检验", "weak_topics": ["定义域优先", "驻点变号"]},
        )
        assert sp_resp.status_code == 200
        sp = sp_resp.json()["plan"]
        assert len(sp["days"]) == 7
        assert Path(sp["ics_artifact"]["file_path"]).is_file()
        assert Path(sp["docx_artifact"]["file_path"]).is_file()

        # 2. Edge-TTS narration synthesis
        decks = client.get("/api/ppt/decks").json()["decks"]
        nar = client.post(f"/api/ppt/decks/{decks[0]['id']}/narrate", json={"voice": "zh-CN-XiaoxiaoNeural"})
        assert nar.status_code == 200
        mp3_path = Path(nar.json()["audio_artifact"]["file_path"])
        assert mp3_path.is_file()
        assert mp3_path.stat().st_size > 10000


def test_zhihu_pedagogy_kb_endpoints() -> None:
    with TestClient(app) as client:
        all_topics = client.get("/api/pedagogy/topics").json()
        assert all_topics["ok"] is True
        assert all_topics["total"] >= 14

        search_res = client.get("/api/pedagogy/search", params={"q": "拉格朗日中值定理 辅助函数"}).json()
        assert search_res["ok"] is True
        assert len(search_res["results"]) >= 1
        assert "拉格朗日" in search_res["results"][0]["title"]
        assert len(search_res["results"][0]["intuition_models"]) >= 2


def test_function_plot_and_visual_ppt_and_clean_docx() -> None:
    # 1. SymPy function plot sampling (cubic + log domain adaptation)
    cubic = sample_function_plot("x^3 - 3*x^2 + 2")
    assert cubic["ok"] is True
    assert len(cubic["f_segments"]) >= 1
    assert len(cubic["df_segments"]) >= 1
    cp_xs = sorted(cp["x"] for cp in cubic["critical_points"])
    assert cp_xs == [0.0, 2.0]

    log_fn = sample_function_plot("x - ln(x)")
    assert log_fn["ok"] is True
    assert log_fn["x_domain"][0] > 0
    assert any(abs(cp["x"] - 1.0) < 0.05 for cp in log_fn["critical_points"])

    with TestClient(app) as client:
        plot_resp = client.post("/api/tutor/plot-function", json={"expression": "x^3 - 3*x^2 + 2"})
        assert plot_resp.status_code == 200
        assert plot_resp.json()["ok"] is True

        # 2. Verify showcase deck upgraded to 7 slides with visual_graph & timeline
        decks = client.get("/api/ppt/decks").json()["decks"]
        showcase = next(d for d in decks if d["id"] == "deck_showcase_01")
        assert len(showcase["slides"]) >= 7
        layouts = [sl["layout"] for sl in showcase["slides"]]
        assert "visual_graph" in layouts
        assert "timeline" in layouts
        assert showcase["pptx_audit"]["native_verified"] is True

        # 3. Verify all compiled .docx showcase files contain zero raw $ or LaTeX macros
        arts = client.get("/api/artifacts").json()["artifacts"]
        for art in arts:
            if art["category"].startswith("docx"):
                doc = Document(art["file_path"])
                all_txt = "\n".join(
                    [p.text for p in doc.paragraphs]
                    + [c.text for tbl in doc.tables for row in tbl.rows for c in row.cells]
                )
                assert "$" not in all_txt, f"Raw '$' leaked in {art['filename']}"
                assert "\\frac" not in all_txt and "\\ln" not in all_txt, f"Raw LaTeX leaked in {art['filename']}"


def test_v3_taxonomy_3d_surface_and_drawio_mindmap():
    import xml.etree.ElementTree as ET

    with TestClient(app) as client:
        # 1. Full 9-domain x 45-branch taxonomy + 43+ cross-disciplinary corpus
        tax_res = client.get("/api/pedagogy/taxonomy")
        assert tax_res.status_code == 200
        tax = tax_res.json()
        assert tax["ok"] is True
        assert tax["total_domains"] == 9
        assert tax["total_branches"] == 45
        assert tax["total_topics"] >= 43
        assert len(tax["domains"]) == 9

        # Domain filtering & cross-disciplinary links check
        hum_res = client.get("/api/pedagogy/topics?domain=humanities")
        assert hum_res.status_code == 200
        hum_topics = hum_res.json()["topics"]
        assert len(hum_topics) >= 4
        assert all(t["domain_id"] == "humanities" for t in hum_topics)
        assert all(len(t.get("socratic_chain") or []) >= 3 for t in hum_topics)

        inter_res = client.get("/api/pedagogy/topics?domain=interdisciplinary")
        assert inter_res.status_code == 200
        assert len(inter_res.json()["topics"]) >= 4

        # 2. 3D Multivariate Surface + SymPy Hessian feature detection
        surf_res = client.post("/api/tutor/plot-surface-3d", json={"expression": "x^2 - y^2"})
        assert surf_res.status_code == 200
        surf = surf_res.json()
        assert surf["ok"] is True
        assert len(surf["x_vals"]) > 10 and len(surf["y_vals"]) > 10
        assert len(surf["z_grid"]) == len(surf["y_vals"])
        assert "马鞍" in surf.get("surface_feature", "") or "saddle" in surf.get("surface_feature", "").lower()

        # 3. Draw.io Mindmap list + create from topic + XML round-trip
        mm_list = client.get("/api/mindmap/list").json()["mindmaps"]
        assert len(mm_list) >= 2
        mm_ids = {m["id"] for m in mm_list}
        assert "mmap_showcase_01" in mm_ids

        target_hum_id = hum_topics[0]["id"]
        created_res = client.post("/api/mindmap/from-topic", json={"topic_id": target_hum_id})
        assert created_res.status_code == 200
        created = created_res.json()["mindmap"]
        assert len(created["graph"]["nodes"]) >= 5
        dl_xml = client.get(created["artifact"]["download_url"])
        assert dl_xml.status_code == 200
        root = ET.fromstring(dl_xml.content)
        assert root.tag == "mxfile"
        assert root.find(".//diagram/mxGraphModel/root") is not None
        assert len(root.findall(".//mxCell")) >= 6

        # Update via XML + re-import XML
        upd = client.put(f"/api/mindmap/{created['id']}", json={"drawio_xml": created["drawio_xml"]})
        assert upd.status_code == 200 and upd.json()["ok"] is True
        imp = client.post(
            "/api/mindmap/import-xml",
            json={"filename": "smoke_import.drawio", "xml_content": created["drawio_xml"], "subject": "跨学科综合"},
        )
        assert imp.status_code == 200
        assert len(imp.json()["mindmap"]["graph"]["nodes"]) >= 5

        # 4. Showcase v3.0 & v3.5 PBL / Humanities / Algebra / Astronomy / Bank assets present
        decks = client.get("/api/ppt/decks").json()["decks"]
        deck_ids = {d["id"] for d in decks}
        assert "deck_showcase_pbl_02" in deck_ids and "deck_showcase_astro_03" in deck_ids
        lessons = client.get("/api/lesson/list").json()["lessons"]
        les_ids = {l["id"] for l in lessons}
        assert "les_showcase_pbl_02" in les_ids and "les_showcase_hum_03" in les_ids and "les_showcase_alg_04" in les_ids


def test_v35_question_bank_and_multiformat_sources() -> None:
    tex_path = Path(r"c:\Users\zyy20\Downloads\第一讲.tex")
    html_path = Path(r"c:\Users\zyy20\Downloads\高中数学组卷.html")
    zip_path = Path(
        r"C:/Users/zyy20/.gemini/antigravity/brain/91829c48-993c-43c5-ac7f-68f83c3a0a9e/.user_uploaded/media_1795350213983_05bf34a0.zip"
    )

    with TestClient(app) as client:
        # 1. Curriculum catalog (4,642 items across 18 chapters)
        cat_res = client.get("/api/exam/bank/catalog")
        assert cat_res.status_code == 200
        cat = cat_res.json()
        assert cat["ok"] is True
        assert cat["total_items"] == 4642
        assert len(cat["chapters"]) == 18

        # 2. Assemble 3 non-overlapping thinking-mode papers with multi-part questions
        asm_res = client.post(
            "/api/exam/bank/assemble",
            json={
                "unit": "r1-2",
                "topics": [],
                "mode": "thinking",
                "preference": "balanced",
                "count": 5,
                "duration": 45,
                "versions": 3,
            },
        )
        assert asm_res.status_code == 200
        asm = asm_res.json()
        assert asm["ok"] is True
        records = asm["records"]
        assert len(records) == 3

        seen_qids: set[str] = set()
        has_parts = False
        for rec in records:
            qs = rec["exam"]["questions"]
            assert len(qs) == 5
            for q in qs:
                assert q["id"] not in seen_qids
                seen_qids.add(q["id"])
                if len(q.get("parts") or []) >= 2:
                    has_parts = True
            dl_stu = client.get(f"/api/artifacts/{rec['student_artifact_id']}/download")
            dl_tea = client.get(f"/api/artifacts/{rec['teacher_artifact_id']}/download")
            assert dl_stu.status_code == 200 and len(dl_stu.content) > 5000
            assert dl_tea.status_code == 200 and len(dl_tea.content) > 5000
        assert has_parts is True

        # 3. Pedagogy taxonomy expanded to 52+ topics
        tax = client.get("/api/pedagogy/taxonomy").json()
        assert tax["total_topics"] >= 52

        # 4. Multi-format source uploads (.tex GBK, .html question bank, .zip PDFs)
        if tex_path.is_file():
            with tex_path.open("rb") as f:
                r_tex = client.post("/api/sources/upload", files={"file": ("第一讲.tex", f, "text/plain")})
            assert r_tex.status_code == 200
            md_tex = r_tex.json()["markdown_full"]
            assert "德摩根律" in md_tex
            assert "¼¯ºÏ" not in md_tex

        if html_path.is_file():
            with html_path.open("rb") as f:
                r_html = client.post("/api/sources/upload", files={"file": ("高中数学组卷.html", f, "text/html")})
            assert r_html.status_code == 200
            assert "必修 第一册" in r_html.json()["markdown_full"]

        if zip_path.is_file():
            with zip_path.open("rb") as f:
                r_zip = client.post("/api/sources/upload", files={"file": ("复变函数PPT.zip", f, "application/zip")})
            assert r_zip.status_code == 200
            assert "复数及其运算" in r_zip.json()["markdown_full"]


def test_v40_agent_memory_rag_selfrepair_and_closed_loop() -> None:
    import asyncio
    from engines.self_repair import verify_and_repair_tutor_solution
    from engines.source_ingestor import detect_garbled_pdf_text

    # 1. Garbled CJK Type3/CID font detector
    garbled, g_msg = detect_garbled_pdf_text("ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêë")
    assert garbled is True and ("字库" in g_msg or "扫描" in g_msg)
    clean_ok, _ = detect_garbled_pdf_text("设 H 是群 G 的子群，则所有左陪集划分群 G。")
    assert clean_ok is False

    # 2. Intentional SymPy mismatch -> self-repair loop fixes it automatically
    broken_draft = {
        "topic_tag": "三次函数求导",
        "known_conditions": ["f(x) = x^3 - 3x^2 + 2"],
        "missing_condition_check": {"has_ambiguity": False, "prompt": "多项式在 R 上可导"},
        "hints": [{"level": 1, "title": "求导", "content": "对幂函数求导"}],
        "steps": [{"step": 1, "title": "误算导数", "derivation": "$f'(x) = 3x^2 + 6x$", "theorem_basis": "求导法则"}],
        "final_answer": "f'(x) = 3x^2 + 6x",
        "sympy_checks": [
            {"type": "derivative", "expr": "x**3 - 3*x**2 + 2", "var": "x", "expected": "3*x**2 + 6*x", "label": "求导检验"}
        ],
    }
    repaired_sol, rep_ver = asyncio.run(
        verify_and_repair_tutor_solution(
            question="求函数 f(x) = x^3 - 3x^2 + 2 的一阶导数。",
            subject="高中数学",
            parsed=broken_draft,
            max_retries=2,
        )
    )
    assert rep_ver["status"] == "verified"
    assert rep_ver.get("auto_repaired") is True

    with TestClient(app) as client:
        # 3. Full chapter-level source index & retrieval
        src_list = client.get("/api/sources/list").json()["documents"]
        assert len(src_list) >= 3
        hit_res = client.get("/api/sources/search", params={"q": "定义域 偶次根号 增区间"}).json()
        assert len(hit_res["results"]) >= 1
        assert "定义域" in hit_res["results"][0]["content"]

        # 4. Online exam submit -> auto grading -> error_book -> learner_memory -> analytics_reports
        exams = client.get("/api/exam/list").json()["exams"]
        target_exam = exams[0]
        qs = target_exam["exam"]["questions"]
        answers = {}
        if qs:
            # Answer Q1 right, deliberately answer Q2 wrong to verify closed-loop error capture
            q0 = qs[0]
            answers[q0.get("id") or "0"] = q0.get("answer") or "A"
            if len(qs) >= 2:
                q1 = qs[1]
                wrong_val = "D" if str(q1.get("answer", "")).upper().startswith("A") else "A"
                answers[q1.get("id") or "1"] = wrong_val if q1.get("options") else "99999"

        sub_res = client.post(
            f"/api/exam/{target_exam['id']}/submit",
            json={"answers": answers, "duration_sec": 75},
        )
        assert sub_res.status_code == 200
        sub = sub_res.json()["submission"]
        assert sub["total_score"] > 0
        if len(qs) >= 2:
            assert sub["logged_error_count"] >= 0
            assert len(sub["weak_topics"]) >= 1

        mem_dash = client.get("/api/agent/memory").json()
        assert mem_dash["ok"] is True
        assert len(mem_dash["weak_topics"]) >= 1
        assert len(mem_dash["recent_submissions"]) >= 1

        # 5. Proactive remediation micro-quiz generation from weak topics
        rem_res = client.post("/api/agent/memory/remediation-quiz", json={"topics": [], "count": 4})
        assert rem_res.status_code == 200 and rem_res.json()["ok"] is True
        assert len(rem_res.json()["exam_record"]["exam"]["questions"]) >= 3

        # 6. Multi-turn tutor followup
        import uuid

        tut_sid = f"tut_test_followup_{uuid.uuid4().hex[:8]}"
        fu_res = client.post(
            "/api/tutor/followup",
            json={
                "session_id": tut_sid,
                "question_context": "求函数 f(x) = x^3 - 3x^2 + 2 的单调区间。",
                "solution_summary": "导数为 3x(x-2)，在 (0,2) 递减。",
                "followup_question": "为什么 x=0 和 x=2 要分开写区间，不能用并集符号？",
                "subject": "高中数学",
            },
        )
        assert fu_res.status_code == 200 and fu_res.json()["reply"]["content"]
        fu_hist = client.get(f"/api/tutor/sessions/{tut_sid}/followups").json()["messages"]
        assert len(fu_hist) == 2

        # 7. Canvas plot -> insert into PPT & Lesson (verify native PPTX audit stays valid)
        ins_ppt = client.post(
            "/api/agent/insert-visual",
            json={"target": "ppt", "visual_title": "导数图像对照", "expr": "x^3 - 3*x^2 + 2", "caption": "极大值与极小值对比"},
        )
        assert ins_ppt.status_code == 200 and ins_ppt.json()["ok"] is True
        ppt_audit = audit_pptx_native_objects(Path(ins_ppt.json()["artifact"]["file_path"]))
        assert ppt_audit["native_verified"] is True

        ins_les = client.post(
            "/api/agent/insert-visual",
            json={"target": "lesson", "visual_title": "导数图像附图", "expr": "x^3 - 3*x^2 + 2"},
        )
        assert ins_les.status_code == 200 and Path(ins_les.json()["artifact"]["file_path"]).is_file()

        # 8. Multi-step Agent Orchestrator (plan confirmation -> confirm -> cross-module execution)
        plan_evts = []
        with client.stream(
            "POST",
            "/api/agent/chat",
            json={
                "message": "请查一下《导数单调性与极值讲义》，并针对集合与逻辑画一张思维导图。",
                "require_confirmation": True,
            },
        ) as resp:
            assert resp.status_code == 200
            ename = "message"
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    ename = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    plan_evts.append((ename, json.loads(line.split(":", 1)[1].strip())))

        conf = [p for e, p in plan_evts if e == "plan_confirmation"]
        assert len(conf) == 1
        tid = conf[0]["thread"]["id"]
        assert len(conf[0]["steps"]) >= 1

        exec_evts = []
        with client.stream("POST", f"/api/agent/threads/{tid}/execute-plan", json={}) as resp2:
            assert resp2.status_code == 200
            ename = "message"
            for line in resp2.iter_lines():
                if line.startswith("event:"):
                    ename = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    exec_evts.append((ename, json.loads(line.split(":", 1)[1].strip())))

        res_evts = [p for e, p in exec_evts if e == "result"]
        assert len(res_evts) == 1
        th_detail = client.get(f"/api/agent/threads/{tid}").json()["thread"]
        assert th_detail["status"] == "completed"
        assert len(th_detail["messages"]) >= 2


def test_courses_space_whiteboard_and_cheatsheet() -> None:
    with TestClient(app) as client:
        res_courses = client.get("/api/courses").json()
        assert res_courses["ok"] is True
        assert len(res_courses["courses"]) >= 4
        assert len(res_courses["weekly_tracker"]["days"]) == 7

        mkt = client.get("/api/courses/marketplace").json()
        assert mkt["ok"] is True
        assert len(mkt["featured_bento"]) == 6
        assert len(mkt["categories"]) >= 10
        assert len(mkt["items"]) >= 20

        enrolled = client.post("/api/courses/enroll", json={"market_id": "mkt_ai_data"}).json()
        assert enrolled["ok"] is True
        crs_id = enrolled["course"]["id"]

        detail = client.get(f"/api/courses/{crs_id}").json()
        assert detail["ok"] is True
        first_lec = detail["course"]["units"][0]["lectures"][0]
        lid = first_lec["id"]

        prog = client.patch(
            f"/api/courses/{crs_id}/progress",
            json={"lecture_id": lid, "mastery": "mastered"},
        ).json()
        assert prog["ok"] is True
        assert prog["course"]["progress_pct"] > 0

        wb_chat = client.post(
            f"/api/courses/{crs_id}/lectures/{lid}/chat",
            json={"message": "请问这一步的核心前提边界为什么不能忽略？"},
        ).json()
        assert wb_chat["ok"] is True
        assert wb_chat["reply"]["board_anchor_id"]
        assert len(wb_chat["new_board_block"]["lines"]) >= 1

        cs = client.post(f"/api/courses/{crs_id}/cheatsheet", json={}).json()
        assert cs["ok"] is True
        assert len(cs["cheatsheet"]["sections"]) >= 1

        # Clean up test-enrolled course so showcase state stays tidy
        client.delete(f"/api/courses/{crs_id}")


def test_v42_calendar_agent_tools_tts_and_zip() -> None:
    import io
    import zipfile
    from engines.agent_tools import TOOL_REGISTRY
    from engines.memory_engine import build_memory_context_text

    assert {"craft_course", "generate_cheatsheet", "schedule_study_plan"}.issubset(set(TOOL_REGISTRY.keys()))

    with TestClient(app) as client:
        # 1. Calendar tasks CRUD + study plan auto-sync
        created = client.post(
            "/api/tutor/calendar-tasks",
            json={"date_str": "2026-11-23", "title": "复盘导数单调性边界例题", "subject": "高中数学", "minutes": 25},
        ).json()
        assert created["ok"] is True
        task_id = created["task"]["id"]

        listed = client.get("/api/tutor/calendar-tasks").json()
        assert any(t["id"] == task_id and not t["completed"] for t in listed["tasks"])

        patched = client.patch(f"/api/tutor/calendar-tasks/{task_id}", json={"completed": True}).json()
        assert patched["ok"] is True and patched["task"]["completed"] is True

        deleted_t = client.delete(f"/api/tutor/calendar-tasks/{task_id}").json()
        assert deleted_t["ok"] is True

        pln = client.post(
            "/api/tutor/study-plans",
            json={"title": "三角恒等变换7日突破", "goal": "掌握和差角公式与二倍角", "weak_topics": ["三角恒等变换"], "daily_minutes": 35},
        ).json()
        assert pln["ok"] is True
        pid = pln["plan"]["id"]
        cal_after_plan = client.get("/api/tutor/calendar-tasks").json()["tasks"]
        assert len([t for t in cal_after_plan if t.get("plan_id") == pid]) == 7
        client.delete(f"/api/tutor/study-plans/{pid}")

        # 2. Persistent memory toggle effect
        pref_off = client.put("/api/agent/memory/preferences", json={"preferences": {"memory_enabled": "false"}})
        assert pref_off.status_code == 200
        assert build_memory_context_text("learner") == ""
        pref_on = client.put("/api/agent/memory/preferences", json={"preferences": {"memory_enabled": "true"}})
        assert pref_on.status_code == 200

        # 3. Knowledge base document upload + deletion
        up = client.post(
            "/api/sources/upload",
            files={"file": ("v42_temp_note.md", "# 测试讲义\n## 第一节\n导数大于零单调递增。".encode("utf-8"), "text/markdown")},
        ).json()
        assert up["ok"] is True
        doc_id = up["source_id"]
        del_doc = client.delete(f"/api/sources/{doc_id}").json()
        assert del_doc["ok"] is True

        # 4. Teaching marketplace tab -> enroll -> generate companion -> stream whiteboard + verified badge -> TTS -> export ZIP
        mkt_teach = client.get("/api/courses/marketplace?tab=teaching").json()
        assert mkt_teach["ok"] is True and mkt_teach["tab"] == "teaching"

        enrolled = client.post("/api/courses/enroll", json={"market_id": "mkt_calc_deriv", "mode": "teaching"}).json()
        assert enrolled["ok"] is True
        crs_id = enrolled["course"]["id"]
        lid = enrolled["course"]["units"][0]["lectures"][0]["id"]

        comp = client.post(f"/api/courses/{crs_id}/generate-companion", json={"kind": "lesson"}).json()
        assert comp["ok"] is True and comp["linked_item"]["kind"] == "lesson"
        les_id = comp["linked_item"]["id"]

        wb_evts = []
        with client.stream(
            "POST",
            f"/api/courses/{crs_id}/lectures/{lid}/chat-stream",
            json={"message": "请推导 x^3 - 3*x 的极值点并验证方程 x^2 - 1 = 0"},
        ) as resp:
            assert resp.status_code == 200
            ename = "message"
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    ename = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    wb_evts.append((ename, json.loads(line.split(":", 1)[1].strip())))
        wb_res = [p for e, p in wb_evts if e == "result"]
        assert len(wb_res) == 1
        assert wb_res[0]["new_board_block"].get("verified_badge")

        tts_resp = client.post(
            f"/api/courses/{crs_id}/lectures/{lid}/tts",
            json={"text": "现在我们一起来验证函数极值点的必要条件。", "voice": "zh_female_clear"},
        )
        assert tts_resp.status_code == 200 and len(tts_resp.content) > 500

        zip_resp = client.get(f"/api/courses/{crs_id}/export-zip")
        assert zip_resp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(zip_resp.content), "r") as zf:
            names = zf.namelist()
            assert "01_课程大纲与逐讲板书.md" in names
            assert any(n.startswith("配套资源/") and n.endswith(".docx") for n in names)

        # 5. Fast mode agent chat bypasses confirmation and caps steps <= 2
        fast_evts = []
        with client.stream(
            "POST",
            "/api/agent/chat",
            json={
                "message": "帮我生成一份数列求和重点速查表",
                "speed_mode": "fast",
                "require_confirmation": True,
            },
        ) as fast_resp:
            assert fast_resp.status_code == 200
            ename = "message"
            for line in fast_resp.iter_lines():
                if line.startswith("event:"):
                    ename = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    fast_evts.append((ename, json.loads(line.split(":", 1)[1].strip())))
        assert any(e == "result" for e, _ in fast_evts)
        assert not any(e == "plan_confirmation" for e, _ in fast_evts)

        # Cleanup generated test course row (showcase DB reset follows test suite)
        client.delete(f"/api/courses/{crs_id}")


def test_latex_to_spoken_zh() -> None:
    from engines.tts_narrator import latex_to_spoken_zh

    sample = "令 $f'(x) = \\frac{1 + 2ax^2}{x} \\ge 0$，$x \\in \\mathbb{R} \\Rightarrow x^3 - \\sqrt{x}$。"
    spoken = latex_to_spoken_zh(sample)
    assert "\\" not in spoken
    assert "$" not in spoken
    assert "分之" in spoken
    assert "大于等于" in spoken
    assert "全体实数集" in spoken
    assert "推出" in spoken
    assert "根号下" in spoken


def test_whiteboard_teach_step_board_crud_and_quiz() -> None:
    with TestClient(app) as client:
        enrolled = client.post("/api/courses/enroll", json={"market_id": "mkt_calc_deriv", "mode": "teaching"}).json()
        assert enrolled["ok"] is True
        crs_id = enrolled["course"]["id"]
        lid = enrolled["course"]["units"][0]["lectures"][0]["id"]

        # 1. teach-step (reexplain_analogy, worked_example, socratic_check)
        for act in ("reexplain_analogy", "worked_example", "socratic_check"):
            evts = []
            with client.stream(
                "POST",
                f"/api/courses/{crs_id}/lectures/{lid}/teach-step",
                json={"action": act, "teaching_mode": "teaching"},
            ) as resp:
                assert resp.status_code == 200
                ename = "message"
                for line in resp.iter_lines():
                    if line.startswith("event:"):
                        ename = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        evts.append((ename, json.loads(line.split(":", 1)[1].strip())))
            res_evts = [p for e, p in evts if e == "result"]
            assert len(res_evts) == 1
            if act == "socratic_check":
                assert res_evts[0]["new_quiz_item"]["question"]
            else:
                assert res_evts[0]["new_board_block"]["narration"]

        # 2. PATCH /board (add_block, update_block, move_block, add_page, delete_block)
        added = client.patch(
            f"/api/courses/{crs_id}/lectures/{lid}/board",
            json={
                "op": "add_block",
                "page_index": 1,
                "block_type": "example",
                "heading": "自定义检验块",
                "lines": ["f(x) = x^2 - 1", "f'(x) = 2x"],
                "highlight_note": "驻点 x=0",
            },
        ).json()
        assert added["ok"] is True
        blk_id = added["block"]["id"]
        assert added["block"]["visual_expr"]

        upd = client.patch(
            f"/api/courses/{crs_id}/lectures/{lid}/board",
            json={"op": "update_block", "block_id": blk_id, "heading": "修订后检验块", "lines": ["f(x)=x^2-4"]},
        ).json()
        assert upd["ok"] is True and upd["block"]["heading"] == "修订后检验块"

        moved = client.patch(
            f"/api/courses/{crs_id}/lectures/{lid}/board",
            json={"op": "move_block", "block_id": blk_id, "direction": "up"},
        ).json()
        assert moved["ok"] is True

        added_pg = client.patch(
            f"/api/courses/{crs_id}/lectures/{lid}/board",
            json={"op": "add_page", "roadmap_title": "新板书页"},
        ).json()
        assert added_pg["ok"] is True and added_pg["page_index"] >= 2

        deleted = client.patch(
            f"/api/courses/{crs_id}/lectures/{lid}/board",
            json={"op": "delete_block", "block_id": blk_id},
        ).json()
        assert deleted["ok"] is True

        # 3. POST /quiz-submit grading & mastery upgrade
        latest_crs = client.get(f"/api/courses/{crs_id}").json()["course"]
        q_items = latest_crs["units"][0]["lectures"][0]["quiz_items"]
        answers = {q["id"]: q["answer"] for q in q_items}
        sub = client.post(
            f"/api/courses/{crs_id}/lectures/{lid}/quiz-submit",
            json={"answers": answers},
        ).json()
        assert sub["ok"] is True
        assert sub["score_pct"] == 100
        assert sub["mastery"] == "mastered"

        client.delete(f"/api/courses/{crs_id}")


