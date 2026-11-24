"""Courses, Marketplace, Interactive Whiteboard Classroom, and Printable Cheatsheet API."""

from __future__ import annotations

import datetime
import io
import json
import math
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
from engines.tts_narrator import latex_to_spoken_zh, synthesize_text_audio

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


def _safe_json_loads(raw: Any, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw if isinstance(raw, type(default)) else default
    try:
        parsed = json.loads(str(raw))
        return parsed if isinstance(parsed, type(default)) else default
    except Exception:
        return default


def _safe_int(val: Any, default: int = 16) -> int:
    if val is None or isinstance(val, bool):
        return default
    if isinstance(val, (int, float)):
        if not math.isfinite(val):
            return default
        n = int(round(val))
        return n if n > 0 else default
    m = re.search(r"\d+", str(val))
    if m:
        n = int(m.group(0))
        return n if n > 0 else default
    return default


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
    return pct, status, next_lec


def _row_to_course(row: Any) -> dict[str, Any]:
    d = dict(row)
    units = _safe_json_loads(d.pop("units_json", None), [])
    cheatsheet = _safe_json_loads(d.pop("cheatsheet_json", None), {})
    linked_ids = _safe_json_loads(d.pop("linked_ids_json", None), {})
    weekly_sessions = _safe_json_loads(d.pop("weekly_sessions_json", None), {})
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
            if target_lec is not None:
                break
        if (target_lec is None or target_lec.get("mastery") == "mastered") and top.get("next_lecture"):
            target_lec = top["next_lecture"]
        if target_lec is None and top.get("units") and (top["units"][0].get("lectures") or []):
            target_lec = top["units"][0]["lectures"][0]
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
            "block_type": "concept",
            "heading": f"一、{title}直观建立",
            "lines": [
                m.get("name", "核心视角") + "：" + m.get("desc", "")
                for m in (models[:2] or [{"name": "概念切入", "desc": str(topic.get("micro_teaching_hook") or f"从实际情境理解{title}的本质。")}])
            ],
            "highlight_note": punch,
            "narration": latex_to_spoken_zh(
                f"我们先来建立《{title}》的核心直观。"
                + "；".join(
                    m.get("name", "核心视角") + "，也就是" + m.get("desc", "")
                    for m in (models[:2] or [{"name": "概念切入", "desc": f"从实际情境理解{title}的本质"}])
                )
                + f"。请记住这句核心提示：{punch}"
            ),
            "teaching_tip": f"授课切入：先用生活或几何直观打开认知，再引出《{title}》的形式化定义。",
            "visual_expr": "x^3 - 3*x^2 + 2" if "导数" in title else "",
        },
        {
            "id": "blk_flow",
            "block_type": "derivation",
            "heading": "二、核心推演路线",
            "lines": [str(step) for step in flow[:3]],
            "highlight_note": f"核心公式参考：{topic.get('core_formula_latex') or '按定义与约束分步检验'}",
            "narration": latex_to_spoken_zh(
                "接下来按规范推演路线一步步看：" + "；".join(str(step) for step in flow[:3])
            ),
            "teaching_tip": "板书节奏：分步骤写出前提检查与变形依据，切忌跳步。",
        },
    ]

    u1_l2_blocks = [
        {
            "id": "blk_trap",
            "block_type": "trap",
            "heading": "一、高频反例与边界警示",
            "lines": [str(pf) for pf in pitfalls[:3]],
            "highlight_note": "遇到临界点或特殊值务必单独代入检验。",
            "narration": latex_to_spoken_zh(
                f"这一块我们专门排雷，留意几个高频反例：" + "；".join(str(pf) for pf in pitfalls[:3]) + "。临界点一定单独代回验算。"
            ),
            "teaching_tip": "课堂设问：先让学生判断边界点是否正确，再展示反例制造认知冲突。",
        }
    ]

    u2_l1_blocks = [
        {
            "id": "blk_ext",
            "block_type": "example",
            "heading": "一、跨情境迁移与应用",
            "lines": [
                f"{lk.get('domain', '相关领域')} · {lk.get('title', title)}：{lk.get('mechanism', '')}"
                for lk in (topic.get("interdisciplinary_links") or [{"domain": "方法迁移", "title": title, "mechanism": punch}])
            ],
            "highlight_note": punch,
            "narration": latex_to_spoken_zh(
                f"现在我们把《{title}》放到实际应用场景中检验迁移能力。核心还是把握：{punch}"
            ),
            "teaching_tip": "迁移收束：总结跨题型通用模板，并与上一讲对比前提条件差异。",
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
    focus_block_id: str = ""
    teaching_mode: str = "self_study"


class TeachStepReq(BaseModel):
    action: str  # next_segment | reexplain_analogy | worked_example | counterexample | socratic_check | summarize | teacher_script
    block_id: str = ""
    page_index: int = 1
    teaching_mode: str = "self_study"
    custom_prompt: str = ""


class BoardMutateReq(BaseModel):
    op: str  # add_block | update_block | delete_block | add_page | move_block
    page_index: int = 1
    block_id: str = ""
    heading: str = ""
    lines: list[str] | None = None
    highlight_note: str | None = None
    narration: str | None = None
    teaching_tip: str | None = None
    block_type: str | None = None
    visual_expr: str | None = None
    roadmap_title: str | None = None
    direction: str = "up"


class LectureQuizSubmitReq(BaseModel):
    answers: dict[str, str]


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
                '"board_blocks": [{"block_type": "concept|derivation|example|trap|summary", "heading": "一、核心原理", "lines": ["要点1", "要点2"], "highlight_note": "板书要点", "narration": "口语化清晰讲解稿(不含LaTeX斜杠)", "teaching_tip": "授课停顿或板书提醒", "visual_expr": "可选如 x^2-1"}], '
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
                raw_crafted, _ = await call_llm_json(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    max_tokens=5500,
                    temperature=0.25,
                )
                crafted = raw_crafted if isinstance(raw_crafted, dict) else {}
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

            raw_units_val = crafted.get("units")
            raw_units = [u for u in raw_units_val if isinstance(u, dict)] if isinstance(raw_units_val, list) else []
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
                raw_lecs = u.get("lectures")
                lecs_in = [x for x in raw_lecs if isinstance(x, dict)] if isinstance(raw_lecs, list) else []
                for li, l in enumerate(lecs_in[:4], start=1):
                    lid = f"lec_{cid}_{ui}_{li}"
                    raw_blks = l.get("board_blocks")
                    blocks_in = [b for b in raw_blks if isinstance(b, dict)] if isinstance(raw_blks, list) else []
                    blocks_norm = []
                    for bi, blk in enumerate(blocks_in, start=1):
                        blk_lines = [str(ln) for ln in (blk.get("lines") or [])]
                        blk_heading = str(blk.get("heading") or f"要点 {bi}")
                        blk_note = str(blk.get("highlight_note") or "")
                        blk_narr = str(blk.get("narration") or "").strip() or latex_to_spoken_zh(
                            f"{blk_heading}。" + "；".join(blk_lines) + (f"。重点注意：{blk_note}" if blk_note else "")
                        )
                        v_expr = str(blk.get("visual_expr") or "").strip()
                        if not v_expr:
                            for cand_line in [*blk_lines, blk_heading]:
                                plotted = extract_plottable_expression(cand_line)
                                if plotted and plotted[0]:
                                    v_expr = plotted[0]
                                    break
                        blocks_norm.append(
                            {
                                "id": f"blk_{ui}_{li}_{bi}",
                                "block_type": str(blk.get("block_type") or ("concept" if bi == 1 else "derivation")),
                                "heading": blk_heading,
                                "lines": blk_lines,
                                "highlight_note": blk_note,
                                "narration": blk_narr,
                                "teaching_tip": str(blk.get("teaching_tip") or f"讲解完「{blk_heading[:12]}」后停顿提问并核对关键前提。"),
                                **({"visual_expr": v_expr} if v_expr else {}),
                            }
                        )
                    if not blocks_norm:
                        summ = str(l.get("summary") or "按核心步骤推演与检验")
                        blocks_norm = [
                            {
                                "id": f"blk_{ui}_{li}_1",
                                "block_type": "concept",
                                "heading": str(l.get("title") or "核心板书"),
                                "lines": [summ],
                                "highlight_note": "注意检查边界条件",
                                "narration": latex_to_spoken_zh(f"这一部分聚焦{l.get('title') or '核心板书'}，核心要点是：{summ}"),
                                "teaching_tip": "板书重点并提醒学生核对边界条件。",
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
                            "duration_min": _safe_int(l.get("duration_min"), 16),
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


MASTERY_ORDER: dict[str, int] = {
    "unstarted": 0,
    "attempted": 1,
    "familiar": 2,
    "proficient": 3,
    "mastered": 4,
}


def _load_course_and_lecture(course_id: str, lecture_id: str) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Fetch course row and locate target lecture dict cleanly."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="课程不存在")
    course = _row_to_course(row)
    units = list(course["units"])
    target_lec = None
    for u in units:
        for l in u.get("lectures") or []:
            if l.get("id") == lecture_id:
                target_lec = l
                break
        if target_lec:
            break
    if not target_lec:
        raise HTTPException(status_code=404, detail="讲次不存在")
    return course, units, target_lec


def _save_course_units(
    course_id: str,
    units: list[dict[str, Any]],
    *,
    last_lecture_id: str | None = None,
    weekly_sessions: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Recompute progress and persist mutated units back to SQLite."""
    pct, status, _ = _recompute_progress(units)
    now = time.time()
    set_clauses = ["units_json = ?", "progress_pct = ?", "status = ?", "updated_at = ?"]
    params: list[Any] = [json.dumps(units, ensure_ascii=False), pct, status, now]
    if last_lecture_id is not None:
        set_clauses.append("last_lecture_id = ?")
        params.append(last_lecture_id)
    if weekly_sessions is not None:
        set_clauses.append("weekly_sessions_json = ?")
        params.append(json.dumps(weekly_sessions, ensure_ascii=False))
    params.append(course_id)
    with get_conn() as conn:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"UPDATE courses SET {', '.join(set_clauses)} WHERE id = ?", params)
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not updated:
        raise HTTPException(status_code=404, detail="课程不存在")
    return _row_to_course(updated)


def _find_block_by_id(board_pages: list[dict[str, Any]], block_id: str) -> tuple[int, dict[str, Any] | None]:
    """Locate a board block and its 1-based page index by block_id."""
    if not block_id:
        return 1, None
    for idx, pg in enumerate(board_pages, start=1):
        for blk in pg.get("blocks") or []:
            if blk.get("id") == block_id:
                return int(pg.get("page_index") or idx), blk
    return 1, None


def _enrich_board_block(blk: dict[str, Any], *, msg_hint: str = "", default_type: str = "derivation") -> dict[str, Any]:
    """Ensure block metadata (block_type, narration, teaching_tip, verified_badge, visual_expr) is complete."""
    heading = str(blk.get("heading") or "板书要点").strip()
    lines = [str(x).strip() for x in (blk.get("lines") or []) if str(x).strip()]
    note = str(blk.get("highlight_note") or "").strip()
    blk_type = str(blk.get("block_type") or default_type).strip()
    if blk_type not in ("concept", "derivation", "example", "trap", "summary"):
        blk_type = default_type

    out: dict[str, Any] = {
        "id": str(blk.get("id") or new_id("blk")),
        "block_type": blk_type,
        "heading": heading,
        "lines": lines or [heading],
        "highlight_note": note,
        "narration": str(blk.get("narration") or "").strip()
        or latex_to_spoken_zh(f"{heading}。" + "；".join(lines) + (f"。重点提示：{note}" if note else "")),
        "teaching_tip": str(blk.get("teaching_tip") or "").strip()
        or f"板书停顿：引导学生先核对「{heading[:14]}」的前提条件再进入演算。",
    }
    badge = str(blk.get("verified_badge") or "").strip() or _verify_whiteboard_math_snippet(msg_hint, out["lines"])
    if badge:
        out["verified_badge"] = badge
    v_expr = str(blk.get("visual_expr") or "").strip()
    if not v_expr:
        for cand_line in [*out["lines"], heading, msg_hint]:
            plotted = extract_plottable_expression(cand_line)
            if plotted and plotted[0]:
                v_expr = plotted[0]
                break
    if v_expr:
        out["visual_expr"] = v_expr
    return out


def _append_block_to_pages(board_pages: list[dict[str, Any]], new_blk: dict[str, Any]) -> int:
    """Append a block to the last page or create a fresh overflow page, returning 1-based page index."""
    if not board_pages:
        board_pages.append({"page_index": 1, "roadmap_title": "本节课路线图", "blocks": [new_blk]})
        return 1
    if len(board_pages[-1].get("blocks") or []) >= 4:
        next_idx = len(board_pages) + 1
        board_pages.append(
            {
                "page_index": next_idx,
                "roadmap_title": f"课堂互动板书 · 第 {next_idx} 页",
                "blocks": [new_blk],
            }
        )
        return next_idx
    board_pages[-1].setdefault("blocks", []).append(new_blk)
    return len(board_pages)


async def _run_whiteboard_chat_turn(
    course_id: str,
    lecture_id: str,
    msg_text: str,
    *,
    focus_block_id: str = "",
    teaching_mode: str = "self_study",
) -> dict[str, Any]:
    course, units, target_lec = _load_course_and_lecture(course_id, lecture_id)

    board_pages = list(target_lec.get("board_pages") or [{"page_index": 1, "roadmap_title": "本节课路线图", "blocks": []}])
    existing_blocks = board_pages[-1].get("blocks") or []
    board_summary = "\n".join(
        f"{b.get('heading', '')}: " + "；".join(b.get("lines") or [])
        for b in existing_blocks[-4:]
    )
    _, focus_blk = _find_block_by_id(board_pages, focus_block_id)
    focus_ctx = (
        f"\n当前聚焦板书块：{focus_blk.get('heading', '')} -> {'；'.join(focus_blk.get('lines') or [])}\n"
        if focus_blk
        else ""
    )
    role_desc = (
        "教研授课顾问（兼顾课堂讲授口吻、板书排版与提问互动建议）"
        if teaching_mode == "teaching"
        else "白板课堂一对一启发式主讲老师"
    )

    sys_prompt = (
        f"你是{role_desc}。请针对用户当前问题或指令，在回答的同时在左侧白板补充一块清晰简短的板书要点。\n"
        "要求：语言平实清晰，少用修辞，严禁出现底层工具或代码词；数学公式用 `$...$`。\n"
        "严格输出 JSON：\n"
        '{"reply": "清晰回答(<=220字)", '
        '"board_block": {"block_type": "concept|derivation|example|trap|summary", "heading": "补充板书标题(<=16字)", '
        '"lines": ["公式或推导关键步骤1", "对比或验证结论2"], "highlight_note": "一句话点睛", '
        '"narration": "口语化清晰朗读稿(不含LaTeX反斜杠)", "teaching_tip": "课堂停顿或板书提醒"}}'
    )
    user_prompt = (
        f"课程：《{course['title']}》 | 讲次：《{target_lec['title']}》\n"
        f"当前白板内容：\n{board_summary}\n"
        f"{focus_ctx}\n"
        f"用户追问：{msg_text}"
    )

    reply_text = ""
    raw_blk: dict[str, Any] | None = None
    try:
        raw_parsed, _ = await call_llm_json(
            system_prompt=sys_prompt,
            user_prompt=user_prompt,
            max_tokens=1600,
            temperature=0.25,
        )
        parsed = raw_parsed if isinstance(raw_parsed, dict) else {}
        reply_text = str(parsed.get("reply") or "").strip()
        blk_in = parsed.get("board_block")
        if isinstance(blk_in, dict) and blk_in.get("lines"):
            raw_blk = {
                "id": new_id("blk"),
                "block_type": str(blk_in.get("block_type") or "derivation"),
                "heading": str(blk_in.get("heading") or f"追问解析：{msg_text[:12]}"),
                "lines": [str(x) for x in (blk_in.get("lines") or [])][:4],
                "highlight_note": str(blk_in.get("highlight_note") or ""),
                "narration": str(blk_in.get("narration") or ""),
                "teaching_tip": str(blk_in.get("teaching_tip") or ""),
            }
    except Exception:
        pass

    if not reply_text:
        focus_hint = f"针对「{focus_blk.get('heading', '')}」" if focus_blk else f"关于“{msg_text[:32]}”"
        reply_text = f"{focus_hint}，关键在于先把题目或结论里的约束条件拆出来，核对每一步推导的前提是否成立，再用简单特例代入验算一遍。已在左侧白板补充记录。"
    if raw_blk is None:
        raw_blk = {
            "id": new_id("blk"),
            "block_type": "derivation",
            "heading": f"补充辨析：{msg_text[:14]}",
            "lines": [
                "先写出已知前提与适用范围",
                "逐步验算核心关系式并比对临界点",
            ],
            "highlight_note": "核对前提 -> 分步推演 -> 特例验算",
        }

    new_blk = _enrich_board_block(raw_blk, msg_hint=msg_text, default_type="derivation")
    target_page_idx = _append_block_to_pages(board_pages, new_blk)
    target_lec["board_pages"] = board_pages

    now = time.time()
    msgs = list(target_lec.get("messages") or [])
    u_msg = {"id": new_id("wmsg"), "role": "user", "content": msg_text, "board_anchor_id": focus_block_id or "", "created_at": now}
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

    updated_course = _save_course_units(course_id, units, last_lecture_id=lecture_id)
    log_telemetry("course", "whiteboard_chat", verified_ok=True)
    return {
        "ok": True,
        "reply": a_msg,
        "new_board_block": new_blk,
        "page_index": target_page_idx,
        "course": updated_course,
    }


@router.post("/{course_id}/lectures/{lecture_id}/chat")
async def whiteboard_lecture_chat(course_id: str, lecture_id: str, req: WhiteboardChatReq) -> dict[str, Any]:
    msg_text = (req.message or "").strip()
    if not msg_text:
        raise HTTPException(status_code=400, detail="请输入你的问题")
    return await _run_whiteboard_chat_turn(
        course_id,
        lecture_id,
        msg_text,
        focus_block_id=req.focus_block_id,
        teaching_mode=req.teaching_mode,
    )


@router.post("/{course_id}/lectures/{lecture_id}/chat-stream")
async def whiteboard_lecture_chat_stream(course_id: str, lecture_id: str, req: WhiteboardChatReq) -> StreamingResponse:
    msg_text = (req.message or "").strip()
    if not msg_text:
        raise HTTPException(status_code=400, detail="请输入你的问题")

    async def gen():
        try:
            yield sse_event("stage", {"stage": "thinking", "message": "正在结合当前白板板书梳理推演过程…"})
            res = await _run_whiteboard_chat_turn(
                course_id,
                lecture_id,
                msg_text,
                focus_block_id=req.focus_block_id,
                teaching_mode=req.teaching_mode,
            )
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


_TEACH_ACTION_META: dict[str, tuple[str, str, str]] = {
    "next_segment": ("derivation", "正在推进下一教学环节并生成衔接板书…", "推进下一节重点"),
    "reexplain_analogy": ("concept", "正在构思生活化类比与直观图像…", "直观类比精讲"),
    "worked_example": ("example", "正在编写分步规范例题并自动验算…", "典例分步拆解"),
    "counterexample": ("trap", "正在构建易错反例与边界警示…", "易错反例警示"),
    "socratic_check": ("concept", "正在设计苏格拉底式随堂诊断小题…", "随堂互动检验"),
    "summarize": ("summary", "正在提炼本讲知识骨架与口诀…", "本讲小结升华"),
    "teacher_script": ("concept", "正在生成微格试讲逐字稿与板书调度…", "试讲逐字稿"),
}


def _fallback_teach_step(
    action: str,
    course: dict[str, Any],
    lecture: dict[str, Any],
    focus_blk: dict[str, Any] | None,
) -> dict[str, Any]:
    """Produce contextual, non-generic pedagogical fallback output for teach-step when LLM is offline."""
    lec_title = str(lecture.get("title") or course.get("title") or "本讲核心")
    focus_heading = str((focus_blk or {}).get("heading") or lec_title)
    focus_lines = (focus_blk or {}).get("lines") or [str(lecture.get("summary") or lec_title)]
    lead_line = str(focus_lines[0]) if focus_lines else lec_title
    short_focus = re.sub(r"^[一二三四五六七八九十]+、\s*", "", focus_heading)[:18]

    if action == "socratic_check":
        q_item = {
            "id": new_id("q"),
            "question": f"结合板书「{short_focus}」，下列在判断或演算时最必须优先检验的环节是（ ）",
            "options": [
                "A. 先明确函数或结论成立的定义域及前提约束，再做符号与临界点分析",
                "B. 直接代入一个特殊数值后推广到全部区间",
                "C. 跳过分界点或导数为零点的两侧符号验证",
                "D. 将多个不连续区间直接用并集符号连接作答",
            ],
            "answer": "A",
            "explanation": f"针对「{short_focus}」，先界定前提约束与区间边界，再用典型特例做临界复核，能避免条件滑坡与伪解。",
            "related_block_id": (focus_blk or {}).get("id", ""),
        }
        return {
            "reply": f"我围绕「{short_focus}」出了一道即时诊断题，可点击顶部「随堂检验」直接作答并立即判分。",
            "quiz_item": q_item,
        }

    if action == "reexplain_analogy":
        return {
            "reply": f"换个直观类比来理解「{short_focus}」：可以把公式判定想象成开车爬坡时看仪表盘瞬时坡度——只要方向盘前方的坡度持续向上（即使红绿灯短暂踩一下刹车停顿一下，如 $f(x)=x^3$ 在原点切线水平），整段路程高度仍在稳步上升。",
            "board_block": {
                "block_type": "concept",
                "heading": f"直观类比：{short_focus[:12]}",
                "lines": [
                    f"核心映射：{lead_line[:44]}",
                    "汽车爬坡类比：瞬间水平踩刹车（孤立点零斜率）不改变整体单调上升趋势",
                    "判定关键：必须看临界点左右两侧的持续变号趋势",
                ],
                "highlight_note": "先看方向趋势，再核对孤立点是否影响严格单调",
                "narration": latex_to_spoken_zh(f"我们换一个更容易记住的画面来理解{short_focus}。就像开车爬坡时看坡度表，中途轻微点一下刹车只是某个瞬时斜率为零，只要前后都在往上走，整体高度还是严格增加的。"),
                "teaching_tip": "课堂语言建议：放慢语速比划爬坡手势，让学生先口述结论再写不等式。",
            },
        }

    if action == "worked_example":
        return {
            "reply": f"配合「{short_focus}」补充一道规范分步例题 $f(x)=x^3-3x$：先定域为实数集，再求导分解 $f'(x)=3(x-1)(x+1)$，列表判号得出递增区间 $(-\\infty,-1)$ 和 $(1,+\\infty)$，递减区间 $(-1,1)$，极大值 $f(-1)=2$、极小值 $f(1)=-2$。",
            "board_block": {
                "block_type": "example",
                "heading": f"典例规范拆解：{short_focus[:10]}",
                "lines": [
                    "例题：讨论 $f(x)=x^3-3x$ 在 $(-\\infty,+\\infty)$ 上的单调性与极值",
                    "Step 1 定域与求导：$f'(x)=3x^2-3=3(x-1)(x+1)=0 \\Rightarrow x=\\pm 1$",
                    "Step 2 分段列表：$(-\\infty,-1)$ 与 $(1,+\\infty)$ 递增；$(-1,1)$ 递减；极值 $f(-1)=2, f(1)=-2$",
                ],
                "highlight_note": "严谨书写规范：两段增区间之间用“和”连接，严禁写成并集 $\\cup$",
                "narration": latex_to_spoken_zh("我们来结合一道典例规范走完四步程序：已知 f of x 等于 x 的立方减 3x，第一步先标明定义域为全体实数；第二步求导因式分解得 f 撇 x 等于 3 倍 x 减 1 乘以 x 加 1，求出驻点正负 1；第三步分段列表判号，正区间用和连接，不要写并集符号。"),
                "teaching_tip": "板书示例：故意留出列表格的符号行，请学生上台填正负号。",
                "visual_expr": "x^3 - 3*x",
            },
        }

    if action == "counterexample":
        return {
            "reply": f"针对「{short_focus}」最常考的两个反例陷阱已补充到板书：$f(x)=1/x$ 证明断崖间断两侧不能写并集；$f(x)=|x|$ 说明尖点不可导同样可以是极小值点。",
            "board_block": {
                "block_type": "trap",
                "heading": f"易错反例警示：{short_focus[:10]}",
                "lines": [
                    "反例 1（并集陷阱）：$f(x)=\\frac{1}{x}$ 在 $(-\\infty,0)$ 与 $(0,+\\infty)$ 均递减，但 $f(-1)=-1 < f(1)=1$",
                    "反例 2（可导误区）：$f(x)=|x|$ 在 $x=0$ 不可导却取到极小值；$f(x)=x^3$ 可导且 $f'(0)=0$ 却无极值",
                ],
                "highlight_note": "遇分母与对数先画间断边界；判极值务必检验一阶导左右变号",
                "narration": latex_to_spoken_zh("这组反例专门帮大家避坑：第一，为什么单调区间中间不能随便写并集？看看 y 等于 x 分之一，负 1 小于 1，但函数值反而变大了；第二，极值点不一定可导，比如绝对值 x 在原点是尖点照样是极小值。"),
                "teaching_tip": "对比板书：用红笔圈出“$\\cup$ 误区”与“左右变号”两个核心字眼。",
            },
        }

    if action == "summarize":
        return {
            "reply": f"为你提炼本讲《{lec_title}》的考场核心口诀：一标定义域、二求导分解、三找驻点与间断点、四列表看变号，区间分隔写“和”不写并集。",
            "board_block": {
                "block_type": "summary",
                "heading": "核心总结与考场四步口诀",
                "lines": [
                    f"1. 主线回顾：{short_focus} 围绕“定域 → 求导 → 列表 → 检验”展开",
                    "2. 核心检验：驻点不等价于极值点，必须检验左右导数符号是否真正反号",
                    "3. 书写底线：分段单调区间用“和”或逗号分隔，闭区间最值兼顾端点值",
                ],
                "highlight_note": "定域为先，变号为据，端点不漏，分隔用“和”",
                "narration": latex_to_spoken_zh(f"最后我们把《{lec_title}》收束成考场四步口诀：一先标定义域，二规范求导因式分解，三标出驻点与间断点，四列表检查左右导数是否变号，闭区间还要记得比对两个端点值。"),
                "teaching_tip": "结课收尾：停顿 3 秒留给学生对照速查表完成随堂自测。",
            },
        }

    if action == "teacher_script":
        return {
            "reply": f"已为你生成针对《{lec_title}》的 3 分钟微格试讲过渡话术与板书调度提示，已追加到板书便于对照。",
            "board_block": {
                "block_type": "concept",
                "heading": f"试讲口播逐字稿：{short_focus[:10]}",
                "lines": [
                    f"引入设问（40秒）：“同学们先看屏幕图像，{lead_line[:38]}——为什么会出现这个关键边界？”",
                    "板书同步（90秒）：边推导边请学生口答符号变化，在右栏保留「定义域优先」常驻提醒框",
                    "收束过渡（50秒）：“请用 30 秒核对刚才例题的端点取值，接下来我们用随堂小题即时检验。”",
                ],
                "highlight_note": "试讲节奏建议：问题驱动设问 + 核心结论留白待学生接话",
                "narration": latex_to_spoken_zh(f"试讲过渡示范：各位同学请看黑板左上角，我们刚才已经得出核心关系。接下来大家思考三十秒，如果在端点处导数恰好为零，原来的单调性还成立吗？"),
                "teaching_tip": "站位与视线提示：写完主公式后侧身面向学生停顿 2 秒，预留互动停顿点。",
            },
        }

    # next_segment default
    return {
        "reply": f"基于上一节「{short_focus}」，我们顺势推进到下一步关键推演：当表达式含有参数或存在分段边界时，需先列出参数零点对比关系。",
        "board_block": {
            "block_type": "derivation",
            "heading": "进阶延伸：分类界限与参数检验",
            "lines": [
                f"承接上一步：{lead_line[:44]}",
                "参数分级检验：最高次项系数正负 → 判别式有无实根 → 根是否落入定义域",
                "边界回归校验：单独检验临界等号是否破坏单调严格性",
            ],
            "highlight_note": "分类讨论做到不重不漏的关键是画出参数数轴",
            "narration": latex_to_spoken_zh("掌握了前面基础步骤后，我们向前推进一档，看看含参数情况下怎么讨论：第一层看导函数最高次系数，第二层看零点是否在定义域内，第三层借助数轴比较两根大小。"),
            "teaching_tip": "梯度拔高提示：确认全班掌握无参步骤后再展开参数分类数轴。",
        },
    }


@router.post("/{course_id}/lectures/{lecture_id}/teach-step")
async def whiteboard_teach_step_stream(course_id: str, lecture_id: str, req: TeachStepReq) -> StreamingResponse:
    """Stream a single pedagogical action (analogy, worked example, counterexample, quiz check, etc.)."""
    action = (req.action or "next_segment").strip()
    if action not in _TEACH_ACTION_META:
        raise HTTPException(status_code=400, detail=f"不支持的讲课动作：{action}")

    default_btype, stage_msg, action_label = _TEACH_ACTION_META[action]

    async def gen():
        try:
            yield sse_event("stage", {"stage": "thinking", "message": stage_msg})
            course, units, target_lec = _load_course_and_lecture(course_id, lecture_id)
            board_pages = list(target_lec.get("board_pages") or [{"page_index": 1, "roadmap_title": "本节课路线图", "blocks": []}])
            _, focus_blk = _find_block_by_id(board_pages, req.block_id)
            if not focus_blk and board_pages:
                pg_idx_clamped = max(0, min(len(board_pages) - 1, int(req.page_index or 1) - 1))
                pg_blks = board_pages[pg_idx_clamped].get("blocks") or []
                if pg_blks:
                    focus_blk = pg_blks[-1]

            board_ctx = ""
            if focus_blk:
                board_ctx = f"聚焦板书：{focus_blk.get('heading', '')} -> {'；'.join(focus_blk.get('lines') or [])}"

            if action == "socratic_check":
                sys_prompt = (
                    "你是交互式课堂命题老师。请结合指定板书块出一道高质量随堂选择题检验真实理解（不要考机械记忆）。\n"
                    "语言简洁准确，公式用 `$...$`。\n"
                    '严格输出 JSON：{"reply": "引导提示(<=90字)", "quiz_item": {"question": "题干", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "简明解析"}}'
                )
            else:
                sys_prompt = (
                    f"你是交互式白板讲课专家，当前需要执行教学动作「{action_label}」（模式：{req.teaching_mode}）。\n"
                    "要求：紧扣当前板书与课程主线，少用虚词修辞，公式用 `$...$`，并在 narration 中提供自然口语版读法。\n"
                    '严格输出 JSON：{"reply": "课堂伴随口播总结(<=180字)", "board_block": {"block_type": "concept|derivation|example|trap|summary", "heading": "板书块标题(<=18字)", "lines": ["要点1", "要点2", "要点3"], "highlight_note": "点睛提醒", "narration": "自然口语逐字稿(不含反斜杠)", "teaching_tip": "给老师的停顿/板书提示"}}'
                )

            user_prompt = (
                f"课程：《{course['title']}》 | 学科：{course['subject']} | 学段：{course['grade_level']}\n"
                f"当前讲次：《{target_lec['title']}》\n"
                f"{board_ctx}\n"
                + (f"附加要求：{req.custom_prompt}\n" if req.custom_prompt else "")
            )

            parsed: dict[str, Any] = {}
            try:
                raw_parsed, _ = await call_llm_json(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    max_tokens=1800,
                    temperature=0.25,
                )
                parsed = raw_parsed if isinstance(raw_parsed, dict) else {}
            except Exception:
                parsed = {}

            fb = _fallback_teach_step(action, course, target_lec, focus_blk)
            reply_text = str(parsed.get("reply") or fb["reply"]).strip()

            now = time.time()
            msgs = list(target_lec.get("messages") or [])
            for i in range(0, len(reply_text), max(8, len(reply_text) // 8 or 8)):
                yield sse_event("delta", {"text": reply_text[i : i + max(8, len(reply_text) // 8 or 8)]})

            if action == "socratic_check":
                raw_qi = parsed.get("quiz_item")
                raw_opts = (
                    [str(o).strip() for o in (raw_qi.get("options") or []) if str(o).strip()][:4]
                    if isinstance(raw_qi, dict)
                    else []
                )
                if isinstance(raw_qi, dict) and str(raw_qi.get("question") or "").strip() and len(raw_opts) >= 2:
                    q_src = raw_qi
                    opts = raw_opts
                else:
                    q_src = fb["quiz_item"]
                    opts = list(fb["quiz_item"]["options"])
                ans_char = str(q_src.get("answer") or "A").strip()[:1].upper()
                if ans_char not in ("A", "B", "C", "D", "E", "F")[: len(opts)]:
                    ans_char = "A"
                quiz_item = {
                    "id": new_id("q"),
                    "question": str(q_src.get("question") or fb["quiz_item"]["question"]),
                    "options": opts,
                    "answer": ans_char,
                    "explanation": str(q_src.get("explanation") or fb["quiz_item"]["explanation"]),
                    "related_block_id": str((focus_blk or {}).get("id") or ""),
                }
                q_list = list(target_lec.get("quiz_items") or [])
                q_list.append(quiz_item)
                target_lec["quiz_items"] = q_list

                a_msg = {
                    "id": new_id("wmsg"),
                    "role": "assistant",
                    "content": reply_text,
                    "board_anchor_id": str((focus_blk or {}).get("id") or ""),
                    "created_at": now,
                }
                msgs.append(a_msg)
                target_lec["messages"] = msgs
                if target_lec.get("mastery") == "unstarted":
                    target_lec["mastery"] = "attempted"
                updated_course = _save_course_units(course_id, units, last_lecture_id=lecture_id)
                log_telemetry("course", f"teach_step_{action}", verified_ok=True)
                yield sse_event("quiz_item", {"quiz_item": quiz_item})
                yield sse_event(
                    "result",
                    {
                        "ok": True,
                        "action": action,
                        "reply": a_msg,
                        "new_quiz_item": quiz_item,
                        "course": updated_course,
                    },
                )
                return

            blk_in = parsed.get("board_block") if isinstance(parsed.get("board_block"), dict) and parsed["board_block"].get("lines") else fb["board_block"]
            new_blk = _enrich_board_block(
                {**blk_in, "id": new_id("blk")},
                msg_hint=f"{action} {req.custom_prompt} {' '.join(blk_in.get('lines') or [])}",
                default_type=default_btype,
            )
            page_idx = _append_block_to_pages(board_pages, new_blk)
            target_lec["board_pages"] = board_pages

            a_msg = {
                "id": new_id("wmsg"),
                "role": "assistant",
                "content": reply_text,
                "board_anchor_id": new_blk["id"],
                "created_at": now,
            }
            msgs.append(a_msg)
            target_lec["messages"] = msgs
            if target_lec.get("mastery") == "unstarted":
                target_lec["mastery"] = "attempted"

            updated_course = _save_course_units(course_id, units, last_lecture_id=lecture_id)
            log_telemetry("course", f"teach_step_{action}", verified_ok=True)
            yield sse_event("board_block", {"block": new_blk, "page_index": page_idx})
            yield sse_event(
                "result",
                {
                    "ok": True,
                    "action": action,
                    "reply": a_msg,
                    "new_board_block": new_blk,
                    "page_index": page_idx,
                    "course": updated_course,
                },
            )
        except HTTPException as hex_err:
            yield sse_event("error", {"message": hex_err.detail})
        except Exception as exc:
            yield sse_event("error", {"message": f"讲课动作执行失败：{exc}"})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.patch("/{course_id}/lectures/{lecture_id}/board")
async def mutate_whiteboard_board(course_id: str, lecture_id: str, req: BoardMutateReq) -> dict[str, Any]:
    """Create, update, reorder, or delete whiteboard pages and blocks."""
    op = (req.op or "").strip()
    if op not in ("add_block", "update_block", "delete_block", "add_page", "move_block"):
        raise HTTPException(status_code=400, detail="不支持的板书操作类型")

    _, units, target_lec = _load_course_and_lecture(course_id, lecture_id)
    board_pages = list(target_lec.get("board_pages") or [{"page_index": 1, "roadmap_title": "本节课路线图", "blocks": []}])
    result_block: dict[str, Any] | None = None
    result_page_idx = max(1, min(len(board_pages), int(req.page_index or 1)))

    if op == "add_page":
        next_idx = len(board_pages) + 1
        blocks: list[dict[str, Any]] = []
        if req.heading.strip() or req.lines:
            result_block = _enrich_board_block(
                {
                    "id": new_id("blk"),
                    "heading": req.heading or f"新板书页要点",
                    "lines": req.lines or ["在此补充核心推导或板书要点"],
                    "highlight_note": req.highlight_note or "",
                    "narration": req.narration or "",
                    "teaching_tip": req.teaching_tip or "",
                    "block_type": req.block_type or "concept",
                    "visual_expr": req.visual_expr or "",
                },
                default_type="concept",
            )
            blocks.append(result_block)
        board_pages.append(
            {
                "page_index": next_idx,
                "roadmap_title": (req.roadmap_title or f"课堂板书 · 第 {next_idx} 页").strip(),
                "blocks": blocks,
            }
        )
        result_page_idx = next_idx

    elif op == "add_block":
        if not req.heading.strip() and not req.lines:
            raise HTTPException(status_code=400, detail="板书标题与内容不能同时为空")
        result_block = _enrich_board_block(
            {
                "id": new_id("blk"),
                "heading": req.heading.strip() or "补充板书",
                "lines": req.lines or [req.heading.strip()],
                "highlight_note": req.highlight_note or "",
                "narration": req.narration or "",
                "teaching_tip": req.teaching_tip or "",
                "block_type": req.block_type or "derivation",
                "visual_expr": req.visual_expr or "",
            },
            default_type="derivation",
        )
        pg_idx_0 = max(0, min(len(board_pages) - 1, int(req.page_index or 1) - 1))
        board_pages[pg_idx_0].setdefault("blocks", []).append(result_block)
        result_page_idx = pg_idx_0 + 1

    elif op == "update_block":
        if not req.block_id:
            raise HTTPException(status_code=400, detail="缺少目标板书 block_id")
        found = False
        for idx, pg in enumerate(board_pages, start=1):
            blks = pg.get("blocks") or []
            for bi, blk in enumerate(blks):
                if blk.get("id") == req.block_id:
                    merged = dict(blk)
                    if req.heading:
                        merged["heading"] = req.heading.strip()
                    if req.lines is not None:
                        merged["lines"] = [str(x).strip() for x in req.lines if str(x).strip()]
                    if req.highlight_note is not None:
                        merged["highlight_note"] = req.highlight_note.strip()
                    if req.narration is not None:
                        merged["narration"] = req.narration.strip()
                    if req.teaching_tip is not None:
                        merged["teaching_tip"] = req.teaching_tip.strip()
                    if req.block_type is not None:
                        merged["block_type"] = req.block_type.strip()
                    if req.visual_expr is not None:
                        merged["visual_expr"] = req.visual_expr.strip()
                    merged.pop("verified_badge", None)
                    result_block = _enrich_board_block(merged, default_type=str(merged.get("block_type") or "derivation"))
                    blks[bi] = result_block
                    result_page_idx = idx
                    found = True
                    break
            if found:
                break
        if not found:
            raise HTTPException(status_code=404, detail="未找到指定板书块")

    elif op == "delete_block":
        if not req.block_id:
            raise HTTPException(status_code=400, detail="缺少目标板书 block_id")
        removed = False
        for pg in board_pages:
            before = len(pg.get("blocks") or [])
            pg["blocks"] = [b for b in (pg.get("blocks") or []) if b.get("id") != req.block_id]
            if len(pg["blocks"]) < before:
                removed = True
        if not removed:
            raise HTTPException(status_code=404, detail="未找到指定板书块")
        # Keep non-empty pages or always preserve at least page 1
        board_pages = [pg for i, pg in enumerate(board_pages) if i == 0 or (pg.get("blocks") or [])]
        for i, pg in enumerate(board_pages, start=1):
            pg["page_index"] = i
        result_page_idx = min(result_page_idx, len(board_pages))

    elif op == "move_block":
        if not req.block_id:
            raise HTTPException(status_code=400, detail="缺少目标板书 block_id")
        delta = -1 if req.direction == "up" else 1
        moved = False
        for idx, pg in enumerate(board_pages, start=1):
            blks = list(pg.get("blocks") or [])
            for bi, blk in enumerate(blks):
                if blk.get("id") == req.block_id:
                    new_pos = max(0, min(len(blks) - 1, bi + delta))
                    if new_pos != bi:
                        blks[bi], blks[new_pos] = blks[new_pos], blks[bi]
                        pg["blocks"] = blks
                    result_block = blks[new_pos]
                    result_page_idx = idx
                    moved = True
                    break
            if moved:
                break
        if not moved:
            raise HTTPException(status_code=404, detail="未找到指定板书块")

    target_lec["board_pages"] = board_pages
    updated_course = _save_course_units(course_id, units, last_lecture_id=lecture_id)
    log_telemetry("course", f"board_{op}", verified_ok=True)
    return {
        "ok": True,
        "course": updated_course,
        "page_index": result_page_idx,
        "block": result_block,
    }


@router.post("/{course_id}/lectures/{lecture_id}/quiz-submit")
async def submit_whiteboard_lecture_quiz(
    course_id: str,
    lecture_id: str,
    req: LectureQuizSubmitReq,
) -> dict[str, Any]:
    """Grade inline classroom checkpoint quiz and upgrade lecture mastery monotonically."""
    course, units, target_lec = _load_course_and_lecture(course_id, lecture_id)
    quiz_items = list(target_lec.get("quiz_items") or [])
    if not quiz_items:
        raise HTTPException(status_code=400, detail="当前讲次暂无随堂检验题")

    graded_items: list[dict[str, Any]] = []
    correct_count = 0
    for q in quiz_items:
        qid = str(q.get("id") or "")
        expected = str(q.get("answer") or "A").strip()[:1].upper()
        selected_raw = str((req.answers or {}).get(qid, "") or "").strip()
        selected = selected_raw[:1].upper() if selected_raw else ""
        is_ok = bool(selected and selected == expected)
        if is_ok:
            correct_count += 1
        graded_items.append(
            {
                "id": qid,
                "selected": selected,
                "expected": expected,
                "correct": is_ok,
                "explanation": str(q.get("explanation") or ""),
                "related_block_id": str(q.get("related_block_id") or ""),
            }
        )

    total_count = len(quiz_items)
    score_pct = int(round((correct_count / total_count) * 100)) if total_count else 0
    if score_pct >= 85:
        target_mastery = "mastered"
    elif score_pct >= 60:
        target_mastery = "proficient"
    elif correct_count > 0:
        target_mastery = "familiar"
    else:
        target_mastery = "attempted"

    cur_mastery = str(target_lec.get("mastery") or "unstarted")
    if MASTERY_ORDER.get(target_mastery, 0) > MASTERY_ORDER.get(cur_mastery, 0):
        target_lec["mastery"] = target_mastery
    new_mastery = str(target_lec["mastery"])

    weekly = dict(course.get("weekly_sessions") or {})
    today_k = _today_str()
    weekly[today_k] = int(weekly.get(today_k, 0)) + 1

    updated_course = _save_course_units(
        course_id,
        units,
        last_lecture_id=lecture_id,
        weekly_sessions=weekly,
    )
    record_learning_outcome(
        topic_tag=str(target_lec.get("title") or course.get("title") or "课堂随堂检验")[:48],
        subject=str(course.get("subject") or "综合学科"),
        grade_level=str(course.get("grade_level") or "高二年级"),
        correct=(score_pct >= 60),
        mistake_note="" if score_pct >= 60 else f"随堂检验得分 {score_pct}%，建议回看错题对应板书。",
    )
    log_telemetry("course", "quiz_submit", verified_ok=True, meta={"score_pct": score_pct})
    return {
        "ok": True,
        "score_pct": score_pct,
        "correct_count": correct_count,
        "total_count": total_count,
        "items": graded_items,
        "mastery": new_mastery,
        "course": updated_course,
    }


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

    try:
        res = await synthesize_text_audio(
            cache_key=f"{course_id}_{lecture_id}",
            text=script_text,
            voice_id=req.voice,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
        used_arcnames: set[str] = set()
        seen_paths: set[str] = set()
        for ar in art_rows:
            fp = Path(str(ar["file_path"] or ""))
            if not fp.is_file():
                continue
            resolved_key = str(fp.resolve())
            if resolved_key in seen_paths:
                continue
            seen_paths.add(resolved_key)
            raw_fname = Path(str(ar["filename"] or fp.name)).name or fp.name
            stem = Path(raw_fname).stem
            suffix = Path(raw_fname).suffix
            cand_name = raw_fname
            dup_idx = 2
            while f"配套资源/{cand_name}" in used_arcnames:
                cand_name = f"{stem}_{dup_idx}{suffix}"
                dup_idx += 1
            arcname = f"配套资源/{cand_name}"
            used_arcnames.add(arcname)
            zf.write(fp, arcname=arcname)

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
