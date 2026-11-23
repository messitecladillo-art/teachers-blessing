"""Courses, Marketplace, Interactive Whiteboard Classroom, and Printable Cheatsheet API."""

from __future__ import annotations

import datetime
import io
import json
import re
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm, call_llm_json, extract_json_payload
from core.sse import sse_event
from engines.knowledge_index import get_document_chunks, list_indexed_documents, search_source_chunks
from engines.math_verifier import extract_plottable_expression, verify_freeform_expression
from engines.memory_engine import record_learning_outcome
from engines.mindmap_engine import auto_layout_mindmap, build_mindmap_from_topic, compile_drawio_xml
from engines.pedagogy_kb import load_pedagogy_corpus
from engines.tts_narrator import synthesize_text_audio

router = APIRouter(prefix="/api/courses", tags=["courses"])

MASTERY_WEIGHTS: dict[str, float] = {
    "unstarted": 0.0,
    "attempted": 0.25,
    "familiar": 0.5,
    "proficient": 0.78,
    "mastered": 1.0,
}

MARKETPLACE_CATEGORIES = [
    "全部",
    "考试备考",
    "数学与统计",
    "物理与天文",
    "计算机与算法",
    "数据与智能",
    "化学与材料",
    "生命科学",
    "工程与交叉",
    "人文与社科",
    "教学法与表达",
]

FEATURED_BENTO_SPEC: list[dict[str, Any]] = [
    {
        "market_id": "mkt_calc_deriv",
        "size": "hero",
        "title": "函数单调性与导数进阶",
        "subject": "高中数学",
        "grade_level": "高二年级",
        "level": "进阶",
        "hours": "12 课时",
        "category": "数学与统计",
        "cover_image": "/assets/hk/course_calculus.png",
        "curator": "知学教研组",
        "description": "从几何切线直观出发，贯穿导数符号判定、含参分类讨论、极值与最值辨析及典型反例检验的完整进阶课程。",
        "visualizer_preset": "cubic",
        "topic_id": "zhihu_deriv_mono",
    },
    {
        "market_id": "mkt_alg_group",
        "size": "medium",
        "title": "抽象代数：群、陪集与商群",
        "subject": "高等代数",
        "grade_level": "大学数学",
        "level": "进阶",
        "hours": "18 课时",
        "category": "数学与统计",
        "cover_image": "/assets/hk/course_algebra.png",
        "curator": "知学教研组",
        "description": "用几何对称与陪集切分建立群论直观，梳理拉格朗日定理、正规子群与同态基本定理的证明脉络。",
        "visualizer_preset": "group_z6",
        "topic_id": "zhihu_abstract_coset",
    },
    {
        "market_id": "mkt_ai_data",
        "size": "medium",
        "title": "数据建模与算法思辨导论",
        "subject": "信息科技与算法",
        "grade_level": "高中选修 / 大学通识",
        "level": "入门",
        "hours": "16 课时",
        "category": "数据与智能",
        "cover_image": "/assets/hk/course_ai_data.png",
        "curator": "知学教研组",
        "description": "从决策树切分与信息熵指标讲起，结合泛化误差分解与可视化诊断，掌握实用机器学习与统计思维。",
        "visualizer_preset": "mindmap",
        "topic_id": "",
    },
    {
        "market_id": "mkt_complex_map",
        "size": "square",
        "title": "复变函数与解析映照",
        "subject": "复变函数",
        "grade_level": "大学数学",
        "level": "进阶",
        "hours": "20 课时",
        "category": "数学与统计",
        "cover_image": "/assets/hk/course_complex.png",
        "curator": "知学教研组",
        "description": "结合几何保角变换与多叶曲面直观，拆解柯西-黎曼方程、复积分与留数计算边界。",
        "visualizer_preset": "riemann",
        "topic_id": "",
    },
    {
        "market_id": "mkt_astro_ladder",
        "size": "square",
        "title": "天体力学与宇宙距离阶梯",
        "subject": "物理与天文",
        "grade_level": "高中 / 大学通识",
        "level": "入门",
        "hours": "14 课时",
        "category": "物理与天文",
        "cover_image": "/assets/hk/course_astro.png",
        "curator": "知学教研组",
        "description": "由地月潮汐锁定与开普勒面积定律入手，依次构建三角视差、造父变星周光律到深空测距体系。",
        "visualizer_preset": "kepler",
        "topic_id": "",
    },
    {
        "market_id": "mkt_humanities_pbl",
        "size": "square",
        "title": "学术写作与微格教学设计",
        "subject": "教学法与写作",
        "grade_level": "师范生通用",
        "level": "进阶",
        "hours": "15 课时",
        "category": "教学法与表达",
        "cover_image": "/assets/hk/course_humanities.png",
        "curator": "知学教研组",
        "description": "围绕 15 分钟微格试讲节奏、板书设计金句与论证结构组织，提升课堂讲授清晰度与材料驾驭力。",
        "visualizer_preset": "",
        "topic_id": "",
    },
]

_DOMAIN_TO_CATEGORY: dict[str, str] = {
    "math": "数学与统计",
    "physics": "物理与天文",
    "chemistry": "化学与材料",
    "biology": "生命科学",
    "cs_ai": "计算机与算法",
    "humanities": "人文与社科",
    "social_geo_econ": "人文与社科",
    "pedagogy": "教学法与表达",
    "interdisciplinary": "工程与交叉",
}

_DOMAIN_COVER_IMAGE: dict[str, str] = {
    "math": "/assets/hk/course_calculus.png",
    "physics": "/assets/hk/course_astro.png",
    "chemistry": "/assets/hk/course_complex.png",
    "biology": "/assets/hk/course_complex.png",
    "cs_ai": "/assets/hk/course_ai_data.png",
    "humanities": "/assets/hk/course_humanities.png",
    "social_geo_econ": "/assets/hk/course_humanities.png",
    "pedagogy": "/assets/hk/course_humanities.png",
    "interdisciplinary": "/assets/hk/course_algebra.png",
}


def _today_str() -> str:
    return datetime.date.today().isoformat()


def _recompute_progress(units: list[dict[str, Any]]) -> tuple[int, str, dict[str, Any] | None]:
    total = 0
    score_sum = 0.0
    next_lec: dict[str, Any] | None = None
    for unit in units:
        u_idx = int(unit.get("unit_index") or 1)
        for lec in unit.get("lectures") or []:
            total += 1
            m = str(lec.get("mastery") or "unstarted")
            score_sum += MASTERY_WEIGHTS.get(m, 0.0)
            if next_lec is None and m != "mastered":
                next_lec = {
                    "id": str(lec.get("id") or ""),
                    "title": str(lec.get("title") or ""),
                    "kind": str(lec.get("kind") or "lecture"),
                    "unit_index": u_idx,
                }
    if total == 0:
        return 0, "in_progress", None
    pct = min(100, max(0, int(round((score_sum / total) * 100))))
    status = "completed" if pct >= 95 else "in_progress"
    if next_lec is None and units and (units[0].get("lectures") or []):
        first = units[0]["lectures"][0]
        next_lec = {
            "id": str(first.get("id") or ""),
            "title": str(first.get("title") or ""),
            "kind": str(first.get("kind") or "lecture"),
            "unit_index": int(units[0].get("unit_index") or 1),
        }
    return pct, status, next_lec


def _row_to_course(row: Any) -> dict[str, Any]:
    d = dict(row)
    units = json.loads(d.pop("units_json") or "[]")
    cheatsheet = json.loads(d.pop("cheatsheet_json") or "{}")
    linked_ids = json.loads(d.pop("linked_ids_json") or "{}")
    weekly_sessions = json.loads(d.pop("weekly_sessions_json") or "{}")
    pct, computed_status, next_lec = _recompute_progress(units)
    d["units"] = units
    d["cheatsheet"] = cheatsheet
    d["linked_ids"] = linked_ids
    d["weekly_sessions"] = weekly_sessions
    d["progress_pct"] = pct if units else int(d.get("progress_pct") or 0)
    d["status"] = computed_status if units else d.get("status", "in_progress")
    d["next_lecture"] = next_lec
    return d


