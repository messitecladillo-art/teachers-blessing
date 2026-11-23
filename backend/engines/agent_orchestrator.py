"""Multi-step autonomous task planner & cross-module orchestrator."""

from __future__ import annotations

import json
import time
from typing import Any, AsyncGenerator

from core.database import get_conn, log_telemetry, new_id
from core.llm_gateway import call_llm, call_llm_json
from core.sse import sse_event
from engines.agent_tools import TOOL_REGISTRY
from engines.knowledge_index import list_indexed_documents
from engines.memory_engine import build_memory_context_text

_PLANNER_SYSTEM_PROMPT = """你是教学与学习工作台的全局任务规划助手。
你的职责是：根据用户的目标、已上传讲义目录、当前会话已生成的关联成果（教案/课件/试卷/导图）以及历史学情记忆，判断应当「追问明确需求」，还是拆解为清晰的多步工具执行清单并联动完成。

可用工具（tool 名必须严格匹配以下之一）：
1. "search_materials": 检索已上传讲义资料库。args: {"query": "章节或概念关键词"}
2. "search_topics": 检索内置全学科专题库。args: {"query": "关键词", "domain": ""}
3. "verify_math": 对单个数学公式或方程求导、化简、求解验算。args: {"expression": "x^3-3*x^2+2"}
4. "create_mindmap": 生成专题思维导图。args: {"topic": "导图主题", "subject": "学科"}
5. "create_or_edit_lesson": 新建或修改教案（mode="edit" 可直接改当前会话已有教案）。args: {"topic": "课题", "subject": "学科", "grade_level": "学段", "lesson_type": "45分钟新授课或15分钟微格试讲", "mode": "create|edit", "instruction": "修改要求"}
6. "create_or_edit_slides": 新建或修改课件（mode="edit" 可修改当前会话已有课件）。args: {"title": "课件标题", "subject": "学科", "grade_level": "学段", "slide_count": 6, "mode": "create|edit", "slide_number": 6, "instruction": "修改要求"}
7. "assemble_exam": 抽题/命制试卷，或修改已有试卷第 N 题（mode="edit"）。args: {"knowledge_points": "考查知识点", "subject": "学科", "grade_level": "学段", "count": 5, "mode": "create|edit", "question_index": 0, "instruction": "替换要求"}
8. "build_remediation_quiz": 按当前薄弱点与错题记忆生成靶向巩固测验卷。args: {"topics": ["知识点"], "count": 4}
9. "solve_question": 分步解答具体题目并核对答案。args: {"question": "完整题干", "subject": "学科", "grade_level": "学段"}
10. "craft_course": 快速新建一门完整的多单元白板课程并纳入我的课程。args: {"topic": "课程主题", "subject": "学科", "grade_level": "学段", "mode": "self_study|teaching"}
11. "generate_cheatsheet": 整理生成一页可打印高密度重点速查表。args: {"topic": "速查表主题", "subject": "学科", "grade_level": "学段"}
12. "schedule_study_plan": 制定 7 日复习/学习计划并直接写入学习流日历待办。args: {"title": "计划标题", "goal": "核心目标", "weak_topics": ["重点1"], "daily_minutes": 40}

规划规则：
- 若用户需求过于宽泛且缺乏关键学科/主题线索（例如只说“帮我备课”或“出套题”而没有任何主题、也没有关联既有成果），输出 decision="clarify"，给出简明追问与 2~3 个快捷补充方向。
- 若涉及“跨产物修改”（如“把刚出的试卷第1题换掉，并同步改教案练习”），优先编排 assemble_exam(mode="edit") + create_or_edit_lesson(mode="edit") 或 create_or_edit_slides(mode="edit")，形成联动修改闭环。
- 若用户明确要求“做课程/开课/白板课”，使用 craft_course；要求“速查表/一页纸总结/备忘卡”，使用 generate_cheatsheet；要求“学习计划/复习安排/日程/打卡”，使用 schedule_study_plan。
- 若用户需要完整备课闭环，通常先查讲义/专题（search_materials 或 search_topics），再依次生成导图（create_mindmap）、教案（create_or_edit_lesson）、课件（create_or_edit_slides）、随堂卷（assemble_exam）。标准模式控制在 1~5 步之间；快速模式控制在 1~2 步核心动作。
- 所有字段文案使用平实简短的功能描述，不得出现技术术语（如工具函数原名仅放进 tool 字段，step_label 用中文自然描述如“检索集合与逻辑讲义章节”）。

必须严格输出合法 JSON：
{
  "decision": "execute_now" | "clarify",
  "clarify_question": "仅在 clarify 时填写的简短追问",
  "clarify_options": ["补充方向1", "补充方向2"],
  "plan_summary": "一句话说明准备怎么联动完成这件事",
  "steps": [
    {"tool": "search_materials", "step_label": "检索讲义中相关章节", "args": {"query": "..."}}
  ]
}"""