def _build_weekly_tracker(courses: list[dict[str, Any]]) -> dict[str, Any]:
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    day_names = ["一", "二", "三", "四", "五", "六", "日"]
    counts_by_date: dict[str, int] = {}
    for c in courses:
        for dt_key, val in (c.get("weekly_sessions") or {}).items():
            counts_by_date[dt_key] = counts_by_date.get(dt_key, 0) + int(val or 0)

    days = []
    total_sessions = 0
    for i in range(7):
        day_dt = (monday + datetime.timedelta(days=i)).isoformat()
        cnt = counts_by_date.get(day_dt, 0)
        total_sessions += cnt
        days.append({"label": day_names[i], "date": day_dt, "count": cnt, "is_today": day_dt == today.isoformat()})

    continue_learning = None
    in_prog = [c for c in courses if c.get("status") != "completed"] or courses
    if in_prog:
        top = in_prog[0]
        target_lec = None
        last_id = top.get("last_lecture_id") or ""
        for u in top.get("units") or []:
            for l in u.get("lectures") or []:
                if l.get("id") == last_id:
                    target_lec = l
                    break
        if target_lec is None and top.get("next_lecture"):
            target_lec = top["next_lecture"]
        if target_lec:
            continue_learning = {
                "course_id": top["id"],
                "course_title": top["title"],
                "lecture_id": target_lec["id"],
                "lecture_title": target_lec["title"],
                "kind": target_lec.get("kind", "lecture"),
            }

    return {
        "total_sessions": total_sessions,
        "days": days,
        "continue_learning": continue_learning,
    }