def list_agent_threads() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM agent_threads ORDER BY updated_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["plan"] = json.loads(d.pop("plan_json") or "[]")
        d["artifacts"] = json.loads(d.pop("artifacts_json") or "{}")
        out.append(d)
    return out


def create_agent_thread(title: str = "新协同任务") -> dict[str, Any]:
    tid = new_id("thr")
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO agent_threads (id, title, status, plan_json, pending_goal, artifacts_json, created_at, updated_at)
            VALUES (?, ?, 'idle', '[]', '', '{}', ?, ?)
            """,
            (tid, title[:60], now, now),
        )
    return {"id": tid, "title": title[:60], "status": "idle", "plan": [], "pending_goal": "", "artifacts": {}, "created_at": now, "updated_at": now, "messages": []}


def get_agent_thread(thread_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        t_row = conn.execute("SELECT * FROM agent_threads WHERE id = ?", (thread_id,)).fetchone()
        if not t_row:
            return None
        m_rows = conn.execute(
            "SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at ASC",
            (thread_id,),
        ).fetchall()

    thread = dict(t_row)
    thread["plan"] = json.loads(thread.pop("plan_json") or "[]")
    thread["artifacts"] = json.loads(thread.pop("artifacts_json") or "{}")
    messages = []
    for m in m_rows:
        md = dict(m)
        md["plan"] = json.loads(md.pop("plan_json") or "[]")
        md["tool_traces"] = json.loads(md.pop("tool_traces_json") or "[]")
        md["linked_items"] = json.loads(md.pop("linked_items_json") or "[]")
        md["needs_confirmation"] = bool(md.get("needs_confirmation"))
        messages.append(md)
    thread["messages"] = messages
    return thread


def delete_agent_thread(thread_id: str) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM agent_messages WHERE thread_id = ?", (thread_id,))
        cur = conn.execute("DELETE FROM agent_threads WHERE id = ?", (thread_id,))
        return cur.rowcount > 0


async def _run_plan_steps_stream(
    *,
    thread_id: str,
    goal: str,
    plan_summary: str,
    steps: list[dict[str, Any]],
    artifacts_state: dict[str, Any],
) -> AsyncGenerator[str, None]:
    t0 = time.time()
    ctx: dict[str, Any] = {
        "goal": goal,
        "shared_context": "",
        "artifacts": dict(artifacts_state),
    }
    traces: list[dict[str, Any]] = []
    linked_items: list[dict[str, Any]] = []

    clean_steps = [st for st in steps if str(st.get("tool") or "") in TOOL_REGISTRY][:6]
    yield sse_event("plan", {"thread_id": thread_id, "summary": plan_summary, "steps": clean_steps})

    for idx, st in enumerate(clean_steps, start=1):
        tool_name = str(st.get("tool") or "")
        step_label = str(st.get("step_label") or f"执行第 {idx} 步")
        args = dict(st.get("args") or {})

        yield sse_event(
            "step_start",
            {"index": idx, "total": len(clean_steps), "tool": tool_name, "label": step_label},
        )
        fn = TOOL_REGISTRY[tool_name]
        try:
            res = await fn(args, ctx)
        except Exception as exc:
            res = {
                "ok": False,
                "summary": f"步骤执行遇阻：{exc}",
                "context_text": "",
                "linked_item": None,
                "auto_repaired": False,
            }

        if res.get("context_text"):
            ctx["shared_context"] = (
                (ctx["shared_context"] + "\n\n" + str(res["context_text"])).strip()
            )[-7500:]

        if res.get("linked_item"):
            item = res["linked_item"]
            # Deduplicate by (kind, id), keeping latest update
            linked_items = [x for x in linked_items if not (x.get("kind") == item.get("kind") and x.get("id") == item.get("id"))]
            linked_items.append(item)

        trace_entry = {
            "index": idx,
            "tool": tool_name,
            "label": step_label,
            "ok": bool(res.get("ok")),
            "summary": str(res.get("summary") or ""),
            "auto_repaired": bool(res.get("auto_repaired")),
        }
        traces.append(trace_entry)
        yield sse_event("step_done", trace_entry)

    # Compose clean, concise plain-Chinese final assistant reply
    trace_lines = "\n".join(f"- {t['label']}：{t['summary']}" for t in traces)
    try:
        final_text, _ = await call_llm(
            system_prompt="你是教学工作台主助手。请用平实简短的简体中文总结本次已完成的工作与成果（不超过180字），严禁使用浮夸词汇，严禁提及任何代码、文件名后缀、接口或底层工具名字。",
            user_prompt=f"用户需求：{goal}\n已完成各步结果：\n{trace_lines}\n请简明扼要汇报结果，并提示右侧可预览、下载或直接跳去对应页面微调。",
            max_tokens=800,
            temperature=0.2,
        )
    except Exception:
        final_text = f"已完成本次任务，共执行 {len(traces)} 个步骤：\n{trace_lines}"

    final_clean = (final_text or "").strip() or f"已完成任务，产出 {len(linked_items)} 项教学成果。"
    now = time.time()
    title_cand = goal.strip()[:22] + ("…" if len(goal.strip()) > 22 else "")
    with get_conn() as conn:
        t_cur = conn.execute("SELECT title FROM agent_threads WHERE id = ?", (thread_id,)).fetchone()
        new_title = title_cand if (t_cur and t_cur["title"] in ("新协同任务", "新任务")) else (t_cur["title"] if t_cur else title_cand)
        conn.execute(
            """
            UPDATE agent_threads
            SET title = ?, status = 'completed', plan_json = ?, pending_goal = '', artifacts_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_title, json.dumps(clean_steps, ensure_ascii=False), json.dumps(ctx["artifacts"], ensure_ascii=False), now, thread_id),
        )
        msg_id = new_id("amsg")
        conn.execute(
            """
            INSERT INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
            VALUES (?, ?, 'assistant', ?, ?, ?, ?, 0, ?)
            """,
            (
                msg_id,
                thread_id,
                final_clean,
                json.dumps(clean_steps, ensure_ascii=False),
                json.dumps(traces, ensure_ascii=False),
                json.dumps(linked_items, ensure_ascii=False),
                now,
            ),
        )

    duration_ms = int((time.time() - t0) * 1000)
    log_telemetry("agent", "multi_step_execute", duration_ms=duration_ms, verified_ok=True, meta={"steps": len(traces)})
    updated_thread = get_agent_thread(thread_id)
    yield sse_event(
        "result",
        {
            "thread": updated_thread,
            "message": {
                "id": msg_id,
                "role": "assistant",
                "content": final_clean,
                "plan": clean_steps,
                "tool_traces": traces,
                "linked_items": linked_items,
                "needs_confirmation": False,
                "created_at": now,
            },
            "linked_items": linked_items,
            "duration_ms": duration_ms,
        },
    )