def _topic_to_course_payload(topic: dict[str, Any], *, course_id: str, cover_image: str, preset: str = "") -> dict[str, Any]:
    title = str(topic.get("title") or "专题课程").split("：")[0][:36]
    subject = str(topic.get("subject") or "综合学科")
    grade = str(topic.get("grade_level") or "通用学段")
    models = topic.get("intuition_models") or []
    flow = topic.get("teaching_flow") or [
        "1. 现象与直观引入：建立核心概念的几何或生活图景",
        "2. 严谨定理拆解：明晰适用前提、关键公式与步骤顺序",
        "3. 反例辨析与巩固：识别常见误区并完成变式练习",
    ]
    pitfalls = topic.get("pitfalls_and_counterexamples") or ["注意隐含前提条件与边界情形讨论"]
    punch = str(topic.get("board_punchline") or f"围绕{title}抓住核心条件与检验步骤。")

    u1_l1_blocks = [
        {
            "id": "blk_intro",
            "heading": f"一、{title}直观建立",
            "lines": [
                m.get("name", "核心视角") + "：" + m.get("desc", "")
                for m in (models[:2] or [{"name": "概念切入", "desc": str(topic.get("micro_teaching_hook") or f"从实际情境理解{title}的本质。")}])
            ],
            "highlight_note": punch,
        },
        {
            "id": "blk_flow",
            "heading": "二、核心推演路线",
            "lines": [str(step) for step in flow[:3]],
            "highlight_note": f"核心公式参考：{topic.get('core_formula_latex') or '按定义与约束分步检验'}",
        },
    ]

    u1_l2_blocks = [
        {
            "id": "blk_trap",
            "heading": "一、高频反例与边界警示",
            "lines": [str(pf) for pf in pitfalls[:3]],
            "highlight_note": "遇到临界点或特殊值务必单独代入检验。",
        }
    ]

    u2_l1_blocks = [
        {
            "id": "blk_ext",
            "heading": "一、跨情境迁移与应用",
            "lines": [
                f"{lk.get('domain', '相关领域')} · {lk.get('title', title)}：{lk.get('mechanism', '')}"
                for lk in (topic.get("interdisciplinary_links") or [{"domain": "方法迁移", "title": title, "mechanism": punch}])
            ],
            "highlight_note": punch,
        }
    ]

    now = time.time()
    units = [
        {
            "unit_index": 1,
            "title": "核心概念与直观理解",
            "summary": "从直观图景出发，掌握定义前提与基础判定规则。",
            "lectures": [
                {
                    "id": f"lec_{course_id}_1_1",
                    "title": f"{title}的核心脉络",
                    "summary": str(flow[0]) if flow else f"梳理{title}的核心定义与直观视角。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 18,
                    "visualizer_preset": preset or ("cubic" if "导数" in title else ""),
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "本节课路线图",
                            "blocks": u1_l1_blocks,
                        }
                    ],
                    "messages": [
                        {
                            "id": new_id("wmsg"),
                            "role": "assistant",
                            "content": f"欢迎进入《{title}》课堂。左侧板书已经整理好直观模型与推导顺序。\n\n我们先从第一个关键问题切入：{models[0]['desc'] if models else flow[0]}",
                            "board_anchor_id": "blk_intro",
                            "created_at": now,
                        },
                        {
                            "id": new_id("wmsg"),
                            "role": "assistant",
                            "content": f"梳理完直觉后，可以按右侧步骤依次推演，特别注意：{punch} 你可以随时在下方输入追问。",
                            "board_anchor_id": "blk_flow",
                            "created_at": now + 1,
                        },
                    ],
                    "quiz_items": [
                        {
                            "id": "q1",
                            "question": f"在运用《{title}》相关结论时，最容易忽略的首要步骤是哪一项？",
                            "options": [
                                "A. 先核对定义域或定理成立的前提条件",
                                "B. 直接套用结论后再猜想结果",
                                "C. 只关注特殊数值而跳过一般情况",
                                "D. 省略边界点的单独验证",
                            ],
                            "answer": "A",
                            "explanation": "任何定理或判定步骤均需优先核对适用前提与定义域边界。",
                        }
                    ],
                },
                {
                    "id": f"lec_{course_id}_1_2",
                    "title": "典型反例与边界排查",
                    "summary": "剖析易错混淆点，用反例巩固概念边界。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 15,
                    "visualizer_preset": preset,
                    "board_pages": [{"page_index": 1, "roadmap_title": "易错点排查路线图", "blocks": u1_l2_blocks}],
                    "messages": [
                        {
                            "id": new_id("wmsg"),
                            "role": "assistant",
                            "content": f"这一讲聚焦最常见的理解误区：{pitfalls[0]}。试着用一个具体反例检查自己的直觉是否严谨。",
                            "board_anchor_id": "blk_trap",
                            "created_at": now,
                        }
                    ],
                    "quiz_items": [
                        {
                            "id": "q1",
                            "question": "针对易错边界问题，最稳妥的排查习惯是？",
                            "options": [
                                "A. 用典型反例验证端点或临界点是否满足条件",
                                "B. 仅依赖图形大致轮廓做判断",
                                "C. 忽略分段边界处的变化情况",
                                "D. 默认所有特殊点性质一致",
                            ],
                            "answer": "A",
                            "explanation": "反例检验与临界点单独验算能有效避免概念滑坡。",
                        }
                    ],
                },
            ],
        },
        {
            "unit_index": 2,
            "title": "综合推演与迁移应用",
            "summary": "将核心规律迁移至复杂变式与跨学科问题情境。",
            "lectures": [
                {
                    "id": f"lec_{course_id}_2_1",
                    "title": f"{title}跨情境应用",
                    "summary": "打通相邻知识点与实际背景建模联系。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 20,
                    "visualizer_preset": preset,
                    "board_pages": [{"page_index": 1, "roadmap_title": "综合应用路线图", "blocks": u2_l1_blocks}],
                    "messages": [
                        {
                            "id": new_id("wmsg"),
                            "role": "assistant",
                            "content": f"本讲我们把《{title}》放回真实应用与跨学科背景中看它的作用。你觉得它和哪些日常现象或相邻单元关系最紧密？",
                            "board_anchor_id": "blk_ext",
                            "created_at": now,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        },
    ]

    cheatsheet = {
        "title": f"{title} · 考前速查表",
        "subtitle": f"{subject} · {grade}",
        "sections": [
            {
                "title": "核心结论与判定流程",
                "badge": "必记框架",
                "items": [
                    {
                        "term": st.split("：")[0][:18],
                        "formula_or_rule": st,
                        "highlight_color": "blue" if idx == 0 else "yellow",
                        "trap_note": "按序核对前提与结论方向",
                    }
                    for idx, st in enumerate(flow[:3])
                ],
            },
            {
                "title": "常见误区与反例清单",
                "badge": "避坑提示",
                "items": [
                    {
                        "term": f"误区提醒 {idx + 1}",
                        "formula_or_rule": pf,
                        "highlight_color": "yellow",
                        "trap_note": punch,
                    }
                    for idx, pf in enumerate(pitfalls[:3])
                ],
            },
        ],
    }

    return {
        "id": course_id,
        "title": title,
        "subtitle": str(topic.get("domain_name") or subject),
        "subject": subject,
        "grade_level": grade,
        "curator": "知学教研组",
        "source_label": "知学精品库",
        "cover_image": cover_image,
        "description": str(topic.get("micro_teaching_hook") or punch),
        "units": units,
        "cheatsheet": cheatsheet,
    }


def _pick_cover_for_text(text: str) -> str:
    low = (text or "").lower()
    if any(k in low for k in ("代数", "矩阵", "群", "向量", "linear", "algebra")):
        return "/assets/hk/course_algebra.png"
    if any(k in low for k in ("复变", "几何", "黎曼", "化学", "生物", "complex")):
        return "/assets/hk/course_complex.png"
    if any(k in low for k in ("物理", "天文", "行星", "潮汐", "力学", "physics", "astro")):
        return "/assets/hk/course_astro.png"
    if any(k in low for k in ("算法", "数据", "程序", "python", "ai", "机器学习", "统计")):
        return "/assets/hk/course_ai_data.png"
    if any(k in low for k in ("历史", "文学", "哲学", "写作", "语文", "经济", "试讲", "教案")):
        return "/assets/hk/course_humanities.png"
    return "/assets/hk/course_calculus.png"


def _pick_preset_for_text(text: str) -> str:
    low = (text or "").lower()
    if any(k in low for k in ("群", "陪集", "模", "同余", "矩阵")):
        return "group_z6"
    if any(k in low for k in ("复变", "解析", "曲面", "偏导", "多元")):
        return "riemann"
    if any(k in low for k in ("对数", "ln", "极值", "单调", "导数", "微积分")):
        return "cubic"
    if any(k in low for k in ("行星", "引力", "潮汐", "天体")):
        return "kepler"
    return ""


class EnrollReq(BaseModel):
    market_id: str
    mode: str = "self_study"


class CraftCourseReq(BaseModel):
    prompt: str
    mode: str = "self_study"  # self_study | teaching
    depth: str = "fast"  # fast | deep
    source_doc_ids: list[str] = []


class GenerateCompanionReq(BaseModel):
    kind: str  # lesson | ppt | exam


class LectureTTSReq(BaseModel):
    text: str = ""
    voice: str = "zh_female_clear"


class ExpandCourseReq(BaseModel):
    note: str = ""
    source_id: str = ""


class UpdateProgressReq(BaseModel):
    lecture_id: str
    mastery: str = "mastered"


class CourseUpdateReq(BaseModel):
    title: str | None = None
    description: str | None = None


class WhiteboardChatReq(BaseModel):
    message: str


class CheatsheetReq(BaseModel):
    focus_unit: int | None = None


class CustomCheatsheetReq(BaseModel):
    topic: str
    subject: str = "高中数学"
    grade_level: str = "高二年级"


@router.get("")
async def list_courses_endpoint(status: str = "all", q: str = "") -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM courses ORDER BY updated_at DESC").fetchall()
    all_courses = [_row_to_course(r) for r in rows]
    tracker = _build_weekly_tracker(all_courses)

    filtered = []
    q_low = (q or "").strip().lower()
    for c in all_courses:
        if status == "in_progress" and c.get("status") != "in_progress":
            continue
        if status == "completed" and c.get("status") != "completed":
            continue
        if q_low:
            hay = f"{c['title']} {c['subject']} {c['description']} {c['curator']}".lower()
            if q_low not in hay:
                continue
        filtered.append(c)

    return {"ok": True, "courses": filtered, "weekly_tracker": tracker}


@router.get("/marketplace")
async def get_marketplace_endpoint(category: str = "全部", q: str = "", tab: str = "curated") -> dict[str, Any]:
    topics = load_pedagogy_corpus()
    items: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    is_teaching = (tab or "curated").strip().lower() == "teaching"

    for b in FEATURED_BENTO_SPEC:
        seen_titles.add(b["title"])
        desc = b["description"]
        hours = b["hours"]
        curator = b["curator"]
        if is_teaching:
            desc = f"【教学备课包】含板书路线图、教案要点与随堂检测｜{b['description']}"
            hours = f"{b['hours']} · 备课模板"
            curator = "知学教研备课库"
        items.append(
            {
                "market_id": b["market_id"],
                "title": b["title"],
                "subject": b["subject"],
                "grade_level": b["grade_level"],
                "level": b["level"],
                "hours": hours,
                "category": b["category"],
                "cover_image": b["cover_image"],
                "curator": curator,
                "description": desc,
                "featured": True,
                "size": b["size"],
                "mode": "teaching" if is_teaching else "self_study",
            }
        )

    for idx, t in enumerate(topics):
        clean_title = str(t.get("title") or "").split("：")[0][:36]
        if not clean_title or clean_title in seen_titles:
            continue
        seen_titles.add(clean_title)
        dom = str(t.get("domain_id") or "math")
        cat = _DOMAIN_TO_CATEGORY.get(dom, "数学与统计")
        if idx % 7 == 0 and dom in ("math", "physics"):
            cat_extra = "考试备考"
        else:
            cat_extra = cat
        raw_desc = str(t.get("board_punchline") or t.get("micro_teaching_hook") or "")[:88]
        items.append(
            {
                "market_id": f"topic_{t['id']}",
                "title": clean_title,
                "subject": str(t.get("subject") or t.get("branch") or "学科专题"),
                "grade_level": str(t.get("grade_level") or "高二年级"),
                "level": "进阶" if "高二" in str(t.get("grade_level", "")) or "大学" in str(t.get("grade_level", "")) else "入门",
                "hours": f"{8 + (idx % 5) * 2} 课时" + (" · 含教案" if is_teaching else ""),
                "category": cat_extra,
                "extra_category": cat,
                "cover_image": _DOMAIN_COVER_IMAGE.get(dom, "/assets/hk/course_calculus.png"),
                "curator": "知学教研备课库" if is_teaching else "知学教研组",
                "description": f"【备课讲授模板】{raw_desc}" if is_teaching else raw_desc,
                "featured": False,
                "size": "card",
                "topic_id": t["id"],
                "mode": "teaching" if is_teaching else "self_study",
            }
        )

    if is_teaching:
        def _teach_rank(x: dict[str, Any]) -> tuple[int, int]:
            prio = 0 if x.get("category") in ("教学法与表达", "数学与统计", "考试备考") else 1
            return (prio, 0 if x.get("featured") else 1)

        items.sort(key=_teach_rank)

    q_low = (q or "").strip().lower()
    cat_filter = (category or "全部").strip()
    filtered_items = []
    for it in items:
        if cat_filter and cat_filter not in ("全部", "all"):
            if it["category"] != cat_filter and it.get("extra_category") != cat_filter:
                continue
        if q_low:
            hay = f"{it['title']} {it['subject']} {it['category']} {it['description']}".lower()
            if q_low not in hay:
                continue
        filtered_items.append(it)

    return {
        "ok": True,
        "tab": "teaching" if is_teaching else "curated",
        "categories": MARKETPLACE_CATEGORIES,
        "featured_bento": FEATURED_BENTO_SPEC,
        "items": filtered_items,
    }


@router.post("/enroll")
async def enroll_marketplace_course(req: EnrollReq) -> dict[str, Any]:
    mid = (req.market_id or "").strip()
    desired_mode = "teaching" if (req.mode or "").strip() == "teaching" else "self_study"
    spec = next((b for b in FEATURED_BENTO_SPEC if b["market_id"] == mid), None)
    topics = load_pedagogy_corpus()

    if spec and spec.get("topic_id"):
        topic = next((t for t in topics if t["id"] == spec["topic_id"]), None)
    elif mid.startswith("topic_"):
        tid = mid[len("topic_") :]
        topic = next((t for t in topics if t["id"] == tid), None)
    else:
        topic = None

    with get_conn() as conn:
        existing_rows = conn.execute("SELECT * FROM courses").fetchall()
        target_title = spec["title"] if spec else (str(topic.get("title", "")).split("：")[0][:36] if topic else "")
        for er in existing_rows:
            if target_title and er["title"] == target_title:
                if er["mode"] != desired_mode:
                    conn.execute(
                        "UPDATE courses SET mode = ?, updated_at = ? WHERE id = ?",
                        (desired_mode, time.time(), er["id"]),
                    )
                    er = conn.execute("SELECT * FROM courses WHERE id = ?", (er["id"],)).fetchone()
                return {"ok": True, "course": _row_to_course(er), "reused": True}

    cid = new_id("crs")
    now = time.time()
    if topic:
        payload = _topic_to_course_payload(
            topic,
            course_id=cid,
            cover_image=spec["cover_image"] if spec else _DOMAIN_COVER_IMAGE.get(topic.get("domain_id", "math"), "/assets/hk/course_calculus.png"),
            preset=spec["visualizer_preset"] if spec else _pick_preset_for_text(topic.get("title", "")),
        )
        if spec:
            payload["title"] = spec["title"]
            payload["description"] = spec["description"]
    elif spec:
        payload = _topic_to_course_payload(
            {
                "title": spec["title"],
                "subject": spec["subject"],
                "grade_level": spec["grade_level"],
                "domain_name": spec["category"],
                "board_punchline": spec["description"],
                "teaching_flow": [
                    f"1. 核心模型建构：理解《{spec['title']}》的直观原理",
                    "2. 方法步骤拆解：建立标准演算与检验程序",
                    "3. 综合迁移训练：打通高阶变式与实际应用场景",
                ],
                "pitfalls_and_counterexamples": [
                    "忽略定义的前提条件或约束区间",
                    "复杂步骤计算缺少交叉验算环节",
                ],
            },
            course_id=cid,
            cover_image=spec["cover_image"],
            preset=spec["visualizer_preset"],
        )
    else:
        raise HTTPException(status_code=404, detail="未找到对应的课程模板")

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO courses (
                id, title, subtitle, subject, grade_level, curator, source_label, cover_image,
                status, progress_pct, mode, description, units_json, cheatsheet_json,
                linked_ids_json, weekly_sessions_json, last_lecture_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', 0, ?, ?, ?, ?, '{}', '{}', ?, ?, ?)
            """,
            (
                cid,
                payload["title"],
                payload["subtitle"],
                payload["subject"],
                payload["grade_level"],
                payload["curator"],
                payload["source_label"],
                payload["cover_image"],
                desired_mode,
                payload["description"],
                json.dumps(payload["units"], ensure_ascii=False),
                json.dumps(payload["cheatsheet"], ensure_ascii=False),
                payload["units"][0]["lectures"][0]["id"],
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (cid,)).fetchone()
    log_telemetry("course", "enroll", verified_ok=True, meta={"market_id": mid})
    return {"ok": True, "course": _row_to_course(row)}


@router.post("/craft")
async def craft_course_stream(req: CraftCourseReq) -> StreamingResponse:
    prompt_text = (req.prompt or "").strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="请输入想学习的课程主题或说明")

    async def gen():
        t0 = time.time()
        try:
            yield sse_event("stage", {"stage": "analyze", "message": "正在解析课程目标与已选讲义资料…"})
            src_snippets: list[str] = []
            for did in req.source_doc_ids[:3]:
                chunks = get_document_chunks(did)
                for ch in chunks[:2]:
                    src_snippets.append(f"【{ch.get('chapter_title', '章节')}】{ch.get('content', '')[:320]}")
            if not src_snippets:
                hits = search_source_chunks(prompt_text, limit=2)
                for h in hits:
                    src_snippets.append(f"【{h.get('doc_title', '')} - {h.get('chapter_title', '')}】{h.get('content', '')[:320]}")

            src_ctx = "\n".join(src_snippets)
            mode_label = "教师备课与授课" if req.mode == "teaching" else "学生自主系统学习"
            unit_target = 4 if req.depth == "deep" else 3

            yield sse_event("stage", {"stage": "outline", "message": f"正在按{mode_label}模式编排 {unit_target} 个学习单元与讲次…"})

            sys_prompt = (
                "你是系统化课程结构设计师。请将用户的学习或备课主题转化为一份结构清晰的单元课程 JSON。\n"
                "注意：文字需平实精确，避免浮夸修辞，不得提及任何底层软件名。数学公式统一用 `$...$`。\n"
                "严格输出合法 JSON：\n"
                '{"title": "简练课程名(<=18字)", "subject": "学科", "grade_level": "学段", '
                '"description": "一句话说明课程覆盖目标", '
                '"units": [{"unit_index": 1, "title": "单元名", "summary": "单元简介", "lectures": ['
                '{"title": "讲次名", "summary": "1句话介绍本讲目标", "duration_min": 15, '
                '"board_blocks": [{"heading": "一、核心原理", "lines": ["要点1", "要点2"], "highlight_note": "板书要点"}], '
                '"opening_dialogue": "老师用第一人称启发式口吻开启本讲的2句对话", '
                '"quiz": {"question": "概念检验题", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "简明解析"}'
                ']}], '
                '"cheatsheet_sections": [{"title": "核心结论", "badge": "必记", "items": [{"term": "概念词", "formula_or_rule": "公式或规律", "highlight_color": "blue", "trap_note": "常见误区"}]}]}'
            )
            user_prompt = (
                f"学习模式：{mode_label}\n深度档位：{req.depth}\n用户主题：{prompt_text}\n"
                + (f"\n参考讲义片段：\n{src_ctx}\n" if src_ctx else "")
                + f"\n请生成 {unit_target} 个单元，每单元 2 个讲次。"
            )

            crafted: dict[str, Any] = {}
            try:
                crafted, _ = await call_llm_json(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    max_tokens=5500,
                    temperature=0.25,
                )
            except Exception:
                crafted = {}

            yield sse_event("stage", {"stage": "whiteboard", "message": "正在生成白板板书路线图与速查表…"})

            cid = new_id("crs")
            now = time.time()
            cover = _pick_cover_for_text(prompt_text)
            preset = _pick_preset_for_text(prompt_text)

            title = str(crafted.get("title") or prompt_text[:18]).strip()
            subject = str(crafted.get("subject") or "学科综合").strip()
            grade_level = str(crafted.get("grade_level") or "高中/大学通识").strip()
            description = str(crafted.get("description") or f"围绕「{prompt_text[:40]}」梳理的系统课程，涵盖概念直觉、分步推演、白板板书与随堂练习。").strip()

            raw_units = crafted.get("units") or []
            if not raw_units:
                raw_units = [
                    {
                        "unit_index": 1,
                        "title": "基础概念与直观建立",
                        "summary": f"建立对「{title}」的清晰直观图景与基本术语框架。",
                        "lectures": [
                            {
                                "title": f"{title}的核心脉络",
                                "summary": "梳理核心定义、适用边界与几何/现实直观模型。",
                                "duration_min": 18,
                                "board_blocks": [
                                    {"heading": "一、概念直观切入", "lines": [f"主题焦点：{prompt_text[:60]}", "核心要素拆解与边界辨析"], "highlight_note": "先定范围与条件，再套用规则"},
                                    {"heading": "二、标准推导骨架", "lines": ["1. 识别已知与目标关系", "2. 建立中间桥梁步骤", "3. 回代特殊情形复核"], "highlight_note": "每一步都写出依据"},
                                ],
                                "opening_dialogue": f"欢迎来到《{title}》第一讲。左侧板书列出了核心脉络，我们先从最基础的边界条件聊起：你在预习这一块时最容易卡在哪一步？",
                                "quiz": {
                                    "question": f"学习《{title}》时，面对复杂条件最优先的检查步骤是？",
                                    "options": ["A. 明确定义域或定理成立的前提范围", "B. 跳过前直接试数猜测", "C. 只背诵结论忽略适用场景", "D. 直接合并不同分段结论"],
                                    "answer": "A",
                                    "explanation": "明确前提边界是防止后续变形出错的关键步骤。",
                                },
                            },
                            {
                                "title": "常见误区与反例排查",
                                "summary": "通过反例对比强化概念边界。",
                                "duration_min": 15,
                                "board_blocks": [
                                    {"heading": "一、高频反例剖析", "lines": ["辨析充分条件与必要条件混淆", "边界临界值孤立检验清单"], "highlight_note": "反例最能测出理解盲区"}
                                ],
                                "opening_dialogue": "这一讲我们重点排查几个最常失分的陷阱。建议结合反例逐条比对。",
                            },
                        ],
                    },
                    {
                        "unit_index": 2,
                        "title": "方法迁移与综合演练",
                        "summary": "将核心规律应用至综合题目与跨知识点串联。",
                        "lectures": [
                            {
                                "title": f"{title}综合变式精讲",
                                "summary": "通过阶梯案例打通知识迁移。",
                                "duration_min": 20,
                                "board_blocks": [
                                    {"heading": "一、综合题拆解思路", "lines": ["拆解条件特征 -> 定位核心定理 -> 检验结论闭环"], "highlight_note": "多维变式不离核心主线"}
                                ],
                                "opening_dialogue": "基础理顺后，我们来看综合情境下如何灵活拆解条件。你可以在右侧直接抛出具体例题一起推导。",
                            }
                        ],
                    },
                ]

            units_norm: list[dict[str, Any]] = []
            for ui, u in enumerate(raw_units[:5], start=1):
                lecs_norm = []
                for li, l in enumerate((u.get("lectures") or [])[:4], start=1):
                    lid = f"lec_{cid}_{ui}_{li}"
                    blocks_in = l.get("board_blocks") or []
                    blocks_norm = []
                    for bi, blk in enumerate(blocks_in, start=1):
                        blocks_norm.append(
                            {
                                "id": f"blk_{ui}_{li}_{bi}",
                                "heading": str(blk.get("heading") or f"要点 {bi}"),
                                "lines": [str(ln) for ln in (blk.get("lines") or [])],
                                "highlight_note": str(blk.get("highlight_note") or ""),
                            }
                        )
                    if not blocks_norm:
                        blocks_norm = [
                            {
                                "id": f"blk_{ui}_{li}_1",
                                "heading": str(l.get("title") or "核心板书"),
                                "lines": [str(l.get("summary") or "按核心步骤推演与检验")],
                                "highlight_note": "注意检查边界条件",
                            }
                        ]
                    quiz_items = []
                    q_raw = l.get("quiz")
                    if isinstance(q_raw, dict) and q_raw.get("question"):
                        quiz_items.append(
                            {
                                "id": f"q_{ui}_{li}_1",
                                "question": str(q_raw["question"]),
                                "options": [str(o) for o in (q_raw.get("options") or [])][:4],
                                "answer": str(q_raw.get("answer") or "A"),
                                "explanation": str(q_raw.get("explanation") or ""),
                            }
                        )
                    lecs_norm.append(
                        {
                            "id": lid,
                            "title": str(l.get("title") or f"第 {li} 讲"),
                            "summary": str(l.get("summary") or ""),
                            "kind": "lecture",
                            "mastery": "unstarted",
                            "duration_min": int(l.get("duration_min") or 16),
                            "visualizer_preset": preset if (ui == 1 and li == 1) else "",
                            "board_pages": [
                                {
                                    "page_index": 1,
                                    "roadmap_title": "本节课路线图",
                                    "blocks": blocks_norm,
                                }
                            ],
                            "messages": [
                                {
                                    "id": new_id("wmsg"),
                                    "role": "assistant",
                                    "content": str(
                                        l.get("opening_dialogue")
                                        or f"欢迎来到《{l.get('title') or title}》。左侧板书已经列出本讲路线图，点击对话上方的板书标签即可定位对应推导块。"
                                    ),
                                    "board_anchor_id": blocks_norm[0]["id"],
                                    "created_at": now,
                                }
                            ],
                            "quiz_items": quiz_items,
                        }
                    )
                units_norm.append(
                    {
                        "unit_index": ui,
                        "title": str(u.get("title") or f"第 {ui} 单元"),
                        "summary": str(u.get("summary") or ""),
                        "lectures": lecs_norm,
                    }
                )

            cs_sections = crafted.get("cheatsheet_sections") or [
                {
                    "title": "核心结论速查",
                    "badge": "必记",
                    "items": [
                        {
                            "term": title[:16],
                            "formula_or_rule": description,
                            "highlight_color": "blue",
                            "trap_note": "优先核对适用前提",
                        }
                    ],
                }
            ]
            cheatsheet = {"title": f"{title} · 核心速查表", "subtitle": f"{subject} · {grade_level}", "sections": cs_sections}

            # Also build a matching mindmap linked to this course
            mm_id = ""
            try:
                mm_id = new_id("mmap")
                mm_graph = build_mindmap_from_topic(
                    {
                        "title": title,
                        "subject": subject,
                        "domain_name": subject,
                        "branch": grade_level,
                        "board_punchline": description,
                        "teaching_flow": [u["title"] for u in units_norm],
                        "intuition_models": [{"name": u["title"], "desc": u["summary"]} for u in units_norm[:2]],
                        "pitfalls_and_counterexamples": ["核对定义边界", "临界点检验"],
                    },
                    custom_title=title,
                )
                xml_str, xml_path = compile_drawio_xml(mm_graph, mm_id)
                mm_art = upsert_artifact(
                    None,
                    title=f"知识结构图：{title}",
                    category="drawio",
                    module="tutor",
                    filename=xml_path.name,
                    file_path=str(xml_path),
                    mime_type="application/xml",
                    size_bytes=xml_path.stat().st_size,
                    meta={"mindmap_id": mm_id},
                )
                with get_conn() as conn:
                    conn.execute(
                        """
                        INSERT INTO mindmaps (id, title, subject, domain_id, branch, graph_json, drawio_xml, artifact_id, created_at, updated_at)
                        VALUES (?, ?, ?, '', '', ?, ?, ?, ?, ?)
                        """,
                        (mm_id, title, subject, json.dumps(mm_graph, ensure_ascii=False), xml_str, mm_art["id"], now, now),
                    )
            except Exception:
                mm_id = ""

            linked_ids = {
                "mindmap_id": mm_id,
                "source_doc_ids": req.source_doc_ids,
            }
            first_lec_id = units_norm[0]["lectures"][0]["id"] if units_norm and units_norm[0]["lectures"] else ""

            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO courses (
                        id, title, subtitle, subject, grade_level, curator, source_label, cover_image,
                        status, progress_pct, mode, description, units_json, cheatsheet_json,
                        linked_ids_json, weekly_sessions_json, last_lecture_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, '知学工作台 · 自建课程', '我的课程生成', ?, 'in_progress', 0, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
                    """,
                    (
                        cid,
                        title,
                        f"{subject} · {grade_level}",
                        subject,
                        grade_level,
                        cover,
                        req.mode,
                        description,
                        json.dumps(units_norm, ensure_ascii=False),
                        json.dumps(cheatsheet, ensure_ascii=False),
                        json.dumps(linked_ids, ensure_ascii=False),
                        first_lec_id,
                        now,
                        now,
                    ),
                )
                row = conn.execute("SELECT * FROM courses WHERE id = ?", (cid,)).fetchone()

            dur_ms = int((time.time() - t0) * 1000)
            log_telemetry("course", "craft", duration_ms=dur_ms, verified_ok=True, meta={"course_id": cid})
            yield sse_event("result", {"course": _row_to_course(row), "duration_ms": dur_ms})
        except Exception as exc:
            yield sse_event("error", {"message": f"课程创建失败：{exc}"})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/{course_id}")
async def get_course_detail(course_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    all_docs = list_indexed_documents()
    src_ids = set((course.get("linked_ids") or {}).get("source_doc_ids") or [])
    materials = [d for d in all_docs if d["id"] in src_ids]
    if not materials:
        # Match by keyword if source_doc_ids wasn't explicitly set
        kw = course["title"][:4]
        materials = [d for d in all_docs if kw in d["title"] or course["subject"][:2] in d["title"]][:2]

    return {"ok": True, "course": course, "materials": materials}


@router.patch("/{course_id}")
async def update_course_meta(course_id: str, req: CourseUpdateReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课程不存在")
        new_title = (req.title or row["title"]).strip()[:60]
        new_desc = (req.description if req.description is not None else row["description"]).strip()
        conn.execute(
            "UPDATE courses SET title = ?, description = ?, updated_at = ? WHERE id = ?",
            (new_title, new_desc, time.time(), course_id),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    return {"ok": True, "course": _row_to_course(updated)}


@router.delete("/{course_id}")
async def delete_course(course_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="课程不存在")
    return {"ok": True}


@router.post("/{course_id}/expand")
async def expand_course_with_material(course_id: str, req: ExpandCourseReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    doc_title = ""
    doc_snippet = req.note.strip()
    if req.source_id:
        chunks = get_document_chunks(req.source_id)
        if chunks:
            doc_title = str(chunks[0].get("doc_title") or "")
            doc_snippet = "\n".join(ch.get("content", "")[:260] for ch in chunks[:3])

    if not doc_snippet and not doc_title:
        raise HTTPException(status_code=400, detail="请提供补充讲义文件或需要扩展的章节描述")

    now = time.time()
    next_idx = len(course["units"]) + 1
    lec_title = doc_title[:24] if doc_title else (req.note.strip()[:22] or f"拓展专题 {next_idx}")
    new_lid = f"lec_{course_id}_{next_idx}_1"
    lines = [ln.strip() for ln in doc_snippet.splitlines() if ln.strip()][:4] or [doc_snippet[:120]]

    new_unit = {
        "unit_index": next_idx,
        "title": f"拓展讲义：{lec_title}",
        "summary": "基于新增上传材料或拓展要求扩充的专题模块。",
        "lectures": [
            {
                "id": new_lid,
                "title": lec_title,
                "summary": lines[0][:80],
                "kind": "lecture",
                "mastery": "unstarted",
                "duration_min": 18,
                "visualizer_preset": _pick_preset_for_text(doc_snippet),
                "board_pages": [
                    {
                        "page_index": 1,
                        "roadmap_title": "拓展讲义路线图",
                        "blocks": [
                            {
                                "id": f"blk_{next_idx}_1_1",
                                "heading": f"一、{lec_title}核心提炼",
                                "lines": lines,
                                "highlight_note": "已同步纳入课程路线图",
                            }
                        ],
                    }
                ],
                "messages": [
                    {
                        "id": new_id("wmsg"),
                        "role": "assistant",
                        "content": f"已根据你补充的资料新增讲次《{lec_title}》，要点已同步板书至左侧画布。你可以直接进入深学或补充提问。",
                        "board_anchor_id": f"blk_{next_idx}_1_1",
                        "created_at": now,
                    }
                ],
                "quiz_items": [],
            }
        ],
    }

    units = list(course["units"]) + [new_unit]
    linked = dict(course.get("linked_ids") or {})
    if req.source_id:
        sids = list(linked.get("source_doc_ids") or [])
        if req.source_id not in sids:
            sids.append(req.source_id)
        linked["source_doc_ids"] = sids

    pct, status, _ = _recompute_progress(units)
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE courses
            SET units_json = ?, linked_ids_json = ?, progress_pct = ?, status = ?, updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(units, ensure_ascii=False), json.dumps(linked, ensure_ascii=False), pct, status, now, course_id),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    log_telemetry("course", "expand", verified_ok=True)
    return {"ok": True, "course": _row_to_course(updated)}


@router.patch("/{course_id}/progress")
async def update_lecture_progress(course_id: str, req: UpdateProgressReq) -> dict[str, Any]:
    if req.mastery not in MASTERY_WEIGHTS:
        raise HTTPException(status_code=400, detail="无效的掌握状态")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    found_title = ""
    units = list(course["units"])
    for u in units:
        for l in u.get("lectures") or []:
            if l.get("id") == req.lecture_id:
                l["mastery"] = req.mastery
                found_title = str(l.get("title") or "")
                break
    if not found_title:
        raise HTTPException(status_code=404, detail="讲次不存在")

    pct, status, _ = _recompute_progress(units)
    weekly = dict(course.get("weekly_sessions") or {})
    today_k = _today_str()
    weekly[today_k] = int(weekly.get(today_k, 0)) + 1

    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE courses
            SET units_json = ?, progress_pct = ?, status = ?, weekly_sessions_json = ?, last_lecture_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(units, ensure_ascii=False),
                pct,
                status,
                json.dumps(weekly, ensure_ascii=False),
                req.lecture_id,
                now,
                course_id,
            ),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()

    if req.mastery in ("mastered", "proficient", "attempted"):
        record_learning_outcome(
            topic_tag=found_title[:48],
            subject=course["subject"],
            grade_level=course["grade_level"],
            correct=(req.mastery in ("mastered", "proficient")),
            mistake_note="需重点巩固本讲边界与例题" if req.mastery == "attempted" else "",
        )

    return {"ok": True, "course": _row_to_course(updated)}


def _verify_whiteboard_math_snippet(msg_text: str, lines: list[str]) -> str:
    """Silently check symbolic identities/derivatives/equations and return verification badge text."""
    candidates: list[str] = []
    m_eq = re.search(r"([a-zA-Z0-9\^\*\+\-/\(\)\.\s]{2,}=[a-zA-Z0-9\^\*\+\-/\(\)\.\s]{1,})", msg_text or "")
    if m_eq:
        candidates.append(m_eq.group(1).strip())
    plottable = extract_plottable_expression(msg_text or "")
    if plottable and plottable[0]:
        candidates.append(plottable[0])
    for tex in re.findall(r"\$([^$]{3,48})\$", " ".join(lines or [])):
        if any(ch in tex for ch in ("=", "^", "+", "-", "*", "/")):
            candidates.append(tex.strip())

    for cand in candidates[:3]:
        try:
            v = verify_freeform_expression(cand)
            if v.get("status") == "verified" and v.get("badge"):
                return f"{v['badge']} · 已验算"
        except Exception:
            continue
    return ""


async def _run_whiteboard_chat_turn(course_id: str, lecture_id: str, msg_text: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    target_lec = None
    units = list(course["units"])
    for u in units:
        for l in u.get("lectures") or []:
            if l.get("id") == lecture_id:
                target_lec = l
                break
    if not target_lec:
        raise HTTPException(status_code=404, detail="讲次不存在")

    board_pages = target_lec.get("board_pages") or [{"page_index": 1, "roadmap_title": "本节课路线图", "blocks": []}]
    existing_blocks = board_pages[-1].get("blocks") or []
    board_summary = "\n".join(
        f"{b.get('heading', '')}: " + "；".join(b.get("lines") or [])
        for b in existing_blocks[-4:]
    )

    sys_prompt = (
        "你是白板课堂的一对一主讲老师。请针对学生追问，在回答的同时在左侧白板补充一块清晰简短的板书要点。\n"
        "要求：语言平实清晰，少用修辞，严禁出现底层工具或代码词；数学公式用 `$...$`。\n"
        "严格输出 JSON：\n"
        '{"reply": "面向学生的清晰回答(<=220字)", '
        '"board_block": {"heading": "补充板书标题(<=16字)", "lines": ["公式或推导关键步骤1", "对比或验证结论2"], "highlight_note": "一句话点睛"}}'
    )
    user_prompt = (
        f"课程：《{course['title']}》 | 讲次：《{target_lec['title']}》\n"
        f"当前白板内容：\n{board_summary}\n\n"
        f"学生追问：{msg_text}"
    )

    reply_text = ""
    new_blk: dict[str, Any] | None = None
    try:
        parsed, _ = await call_llm_json(
            system_prompt=sys_prompt,
            user_prompt=user_prompt,
            max_tokens=1600,
            temperature=0.25,
        )
        reply_text = str(parsed.get("reply") or "").strip()
        blk_in = parsed.get("board_block")
        if isinstance(blk_in, dict) and blk_in.get("lines"):
            blk_id = new_id("blk")
            new_blk = {
                "id": blk_id,
                "heading": str(blk_in.get("heading") or f"追问解析：{msg_text[:12]}"),
                "lines": [str(x) for x in (blk_in.get("lines") or [])][:4],
                "highlight_note": str(blk_in.get("highlight_note") or ""),
            }
    except Exception:
        pass

    if not reply_text:
        reply_text = f"关于“{msg_text[:36]}”，关键在于先把题目或结论里的约束条件拆出来，核对每一步推导的前提是否成立，再用简单特例代入验算一遍。已在左侧白板补充记录。"
    if new_blk is None:
        blk_id = new_id("blk")
        new_blk = {
            "id": blk_id,
            "heading": f"补充辨析：{msg_text[:14]}",
            "lines": [
                "先写出已知前提与适用范围",
                "逐步验算核心关系式并比对临界点",
            ],
            "highlight_note": "核对前提 -> 分步推演 -> 特例验算",
        }

    verified_badge = _verify_whiteboard_math_snippet(msg_text, new_blk.get("lines") or [])
    if verified_badge:
        new_blk["verified_badge"] = verified_badge

    if len(board_pages[-1].get("blocks") or []) >= 4:
        board_pages.append(
            {
                "page_index": len(board_pages) + 1,
                "roadmap_title": f"课堂互动板书 · 第 {len(board_pages) + 1} 页",
                "blocks": [new_blk],
            }
        )
    else:
        board_pages[-1]["blocks"].append(new_blk)
    target_lec["board_pages"] = board_pages

    now = time.time()
    msgs = list(target_lec.get("messages") or [])
    u_msg = {"id": new_id("wmsg"), "role": "user", "content": msg_text, "board_anchor_id": "", "created_at": now}
    a_msg = {
        "id": new_id("wmsg"),
        "role": "assistant",
        "content": reply_text,
        "board_anchor_id": new_blk["id"],
        "created_at": now + 0.01,
    }
    msgs.extend([u_msg, a_msg])
    target_lec["messages"] = msgs

    if target_lec.get("mastery") == "unstarted":
        target_lec["mastery"] = "attempted"

    pct, status, _ = _recompute_progress(units)
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE courses
            SET units_json = ?, progress_pct = ?, status = ?, last_lecture_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(units, ensure_ascii=False), pct, status, lecture_id, now, course_id),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()

    log_telemetry("course", "whiteboard_chat", verified_ok=True)
    return {
        "ok": True,
        "reply": a_msg,
        "new_board_block": new_blk,
        "page_index": len(board_pages),
        "course": _row_to_course(updated),
    }


@router.post("/{course_id}/lectures/{lecture_id}/chat")
async def whiteboard_lecture_chat(course_id: str, lecture_id: str, req: WhiteboardChatReq) -> dict[str, Any]:
    msg_text = (req.message or "").strip()
    if not msg_text:
        raise HTTPException(status_code=400, detail="请输入你的问题")
    return await _run_whiteboard_chat_turn(course_id, lecture_id, msg_text)


@router.post("/{course_id}/lectures/{lecture_id}/chat-stream")
async def whiteboard_lecture_chat_stream(course_id: str, lecture_id: str, req: WhiteboardChatReq) -> StreamingResponse:
    msg_text = (req.message or "").strip()
    if not msg_text:
        raise HTTPException(status_code=400, detail="请输入你的问题")

    async def gen():
        try:
            yield sse_event("stage", {"stage": "thinking", "message": "正在结合当前白板板书梳理推演过程…"})
            res = await _run_whiteboard_chat_turn(course_id, lecture_id, msg_text)
            reply_content = str((res.get("reply") or {}).get("content") or "")
            step_size = max(6, len(reply_content) // 10) if reply_content else 6
            for i in range(0, len(reply_content), step_size):
                yield sse_event("delta", {"text": reply_content[i : i + step_size]})
            yield sse_event(
                "board_block",
                {"block": res.get("new_board_block"), "page_index": res.get("page_index", 1)},
            )
            yield sse_event("result", res)
        except HTTPException as hex_err:
            yield sse_event("error", {"message": hex_err.detail})
        except Exception as exc:
            yield sse_event("error", {"message": f"白板讲解生成失败：{exc}"})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/{course_id}/lectures/{lecture_id}/tts")
async def whiteboard_lecture_tts(course_id: str, lecture_id: str, req: LectureTTSReq) -> FileResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    target_lec = None
    for u in course.get("units") or []:
        for l in u.get("lectures") or []:
            if l.get("id") == lecture_id:
                target_lec = l
                break
    if not target_lec:
        raise HTTPException(status_code=404, detail="讲次不存在")

    script_text = (req.text or "").strip()
    if not script_text:
        parts = [f"{target_lec.get('title', '')}。{target_lec.get('summary', '')}"]
        for pg in target_lec.get("board_pages") or []:
            for blk in pg.get("blocks") or []:
                parts.append(f"{blk.get('heading', '')}。{'；'.join(blk.get('lines') or [])}")
        msgs = [m for m in (target_lec.get("messages") or []) if m.get("role") == "assistant"]
        if msgs:
            parts.append(str(msgs[-1].get("content") or ""))
        script_text = "\n".join(parts)

    res = await synthesize_text_audio(
        cache_key=f"{course_id}_{lecture_id}",
        text=script_text,
        voice_id=req.voice,
    )
    return FileResponse(
        path=res["audio_path"],
        media_type=res["mime_type"],
        filename=res["filename"],
    )


@router.post("/{course_id}/generate-companion")
async def generate_course_companion(course_id: str, req: GenerateCompanionReq) -> dict[str, Any]:
    kind = (req.kind or "").strip().lower()
    if kind not in ("lesson", "ppt", "exam"):
        raise HTTPException(status_code=400, detail="不支持的配套资源类型")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    from engines.agent_tools import (
        tool_assemble_exam,
        tool_create_or_edit_lesson,
        tool_create_or_edit_slides,
    )

    unit_outline = "\n".join(
        f"单元{u.get('unit_index', '')} {u.get('title', '')}：{u.get('summary', '')}"
        for u in (course.get("units") or [])
    )
    ctx: dict[str, Any] = {
        "goal": course["title"],
        "shared_context": f"课程简介：{course.get('description', '')}\n{unit_outline}",
        "artifacts": dict(course.get("linked_ids") or {}),
    }

    if kind == "lesson":
        ltype = "45分钟新授课" if course.get("mode") == "teaching" else "专题精讲导学"
        tool_res = await tool_create_or_edit_lesson(
            {"topic": course["title"], "subject": course["subject"], "grade_level": course["grade_level"], "lesson_type": ltype},
            ctx,
        )
        key_id, key_art = "lesson_id", "lesson_artifact_id"
    elif kind == "ppt":
        tool_res = await tool_create_or_edit_slides(
            {"title": course["title"], "subject": course["subject"], "grade_level": course["grade_level"], "slide_count": 6},
            ctx,
        )
        key_id, key_art = "deck_id", "ppt_artifact_id"
    else:
        tool_res = await tool_assemble_exam(
            {"knowledge_points": course["title"], "subject": course["subject"], "grade_level": course["grade_level"], "count": 5},
            ctx,
        )
        key_id, key_art = "exam_id", "exam_artifact_id"

    linked_item = tool_res.get("linked_item") or {}
    linked_ids = dict(course.get("linked_ids") or {})
    if linked_item.get("id"):
        linked_ids[key_id] = linked_item["id"]
    if linked_item.get("artifact_id"):
        linked_ids[key_art] = linked_item["artifact_id"]

    with get_conn() as conn:
        conn.execute(
            "UPDATE courses SET linked_ids_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(linked_ids, ensure_ascii=False), time.time(), course_id),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    log_telemetry("course", f"companion_{kind}", verified_ok=True, meta={"course_id": course_id})
    return {
        "ok": True,
        "kind": kind,
        "linked_item": linked_item,
        "course": _row_to_course(updated),
    }


@router.get("/{course_id}/export-zip")
async def export_course_package_zip(course_id: str) -> StreamingResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="课程不存在")
        course = _row_to_course(row)

        # Build outline & whiteboard markdown
        outline_lines = [
            f"# {course['title']}",
            "",
            f"- 学科：{course['subject']} ｜ 学段：{course['grade_level']} ｜ 完成度：{course['progress_pct']}%",
            f"- 课程简介：{course['description']}",
            "",
        ]
        for u in course.get("units") or []:
            outline_lines.append(f"## 第 {u.get('unit_index', '')} 单元：{u.get('title', '')}")
            if u.get("summary"):
                outline_lines.append(str(u["summary"]))
            outline_lines.append("")
            for l in u.get("lectures") or []:
                outline_lines.append(f"### 讲次：{l.get('title', '')}（{l.get('duration_min', 15)} 分钟）")
                if l.get("summary"):
                    outline_lines.append(f"要点：{l['summary']}")
                for pg in l.get("board_pages") or []:
                    for blk in pg.get("blocks") or []:
                        outline_lines.append(f"\n#### {blk.get('heading', '板书要点')}")
                        for ln in blk.get("lines") or []:
                            outline_lines.append(f"- {ln}")
                        if blk.get("highlight_note"):
                            outline_lines.append(f"> 提示：{blk['highlight_note']}")
                for q in l.get("quiz_items") or []:
                    outline_lines.append(f"\n**随堂检验**：{q.get('question', '')}")
                    for opt in q.get("options") or []:
                        outline_lines.append(f"- {opt}")
                    outline_lines.append(f"- 参考答案：{q.get('answer', '')}（{q.get('explanation', '')}）")
                outline_lines.append("")

        cs = course.get("cheatsheet") or {}
        cs_lines = [f"# {cs.get('title', course['title'] + ' · 重点速查表')}", f"{cs.get('subtitle', '')}", ""]
        for sec in cs.get("sections") or []:
            cs_lines.append(f"## {sec.get('title', '')} [{sec.get('badge', '')}]")
            for it in sec.get("items") or []:
                cs_lines.append(f"- **{it.get('term', '')}**：{it.get('formula_or_rule', '')}")
                if it.get("trap_note"):
                    cs_lines.append(f"  - 易错提醒：{it['trap_note']}")
            cs_lines.append("")

        linked = course.get("linked_ids") or {}
        artifact_ids: list[str] = []
        for aid_key in ("lesson_artifact_id", "ppt_artifact_id", "exam_artifact_id"):
            if linked.get(aid_key):
                artifact_ids.append(str(linked[aid_key]))
        if linked.get("lesson_id"):
            lr = conn.execute("SELECT artifact_id FROM lessons WHERE id = ?", (linked["lesson_id"],)).fetchone()
            if lr and lr["artifact_id"]:
                artifact_ids.append(str(lr["artifact_id"]))
        if linked.get("deck_id"):
            pr = conn.execute("SELECT pptx_artifact_id FROM ppt_decks WHERE id = ?", (linked["deck_id"],)).fetchone()
            if pr and pr["pptx_artifact_id"]:
                artifact_ids.append(str(pr["pptx_artifact_id"]))
        if linked.get("exam_id"):
            er = conn.execute("SELECT student_artifact_id, teacher_artifact_id FROM exams WHERE id = ?", (linked["exam_id"],)).fetchone()
            if er:
                if er["student_artifact_id"]:
                    artifact_ids.append(str(er["student_artifact_id"]))
                if er["teacher_artifact_id"]:
                    artifact_ids.append(str(er["teacher_artifact_id"]))
        if linked.get("mindmap_id"):
            mr = conn.execute("SELECT artifact_id FROM mindmaps WHERE id = ?", (linked["mindmap_id"],)).fetchone()
            if mr and mr["artifact_id"]:
                artifact_ids.append(str(mr["artifact_id"]))

        art_rows = []
        if artifact_ids:
            uniq_ids = list(dict.fromkeys(artifact_ids))
            placeholders = ",".join("?" for _ in uniq_ids)
            art_rows = conn.execute(f"SELECT filename, file_path FROM artifacts WHERE id IN ({placeholders})", uniq_ids).fetchall()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("01_课程大纲与逐讲板书.md", "\n".join(outline_lines).encode("utf-8"))
        zf.writestr("02_重点速查表.md", "\n".join(cs_lines).encode("utf-8"))
        seen_names: set[str] = set()
        for ar in art_rows:
            fp = Path(str(ar["file_path"] or ""))
            if fp.is_file():
                fname = str(ar["filename"] or fp.name)
                if fname not in seen_names:
                    seen_names.add(fname)
                    zf.write(fp, arcname=f"配套资源/{fname}")

    buf.seek(0)
    safe_title = re.sub(r'[\\/:*?"<>|]+', "_", course["title"])[:36] or "course_pack"
    encoded_name = quote(f"{safe_title}_课程包.zip")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"course_pack.zip\"; filename*=UTF-8''{encoded_name}"},
    )


@router.post("/{course_id}/cheatsheet")
async def regenerate_course_cheatsheet(course_id: str, req: CheatsheetReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)

    unit_notes = []
    for u in course["units"]:
        if req.focus_unit and int(u.get("unit_index") or 0) != req.focus_unit:
            continue
        unit_notes.append(f"单元{u['unit_index']} {u['title']}: {u.get('summary','')}")

    sys_prompt = (
        "你是高密度学科速查表设计师。请把给定课程梳理成适合一页打印复习的清晰速查表 JSON（分 3~4 个主题模块，每块 2~3 条核心条目）。\n"
        "用词简明精确，公式用 `$...$`，不要出现浮夸词汇。\n"
        '严格输出 JSON：{"title": "...", "subtitle": "...", "sections": [{"title": "模块名", "badge": "分类标签", "items": [{"term": "概念/定理名", "formula_or_rule": "核心表达式与条件", "highlight_color": "blue|yellow|none", "trap_note": "易错反例提示"}]}]}'
    )
    user_prompt = f"课程：《{course['title']}》 | 学科：{course['subject']} | 学段：{course['grade_level']}\n覆盖范围：\n" + "\n".join(unit_notes)

    cs_obj = course.get("cheatsheet") or {}
    try:
        parsed, _ = await call_llm_json(
            system_prompt=sys_prompt,
            user_prompt=user_prompt,
            max_tokens=2800,
            temperature=0.2,
        )
        if isinstance(parsed, dict) and parsed.get("sections"):
            cs_obj = parsed
    except Exception:
        pass

    with get_conn() as conn:
        conn.execute(
            "UPDATE courses SET cheatsheet_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(cs_obj, ensure_ascii=False), time.time(), course_id),
        )
    return {"ok": True, "cheatsheet": cs_obj}


@router.post("/cheatsheet-custom")
async def generate_custom_cheatsheet(req: CustomCheatsheetReq) -> dict[str, Any]:
    topic = (req.topic or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="请输入速查表主题")

    sys_prompt = (
        "你是高密度学科速查表设计师。请为指定知识点制作一份多栏打印级速查表 JSON，涵盖核心定义与公式、标准求解程序、典型反例与边界陷阱三个板块。\n"
        "语言简短平实，公式用 `$...$`。\n"
        '严格输出 JSON：{"title": "...", "subtitle": "...", "sections": [{"title": "板块名", "badge": "标签", "items": [{"term": "要点名", "formula_or_rule": "公式或判定规则", "highlight_color": "blue|yellow|none", "trap_note": "易错提示"}]}]}'
    )
    cs_obj: dict[str, Any] = {}
    try:
        parsed, _ = await call_llm_json(
            system_prompt=sys_prompt,
            user_prompt=f"主题：{topic} | 学科：{req.subject} | 学段：{req.grade_level}",
            max_tokens=2600,
            temperature=0.2,
        )
        if isinstance(parsed, dict) and parsed.get("sections"):
            cs_obj = parsed
    except Exception:
        pass

    if not cs_obj:
        cs_obj = {
            "title": f"{topic} · 重点速查表",
            "subtitle": f"{req.subject} · {req.grade_level}",
            "sections": [
                {
                    "title": "核心定义与表达式",
                    "badge": "基础框架",
                    "items": [{"term": topic, "formula_or_rule": "优先写明适用前提与主要关系式，再进行代数或逻辑化简。", "highlight_color": "blue", "trap_note": "注意隐含限制条件"}],
                },
                {
                    "title": "标准操作步骤",
                    "badge": "解题路线",
                    "items": [{"term": "四步检查", "formula_or_rule": "1. 定域或定范围 -> 2. 列关系变形 -> 3. 分情况讨论 -> 4. 端点特例回代检验", "highlight_color": "yellow", "trap_note": "结论合并切忌直接用并集误代"}],
                },
            ],
        }
    return {"ok": True, "cheatsheet": cs_obj}