async def handle_agent_chat_stream(
    *,
    thread_id: str | None,
    user_message: str,
    require_plan_confirmation: bool = False,
    speed_mode: str = "standard",
) -> AsyncGenerator[str, None]:
    """Stream planning, clarification/confirmation or multi-step autonomous execution for an agent turn."""
    goal = (user_message or "").strip()
    if not goal:
        yield sse_event("error", {"message": "请输入你的教学或学习任务描述。"})
        return
    is_fast = (speed_mode or "standard").strip().lower() == "fast"
    if is_fast:
        require_plan_confirmation = False

    if not thread_id:
        th = create_agent_thread(goal[:20])
        tid = th["id"]
    else:
        th = get_agent_thread(thread_id)
        if not th:
            th = create_agent_thread(goal[:20])
        tid = th["id"]

    now = time.time()
    u_msg_id = new_id("amsg")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
            VALUES (?, ?, 'user', ?, '[]', '[]', '[]', 0, ?)
            """,
            (u_msg_id, tid, goal, now),
        )

    yield sse_event("stage", {"stage": "planning", "message": "正在分析目标、查阅已收录讲义与学习记录…"})

    docs = list_indexed_documents()
    doc_lines = [f"- {d['title']}（{d['chunk_count']} 段）" for d in docs[:10]]
    mem_ctx = build_memory_context_text("both")
    hist_lines = []
    for m in (th.get("messages") or [])[-4:]:
        who = "用户" if m["role"] == "user" else "助手"
        hist_lines.append(f"{who}：{m['content'][:160]}")

    planner_prompt = (
        f"当前会话已有联动成果 ID：{json.dumps(th.get('artifacts') or {}, ensure_ascii=False)}\n"
        f"执行模式：{'快速模式（仅保留 1~2 个最直接的关键步骤）' if is_fast else '标准协同模式（可完整规划多步联动与检索）'}\n"
        f"已收录讲义资料库：\n" + ("\n".join(doc_lines) if doc_lines else "（暂无上传讲义）") + "\n\n"
        f"{mem_ctx}\n\n"
        + ("近期对话：\n" + "\n".join(hist_lines) + "\n\n" if hist_lines else "")
        + f"用户最新指令：{goal}\n"
    )

    try:
        plan_obj, _ = await call_llm_json(
            system_prompt=_PLANNER_SYSTEM_PROMPT,
            user_prompt=planner_prompt,
            max_tokens=2200,
            temperature=0.1,
        )
    except Exception as exc:
        yield sse_event("error", {"message": f"任务规划未能完成：{exc}"})
        return

    decision = str(plan_obj.get("decision") or "execute_now")
    steps = plan_obj.get("steps") or []
    if is_fast and steps:
        steps = steps[:2]

    if decision == "clarify" or not steps:
        q_text = str(plan_obj.get("clarify_question") or "请补充要备课或练习的具体学科与知识点（例如“高一集合与逻辑”或“基于薄弱点出巩固卷”）。")
        opts = [str(o) for o in (plan_obj.get("clarify_options") or [])[:3]]
        reply_full = q_text + ("\n\n快捷选项：" + " ｜ ".join(opts) if opts else "")
        a_id = new_id("amsg")
        with get_conn() as conn:
            conn.execute(
                "UPDATE agent_threads SET status = 'waiting_clarify', updated_at = ? WHERE id = ?",
                (time.time(), tid),
            )
            conn.execute(
                """
                INSERT INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
                VALUES (?, ?, 'assistant', ?, '[]', '[]', '[]', 0, ?)
                """,
                (a_id, tid, reply_full, time.time()),
            )
        yield sse_event(
            "clarify",
            {
                "thread": get_agent_thread(tid),
                "question": q_text,
                "options": opts,
            },
        )
        return

    plan_summary = str(plan_obj.get("plan_summary") or "将按以下步骤协同执行：")
    if require_plan_confirmation:
        a_id = new_id("amsg")
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE agent_threads
                SET status = 'awaiting_confirmation', plan_json = ?, pending_goal = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(steps, ensure_ascii=False), goal, time.time(), tid),
            )
            conn.execute(
                """
                INSERT INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
                VALUES (?, ?, 'assistant', ?, ?, '[]', '[]', 1, ?)
                """,
                (a_id, tid, f"{plan_summary} 确认后将自动完成以下步骤：", json.dumps(steps, ensure_ascii=False), time.time()),
            )
        yield sse_event(
            "plan_confirmation",
            {
                "thread": get_agent_thread(tid),
                "summary": plan_summary,
                "steps": steps,
            },
        )
        return

    async for evt in _run_plan_steps_stream(
        thread_id=tid,
        goal=goal,
        plan_summary=plan_summary,
        steps=steps,
        artifacts_state=th.get("artifacts") or {},
    ):
        yield evt


async def execute_confirmed_thread_plan(thread_id: str) -> AsyncGenerator[str, None]:
    th = get_agent_thread(thread_id)
    if not th or not th.get("plan"):
        yield sse_event("error", {"message": "当前会话没有待确认的执行方案。"})
        return
    goal = th.get("pending_goal") or th.get("title") or "确认执行既定方案"
    async for evt in _run_plan_steps_stream(
        thread_id=thread_id,
        goal=goal,
        plan_summary="已确认方案，开始依次执行各模块任务：",
        steps=th["plan"],
        artifacts_state=th.get("artifacts") or {},
    ):
        yield evt
