"""First-run showcase data bootstrapper producing genuine compiled PPTX/DOCX/SymPy artifacts."""

from __future__ import annotations

import datetime
import json
import time
from pathlib import Path

from core.config import STORAGE_DIR
from core.database import get_conn, log_telemetry, upsert_artifact
from engines.analytics_engine import SAMPLE_CSV_CONTENT, compute_deterministic_analytics, desensitize_csv_text
from engines.docx_compiler import compile_analytics_docx, compile_exam_docx, compile_lesson_docx
from engines.knowledge_index import index_markdown_document
from engines.math_verifier import run_symbolic_checks
from engines.memory_engine import DEFAULT_TEACHER_PREFERENCES, sync_error_book_to_memory, update_teacher_preferences
from engines.mindmap_engine import build_mindmap_from_topic, compile_drawio_xml
from engines.pedagogy_kb import load_pedagogy_corpus
from engines.ppt_bridge import compile_ppt_project
from engines.question_bank_engine import assemble_from_bank
from engines.source_ingestor import convert_uploaded_source_to_markdown

SHOWCASE_VERSION = "v4.1"


def ensure_showcase_data() -> None:
    """Populate realistic verified showcase artifacts and auto-upgrade when SHOWCASE_VERSION advances."""
    version_file = STORAGE_DIR / "showcase_version.txt"
    with get_conn() as conn:
        cnt = conn.execute("SELECT COUNT(*) FROM ppt_decks").fetchone()[0]
        if cnt > 0 and version_file.is_file() and version_file.read_text(encoding="utf-8").strip() == SHOWCASE_VERSION:
            return

    now = time.time()

    # 1. Showcase Lesson Plan
    lesson_id = "les_showcase_01"
    lesson_data = {
        "id": lesson_id,
        "title": "函数的单调性与导数（人教A版·15分钟微格试讲示范）",
        "subject": "高中数学",
        "grade_level": "高二年级",
        "lesson_type": "师范生微格试讲",
        "duration": "15 分钟（精炼微格版）",
        "objectives": [
            "知识与技能：能结合几何直观理解导数正负与函数单调性的内在联系，掌握利用导数求函数单调区间的规范步骤。",
            "数学核心素养：经历“切线斜率直观感知 → 严密代数归纳 → 典型例题变式”的思维过程，渗透数形结合与分类讨论思想。",
            "思政与严谨意识：辨析“导数为零”与“极值点/单调性改变”的逻辑边界，养成定义域优先的科学推理习惯。",
        ],
        "learner_analysis": "学生已掌握常见初等函数求导公式与导数的几何意义（切线斜率），但容易忽略函数定义域边界，且常将 f'(x)>0 误等同于严格递增的充要条件。",
        "key_points": "利用导数符号判定函数单调区间的四步标准程序（定域 → 求导 → 找零点与间断点 → 列表判符号）。",
        "difficult_points": "1) 含参函数单调性的不重不漏分类讨论；2) 理解 f'(x)≥0 且仅在离散点处等于零时函数依然单调递增（如 f(x)=x³）。",
        "teaching_steps": [
            {
                "phase": "一、情境引入与几何直观",
                "duration": "2 分钟",
                "teacher_activity": "展示过山车爬坡与俯冲轨迹，提问：切线斜率正负如何刻画曲线升降？",
                "student_activity": "观察切线倾斜角从锐角到钝角的变化，猜想 f'(x)>0 对应上升。",
                "design_intent": "以几何直观破除抽象畏难情绪，建立导数符号与图象趋势的直觉锚点。",
            },
            {
                "phase": "二、严谨辨析与反例建构",
                "duration": "4 分钟",
                "teacher_activity": "追问：若函数在 (a,b) 上单调递增，是否必有 f'(x)>0？展示 f(x)=x³ 在 x=0 处的切线。",
                "student_activity": "计算 f'(x)=3x²≥0，发现 x=0 处切线水平但不影响整体递增。",
                "design_intent": "通过关键反例建立充分条件与必要条件的严密边界，避免概念滑坡。",
            },
            {
                "phase": "三、典例精讲与四步程序",
                "duration": "6 分钟",
                "teacher_activity": "板演 f(x)=x³-3x²+2 的单调区间求解，强调列表法检验符号变号并核对驻点极值结果。",
                "student_activity": "同步完成草稿演练，归纳“定域、求导、求根、列表”四步操作口诀。",
                "design_intent": "将方法程序化、可核验化，降低后续含参讨论的出错率。",
            },
            {
                "phase": "四、课堂小结与分层练习",
                "duration": "3 分钟",
                "teacher_activity": "引导学生回顾板书脉络，布置基础巩固与含参拔高两道微格作业。",
                "student_activity": "用一句话总结本节核心口诀，完成随堂 1 分钟微测。",
                "design_intent": "实现知识结构化收束，为课后错题闭环提供诊断依据。",
            },
        ],
        "blackboard_design": "【主板书】函数的单调性与导数\n1. 核心定理：若区间内 $f'(x) > 0 \\Rightarrow$ 函数严格递增；$f'(x) < 0 \\Rightarrow$ 函数严格递减\n2. 规范四步：① 先定定义域 → ② 求导并因式分解 → ③ 找驻点与间断点 → ④ 列表判符号\n3. 范例结论：$f(x) = x^3 - 3x^2 + 2$ 在 $(-1, 0)$ 和 $(2, 3)$ 递增，在 $(0, 2)$ 递减\n【副板书】高频反例与作答禁忌\n1. 反例警示：$f(x) = x^3$ 在 $x = 0$ 处 $f'(0) = 0$（切线水平），但在 $\\mathbb{R}$ 上仍严格递增\n2. 充要边界：$f'(x) \\ge 0$ 且不在任何子区间恒为零\n3. 书写作答：多个单调增区间必须写“和”或逗号，严禁直接用并集符号 $\\cup$！",
        "exercises": [
            {
                "tier": "基础巩固",
                "question": "求函数 $f(x) = x^3 - 3x^2 + 2$ 在 $[-1, 3]$ 上的单调递增区间与极值。",
                "solution": "$f'(x)=3x(x-2)$。递增区间为 $(-1,0)$ 与 $(2,3)$，递减区间为 $(0,2)$；极大值 $f(0)=2$，极小值 $f(2)=-2$。",
            },
            {
                "tier": "思维拔高",
                "question": "若函数 $g(x) = x + \\frac{a}{x}$ 在 $(1, +\\infty)$ 上单调递增，求实数 $a$ 的取值范围。",
                "solution": "$g'(x)=1 - \\frac{a}{x^2} \\ge 0$ 在 $(1, +\\infty)$ 恒成立，即 $a \\le x^2$ 恒成立，故 $a \\le 1$（注意等号 $a=1$ 时仅在端点取零，仍递增）。",
            },
        ],
        "verification_checklist": [
            "已核查定义域优先原则：对数、分式函数必先声明定义域。",
            "已核对例题 f(x)=x³-3x²+2 驻点 x=0, 2 及极值 f(0)=2, f(2)=-2。",
            "试讲语速与板书时间匹配 15 分钟微格试讲要求。",
        ],
    }
    lesson_docx = compile_lesson_docx({**lesson_data, "edit_count": 0}, lesson_id)
    lesson_art = upsert_artifact(
        "art_showcase_lesson",
        title=lesson_data["title"],
        category="docx_lesson",
        module="lesson",
        filename=lesson_docx.name,
        file_path=str(lesson_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=lesson_docx.stat().st_size,
        verified_status="verified",
        meta={"lesson_id": lesson_id},
    )
    lesson_text_len = len(json.dumps(lesson_data, ensure_ascii=False))
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (lesson_id, lesson_data["title"], "高中数学", "高二年级", "师范生微格试讲", json.dumps(lesson_data, ensure_ascii=False), lesson_text_len, lesson_art["id"], now, now),
        )

    # 2. Showcase Native PPT Deck (7 slides including SymPy visual_graph & micro-teaching timeline)
    deck_id = "deck_showcase_01"
    slides = [
        {
            "layout": "cover",
            "kicker": "高二数学 · 人教A版微格示范课",
            "title": "函数的单调性与导数",
            "subtitle": "从切线斜率直观感知到四步规范推导",
            "cards": [
                {"heading": "数形结合直观"},
                {"heading": "微格节奏控制"},
                {"heading": "文本可在线编辑"},
            ],
            "speaker_notes": "各位评委老师好！今天我试讲的课题是人教A版高中数学选择性必修第二册《函数的单调性与导数》。",
        },
        {
            "layout": "objectives",
            "kicker": "教学目标与重难点",
            "title": "本节微格试讲的四大核心坐标",
            "subtitle": "围绕概念生成、数形对照、反例辨析与变式迁移展开",
            "cards": [
                {"heading": "理解导数符号意义", "body": "从汽车仪表盘瞬时速度直观模型，建立导数正负与图象升降的直觉联系。"},
                {"heading": "牢记定义域优先", "body": "求解单调区间前必须首先标定自然定义域，严防区间跨越间断点。"},
                {"heading": "攻克驻点极值边界", "body": "辨析 f'(x) ≥ 0 在离散点为零时的严格递增特性，拒绝机械套结论。"},
                {"heading": "落地四步解题口诀", "body": "定域 → 求导 → 找根 → 列表，确保复杂含参问题推导零失误。"},
            ],
            "takeaway": "把单调性判定从经验直觉升级为可核验的符号推理程序。",
            "speaker_notes": "首先明确本节的四个核心教学坐标，尤其强调定义域优先与反例辨析。",
        },
        {
            "layout": "visual_graph",
            "kicker": "数形结合 · 函数与导数曲线",
            "title": "原函数升降与导函数正负的几何对照",
            "subtitle": "通过 f(x) = x³ - 3x² + 2 与导函数 f'(x) = 3x² - 6x 的同屏映射建立直觉",
            "plot_expr": "x**3 - 3*x**2 + 2",
            "plot_x_min": -1.4,
            "plot_x_max": 3.4,
            "cards": [
                {"heading": "汽车速度表直观", "body": "实线为位置曲线 f(x)，虚线为速度曲线 f'(x)。速度高于横轴时上坡，低于横轴时下坡。"},
                {"heading": "驻点风向标变号", "body": "导数在 x=0 处从正变负（极大值 2），在 x=2 处从负变正（极小值 -2），对应水平切线。"},
                {"heading": "极值变号临界判据", "body": "驻点 x=0 左正右负得极大值 2；x=2 左负右正得极小值 -2，严防孤立驻点误判。"},
            ],
            "takeaway": "导数正负决定原函数切线朝向，导数零点两侧变号才是极值点。",
            "speaker_notes": "同学们请看左侧坐标系：实线代表函数图象，虚线是导数图象。在零点右侧直到 x=2，虚线都在 x 轴下方，因此曲线一路下坡。",
        },
        {
            "layout": "compare",
            "kicker": "深度概念辨析",
            "title": "必要条件与充分条件的逻辑边界",
            "subtitle": "为什么 f'(x) > 0 是单调递增的充分非必要条件？",
            "cards": [
                {
                    "heading": "导数大于零 ⇒ 严格递增",
                    "tag": "充分条件",
                    "bullets": [
                        "在区间 (a,b) 内恒有 f'(x) > 0，则切线斜率处处为正",
                        "由拉格朗日中值定理可得函数在该区间必单调递增",
                        "区间内不允许出现连续一段导数为零的常函数片段",
                    ],
                },
                {
                    "heading": "警惕反例：f(x) = x³",
                    "tag": "易错辨析",
                    "bullets": [
                        "f'(x) = 3x²，在 x = 0 处导数为 0（水平切线）",
                        "但函数 f(x) = x³ 在整个实数轴 R 上依然严格递增",
                        "若求含参递增范围，需检验等号仅在孤立点成立！",
                    ],
                },
            ],
            "takeaway": "可导函数在区间上递增的充要条件是 f'(x) ≥ 0 且不恒为零于任何子区间。",
            "speaker_notes": "再看这组核心辨析：f(x)=x³ 在零点导数为零，但只是水平停顿一瞬，并未掉头下降，因此依然严格递增。",
        },
        {
            "layout": "timeline",
            "kicker": "15 分钟微格试讲节奏轴",
            "title": "四步标准程序与课堂时间分配",
            "subtitle": "把抽象导数方法拆解为可控的试讲节拍与学生探究任务",
            "cards": [
                {"tag": "0-2 min", "heading": "① 标定定义域", "body": "优先检查对数真数 >0 与分母 ≠0，写清开闭区间边界后再求导。"},
                {"tag": "2-6 min", "heading": "② 求导找界点", "body": "对 f'(x) 通分与因式分解，列出 f'(x)=0 实根及定义域间断点。"},
                {"tag": "6-12 min", "heading": "③ 列表判变号", "body": "用穿根法标出各区间 f'(x) 正负号与箭头，禁用并集符号 ∪！"},
                {"tag": "12-15 min", "heading": "④ 口诀收束", "body": "总结“定域、求导、求根、列表”四步法，布置分层微测。"},
            ],
            "takeaway": "多个单调增区间必须写“和”或逗号分隔，严禁用“∪”直接连接。",
            "speaker_notes": "这是我为 15 分钟微格试讲设计的四步推进节奏：前两分钟定域破题，核心六分钟列表判号，并着重提醒避免并集符号。",
        },
        {
            "layout": "example",
            "kicker": "典型例题精讲",
            "title": "典型三次函数的单调区间与极值",
            "subtitle": "规范作答步骤与极值结果对照",
            "cards": [
                {"heading": "典例题干", "body": "已知函数 f(x) = x³ - 3x² + 2，求 f(x) 在闭区间 [-1, 3] 上的单调区间与极值。"},
                {"heading": "分步规范解答", "body": "1) 定义域为 R。f'(x) = 3x² - 6x = 3x(x - 2)。\n2) 令 f'(x) = 0，得驻点 x₁ = 0，x₂ = 2。\n3) 当 x ∈ (-1,0) 和 (2,3) 时 f'(x)>0 递增；当 x ∈ (0,2) 时 f'(x)<0 递减。"},
                {"heading": "易错点与核对结果", "body": "【计算已核对】驻点 x=0 对应极大值 f(0)=2；x=2 对应极小值 f(2)=-2。注意端点不纳入开区间极值判定。"},
            ],
            "takeaway": "极大值 f(0)=2 与极小值 f(2)=-2 均已完成符号微分与代入验证。",
            "speaker_notes": "规范板演这道经典例题：因式分解后锁定 0 与 2 两个驻点，再结合区间正负列表确认极大与极小值。",
        },
        {
            "layout": "quiz",
            "kicker": "课堂随堂微测 & 总结",
            "title": "三阶微测检验与课后拓展任务",
            "subtitle": "从即时反馈到个人错题本三刷法的闭环巩固",
            "cards": [
                {"heading": "基础题：快速判区间", "body": "求 y = x - ln(x) 的单调递减区间。（提示：先定定义域 x > 0，再解 y' < 0 得 (0, 1)）。"},
                {"heading": "进阶题：含参求范围", "body": "若 f(x) = x³ + ax² + x 在 R 上单调递增，求实数 a 范围。（提示：Δ ≤ 0 ⇒ -√3 ≤ a ≤ √3）。"},
                {"heading": "课后三刷反思", "body": "用一句话写下漏写定义域或误用并集的卡点，明日完成 2 道同型变式打卡。"},
            ],
            "takeaway": "今日口诀：定义域先行，因式分解求零点，列表判号防并集。",
            "speaker_notes": "最后请大家用一分钟完成屏幕上两道微测题，课后及时用错题本复盘。我的试讲到此结束，谢谢各位老师！",
        },
    ]
    ppt_res = compile_ppt_project(
        deck_id=deck_id,
        title="函数的单调性与导数微格课件",
        slides=slides,
        theme_id="porcelain_daylight",
    )
    pptx_art = upsert_artifact(
        "art_showcase_pptx",
        title="函数的单调性与导数（演示课件）",
        category="pptx",
        module="ppt",
        filename=ppt_res["pptx_filename"],
        file_path=ppt_res["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=ppt_res["size_bytes"],
        verified_status="verified",
        meta={"deck_id": deck_id, "audit": ppt_res["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ppt_decks (id, title, subject, grade_level, theme_id, project_dir, slides_json, quality_report_json, pptx_audit_json, pptx_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                deck_id,
                "函数的单调性与导数（15分钟微格课件）",
                "高中数学",
                "高二年级",
                "porcelain_daylight",
                ppt_res["project_dir"],
                json.dumps(ppt_res["slides"], ensure_ascii=False),
                json.dumps(ppt_res["quality_report"], ensure_ascii=False),
                json.dumps(ppt_res["pptx_audit"], ensure_ascii=False),
                pptx_art["id"],
                now,
                now,
            ),
        )

    # 3. Showcase Exam (Student + Teacher Verified Editions, KaTeX-formatted)
    exam_id = "exam_showcase_01"
    q1_ver = run_symbolic_checks([{"type": "derivative", "expr": "x**3 - 3*x**2 + 2", "var": "x", "expected": "3*x**2 - 6*x", "label": "导数公式核验"}])
    q2_ver = run_symbolic_checks([{"type": "solve", "equation": "3*x*(x-2)=0", "var": "x", "expected_roots": ["0", "2"], "label": "驻点方程核验"}])
    q3_ver = run_symbolic_checks([{"type": "evaluate", "expr": "x**3 - 3*x**2 + 2", "subs": {"x": 2}, "expected": "-2", "label": "极小值代入核验"}])
    exam_data = {
        "id": exam_id,
        "title": "高二数学《导数与函数的单调性极值》诊断微测",
        "subject": "高中数学",
        "grade_level": "高二年级",
        "total_score": 40,
        "duration_minutes": 25,
        "questions": [
            {
                "id": "q1",
                "type": "单选题",
                "score": 5,
                "difficulty": "基础 (0.82)",
                "knowledge_point": "导数符号与单调区间",
                "stem": "函数 $f(x) = x - \\ln x$ 的单调递减区间为（ ）",
                "options": ["A. (0, 1)", "B. (1, +∞)", "C. (-∞, 1)", "D. (0, +∞)"],
                "answer": "A",
                "analysis": "第一步：确定定义域 $x \\in (0, +\\infty)$；第二步：求导 $f'(x) = 1 - \\frac{1}{x} = \\frac{x-1}{x}$；第三步：令 $f'(x) < 0$ 得 $0 < x < 1$。故递减区间为 $(0, 1)$。",
                "intent": "考查“定义域优先”意识，C 选项专门诱骗忽略 $\\ln x$ 定义域的考生。",
                "verification": q1_ver,
            },
            {
                "id": "q2",
                "type": "单选题",
                "score": 5,
                "difficulty": "中档 (0.68)",
                "knowledge_point": "驻点与极值点辨析",
                "stem": "关于函数 $f(x) = x^3$ 在 $x = 0$ 处的性质，下列说法正确的是（ ）",
                "options": ["A. 是极小值点", "B. 是极大值点", "C. 是驻点但不是极值点", "D. 不可导点"],
                "answer": "C",
                "analysis": "$f'(x) = 3x^2$，故 $f'(0) = 0$，因此 $x=0$ 是驻点；但在 $x=0$ 左右两侧 $f'(x)$ 均大于 0，符号未发生改变，故不是极值点。",
                "intent": "检验是否机械套用“导数为零即极值点”的错误结论。",
                "verification": q2_ver,
            },
            {
                "id": "q3",
                "type": "解答题",
                "score": 15,
                "difficulty": "中档 (0.65)",
                "knowledge_point": "三次函数极值标准求解",
                "stem": "已知函数 $f(x) = x^3 - 3x^2 + 2$，求 $f(x)$ 在区间 $[-1, 3]$ 上的单调区间与极值。",
                "options": [],
                "answer": "递增区间 $(-1, 0)$ 和 $(2, 3)$；递减区间 $(0, 2)$；极大值 $f(0)=2$，极小值 $f(2)=-2$。",
                "analysis": "采分点：① 求导 $f'(x)=3x^2-6x$ (3分)；② 解驻点 $x=0, 2$ (3分)；③ 列表写出单调区间（严禁使用并集符号 $\\cup$）(5分)；④ 写出极大值 $f(0)=2$ 与极小值 $f(2)=-2$ (4分)。",
                "intent": "考查规范解题程序与区间表达细节。",
                "verification": q3_ver,
            },
            {
                "id": "q4",
                "type": "解答题",
                "score": 15,
                "difficulty": "拔高 (0.48)",
                "knowledge_point": "含参单调性恒成立问题",
                "stem": "若函数 $g(x) = x^3 + ax^2 + x$ 在 $\\mathbb{R}$ 上单调递增，求实数 $a$ 的取值范围。",
                "options": [],
                "answer": "$[-\\sqrt{3}, \\sqrt{3}]$",
                "analysis": "采分点：① 转化为 $g'(x)=3x^2+2ax+1 \\ge 0$ 在 $\\mathbb{R}$ 上恒成立 (5分)；② 利用判别式 $\\Delta = 4a^2 - 12 \\le 0$ (6分)；③ 解得 $-\\sqrt{3} \\le a \\le \\sqrt{3}$，并说明取等号时仅在孤立点导数为 $0$ (4分)。",
                "intent": "考查恒成立问题与等号边界严谨性。",
                "verification": {"status": "verified", "badge": "判别式等价条件已校核", "checks": []},
            },
        ],
    }
    stu_docx = compile_exam_docx(exam_data, exam_id, edition="student")
    tea_docx = compile_exam_docx(exam_data, exam_id, edition="teacher")
    stu_art = upsert_artifact(
        "art_showcase_exam_stu",
        title=f"{exam_data['title']}（学生卷）",
        category="docx_exam_student",
        module="exam",
        filename=stu_docx.name,
        file_path=str(stu_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=stu_docx.stat().st_size,
    )
    tea_art = upsert_artifact(
        "art_showcase_exam_tea",
        title=f"{exam_data['title']}（教师解析卷）",
        category="docx_exam_teacher",
        module="exam",
        filename=tea_docx.name,
        file_path=str(tea_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=tea_docx.stat().st_size,
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO exams (id, title, subject, grade_level, exam_json, student_artifact_id, teacher_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (exam_id, exam_data["title"], "高中数学", "高二年级", json.dumps(exam_data, ensure_ascii=False), stu_art["id"], tea_art["id"], now, now),
        )

    # 4. Showcase Error Book Entries (Feynman reflection style)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO error_book (id, subject, grade_level, topic_tag, question_text, my_mistake, key_takeaway, solution_json, mastery_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "err_showcase_01",
                "高中数学",
                "高二年级",
                "定义域优先陷阱",
                "求函数 $f(x) = x - \\ln(x)$ 的单调递减区间。",
                "直接解 $1 - 1/x < 0$ 时忽略 $\\ln x$ 的自然定义域，误写成了 $(-\\infty, 1)$。",
                "求单调区间第一步永远先写定义域！把“定域”放在“求导”前面变成肌肉记忆。",
                json.dumps({"final_answer": "$(0, 1)$", "verification": q1_ver}, ensure_ascii=False),
                2,
                now,
            ),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO error_book (id, subject, grade_level, topic_tag, question_text, my_mistake, key_takeaway, solution_json, mastery_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "err_showcase_02",
                "高中数学",
                "高二年级",
                "驻点≠极值点辨析",
                "判断 $x=0$ 是否为函数 $f(x) = x^3$ 的极值点。",
                "在第二步仅算出 $f'(0)=0$ 就直接下结论说是极值点，未列表检验左右两侧导数是否变号。",
                "极值点不是速度归零，而是从爬坡转向下坡的转折点！用汽车“轻踩刹车后继续前进”模型牢记 $f(x)=x^3$。",
                json.dumps({"final_answer": "是驻点，但不是极值点", "verification": q2_ver}, ensure_ascii=False),
                2,
                now - 60,
            ),
        )

    # 5. Showcase Analytics Report (deterministic stats on 48 anonymized students, exact metric citation)
    rep_id = "ana_showcase_01"
    desens = desensitize_csv_text(SAMPLE_CSV_CONTENT)
    stats = compute_deterministic_analytics(desens, rep_id)
    im_map = {m["item"]: m for m in stats["item_metrics"]}
    q4_pct = im_map.get("Q4_极值与驻点辨析(15分)", {}).get("mastery_pct", 76.4)
    q5_pct = im_map.get("Q5_含参单调性讨论(25分)", {}).get("mastery_pct", 74.0)
    q6_pct = im_map.get("Q6_极值最值综合压轴(25分)", {}).get("mastery_pct", 62.0)
    ai_narrative = {
        "overall_diagnosis": f"本次 {stats['student_count']} 名脱敏样本总分均值 {stats['summary']['mean']} 分，中位数 {stats['summary']['median']} 分，及格率 {stats['summary']['pass_rate']}%，优秀率 {stats['summary']['excellent_rate']}%。",
        "weakness_attribution": f"Q1~Q3 基础与常规求导题掌握率均在 82% 以上；Q4（极值与驻点辨析）掌握率降至 {q4_pct}%，暴露部分学生仍易混用驻点与极值点条件；Q5（{q5_pct}%）与 Q6（{q6_pct}%）含参综合压轴题掌握率显著偏低且区分度高（D > 0.30），表明学生缺少规范分类讨论树意识。",
        "teaching_interventions": [
            f"针对低于及格线的重点关注群体（共 {stats['cohorts']['attention_count']} 名脱敏代号学生），布置《定义域与求导四步过关微测》。",
            "下节课前 10 分钟重点用“汽车刹车与调头”模型重讲 Q4 极值变号判定，并拆解 Q5 参数零点大小比较的数轴分类法。",
        ],
    }
    ana_record = {
        "id": rep_id,
        "title": "高二数学《导数与极值》48人单元测验学情诊断（脱敏示范）",
        "stats": stats,
        "ai_narrative": ai_narrative,
        "desensitize_summary": desens,
        "teacher_reviewed": False,
        "teacher_note": "",
    }
    ana_docx = compile_analytics_docx(ana_record, rep_id)
    ana_art = upsert_artifact(
        "art_showcase_ana",
        title=ana_record["title"],
        category="docx_analytics",
        module="analytics",
        filename=ana_docx.name,
        file_path=str(ana_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=ana_docx.stat().st_size,
        verified_status="needs_review",
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO analytics_reports (id, title, dataset_name, stats_json, ai_narrative_json, desensitize_summary_json, teacher_reviewed, teacher_note, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            """,
            (
                rep_id,
                ana_record["title"],
                "高二导数单元测验_48人示范.csv",
                json.dumps(stats, ensure_ascii=False),
                json.dumps(ai_narrative, ensure_ascii=False),
                json.dumps({k: v for k, v in desens.items() if k != "masked_csv"}, ensure_ascii=False),
                ana_record["teacher_note"],
                ana_art["id"],
                now,
                now,
            ),
        )

    # 6. v3.0 Cross-disciplinary PBL Lesson + PPT + Humanities Lesson + Draw.io Mindmaps
    les_pbl_id = "les_showcase_pbl_02"
    les_pbl_data = {
        "id": les_pbl_id,
        "title": "跨学科PBL：从 Logistic 方程看生态种群容纳量与公卫防控阈值",
        "subject": "跨学科主题学习 (数学×生物×公共卫生)",
        "grade_level": "高二/大学通识",
        "lesson_type": "跨学科主题学习 PBL (45分钟)",
        "duration": "45 分钟（跨学科项目研讨）",
        "objectives": [
            "数学建模素养：将逻辑斯谛增长微分方程 $N'(t)=rN(1-N/K)$ 转化为二次函数极值判别，精准锁定最大增长速率拐点 $N=K/2$。",
            "生命科学与环境观：理解环境容纳量 $K$ 的动态性，辩证对比“渔业可持续捕捞 ($N \\ge K/2$)”与“害虫防治提前压制”。",
            "公共卫生决策素养：推导群体免疫门槛 $p_c = 1 - 1/R_0$，权衡医疗床位承压与社会经济成本的 Pareto 最优区间。",
        ],
        "learner_analysis": "学生分别掌握函数导数极值与高中生物种群 S 型曲线、免疫学常识，但缺乏将三个学科统一为同一个微分数学模型并指导现实政策决策的跨界经验。",
        "key_points": "构建 $N'(t) = rN - \\frac{r}{K}N^2$ 与导数峰值、感染人数压平曲线的统一映射模型。",
        "difficult_points": "1) 区分“总量最多 ($N \\to K$)”与“增速最快 ($N=K/2$)”的导数拐点差异；2) 理解当 $R_0=4$ 时仅需 $75\\%$ 免疫即可使有效传染率跌破 $1$ 的阈值原理。",
        "teaching_steps": [
            {
                "phase": "一、真实困境抛锚（5分钟）",
                "duration": "5 分钟",
                "teacher_activity": "提出东海带鱼限额捕捞配额与城市传染病床位紧张两段真实案例，追问两者共有什么数学曲线？",
                "student_activity": "小组讨论发现两者初期都呈近指数上升、后期受限于资源瓶颈放缓平躺。",
                "design_intent": "以高冲突现实问题打破数学、生物与社会学科壁垒。",
            },
            {
                "phase": "二、跨界数学化推演（15分钟）",
                "duration": "15 分钟",
                "teacher_activity": "把 $N'(t)=rN(1-N/K)$ 类比为“生育引擎×环境刹车”，引导学生用初中抛物线顶点一秒求得增速峰值 $K/2$。",
                "student_activity": "在交互实验画板拖动 $r$ 与 $K$ 滑块，实测验证导数曲线峰顶精准落在 $N=K/2$ 处。",
                "design_intent": "实现符号代数、生物学概念与动态可视化的三重互证。",
            },
            {
                "phase": "三、决策反转与伦理权衡（15分钟）",
                "duration": "15 分钟",
                "teacher_activity": "组织辩论：为什么渔民应保留一半鱼群作种源，而公卫防控必须“压扁新增峰”？推导 $p_c = 1 - 1/R_0$。",
                "student_activity": "测算不同 $R_0$ 传染病所需的接种阈值并分组提交防灾配置评估表。",
                "design_intent": "落实新课标跨学科综合评价中的证据论证与社会责任维度。",
            },
            {
                "phase": "四、总结与四维 Rubric 互评（10分钟）",
                "duration": "10 分钟",
                "teacher_activity": "引导用思维导图梳理“微分—生态—公卫—博弈”四维耦合节点并对照 Rubric 自查。",
                "student_activity": "导出导图与报告草案，识别模型假设中的环境噪声限制。",
                "design_intent": "形成“建模—实验—反思—迁移”完整 PBL 闭环。",
            },
        ],
        "blackboard_design": "【主板书】跨学科同构模型：Logistic × SIR\n1. 生态增长律：$N'(t) = rN(1 - N/K)$\n2. 最速拐点：$N = K/2$ 处 $N''(t)=0$（导数峰值）\n3. 免疫阈值：$R_0(1-p_c) < 1 \\Rightarrow p_c = 1 - 1/R_0$\n【副板书】两类相反决策应用\n1. 可持续渔业：捕捞后回落至 $K/2$ 保持最大再生\n2. 害虫防治：必须在抵达 $K/2$ 拐点前提前干预灭杀\n3. 压扁峰值：降接触率 $\\beta$ 保医疗床位不挤兑",
        "exercises": [
            {
                "tier": "数学×生态",
                "question": "已知某鱼塘环境容纳量 $K = 800$ 万尾，为实现长期年捕捞量最大化，每次捕捞后剩余鱼群数量应维持在多少万尾？",
                "solution": "使种群净增长速率最大即取 $N = K/2 = 400$ 万尾。",
            },
            {
                "tier": "数学×公共卫生",
                "question": "某病毒基本再生数 $R_0 = 5$，若疫苗有效性为 $100\\%$，全人群至少需达到多大比例免疫方能阻断大流行传播？",
                "solution": "由 $p_c = 1 - \\frac{1}{R_0} = 1 - \\frac{1}{5} = 80\\%$，至少需 $80\\%$ 免疫覆盖。",
            },
        ],
        "verification_checklist": [
            "已核查数学微积分导数拐点与生态学 $K/2$ 概念完全自洽。",
            "已配置可交互 Logistic 参数实验供学生实证操作。",
            "评价任务兼具定量计算与社会政策伦理权衡。",
        ],
    }
    les_pbl_docx = compile_lesson_docx({**les_pbl_data, "edit_count": 0}, les_pbl_id)
    les_pbl_art = upsert_artifact(
        "art_showcase_lesson_pbl",
        title=les_pbl_data["title"],
        category="docx_lesson",
        module="lesson",
        filename=les_pbl_docx.name,
        file_path=str(les_pbl_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=les_pbl_docx.stat().st_size,
        verified_status="verified",
        meta={"lesson_id": les_pbl_id},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (
                les_pbl_id,
                les_pbl_data["title"],
                les_pbl_data["subject"],
                les_pbl_data["grade_level"],
                les_pbl_data["lesson_type"],
                json.dumps(les_pbl_data, ensure_ascii=False),
                len(json.dumps(les_pbl_data, ensure_ascii=False)),
                les_pbl_art["id"],
                now - 30,
                now - 30,
            ),
        )

    les_hum_id = "les_showcase_hum_03"
    les_hum_data = {
        "id": les_hum_id,
        "title": "〈赤壁赋〉“水月之辩”意象张力与宋代文人精神突围（文学×哲学×历史）",
        "subject": "人文文学与语言艺术 · 古诗文",
        "grade_level": "高一年级",
        "lesson_type": "新授课 · 文史哲融通",
        "duration": "45 分钟（人文深度研讨）",
        "objectives": [
            "文本审美：厘清《赤壁赋》“泛舟泛月乐 → 闻箫叹逝悲 → 水月哲学喜”的情感起伏双弧线。",
            "哲学思辨：辨析“变与不变”主客问答的认识论参考系转换，破除消极虚无的误解。",
            "史料互证：结合元丰年间乌台诗案与黄州贬谪编年史料，理解苏轼精神突围的真实历史支撑。",
        ],
        "learner_analysis": "学生能顺畅背诵名句，但往往将吹箫客当成纯然路人甲，且容易把结尾豁达误读为消极妥协。",
        "key_points": "领悟“主客本一人”的汉赋对话机制与“观察参考系切换”破除生命焦虑的方法论。",
        "difficult_points": "从字面“不变者物我无尽”中辨析庄子齐物观与儒家入世担当之间微妙的宋代理学平衡。",
        "teaching_steps": [
            {
                "phase": "一、疑窦导入：同一夜江月为何情绪剧震？",
                "duration": "8 分钟",
                "teacher_activity": "提问：开篇明月清风如此良辰美景，为什么箫声突然让全船宾客哀伤泣下？",
                "student_activity": "比对曹操“横槊赋诗”与此时“寄蜉蝣于天地”的时代英雄反差。",
                "design_intent": "立足乐景衬哀情打开历史纵深张力。",
            },
            {
                "phase": "二、哲学思辨：主客即一人的参考系转换",
                "duration": "15 分钟",
                "teacher_activity": "用物理学观察系比拟“自其变者”与“自其不变者”两重宇宙尺度。",
                "student_activity": "小组分饰“悲观之客”与“超然苏子”互辩，并检验“物我无尽”是否等于放任不作为。",
                "design_intent": "以理性思辨打通物理相对性与古典人文哲学境界。",
            },
            {
                "phase": "三、史料互证与迁徙写作",
                "duration": "12 分钟",
                "teacher_activity": "出示黄州东坡开荒与雪堂书札一手史料，印证文字旷达背后顽强实干底色。",
                "student_activity": "仿写一组探讨当代青年焦虑的“变与不变”短论。",
                "design_intent": "实现二重证据法素养与现代书面思辨表达融合。",
            },
        ],
        "blackboard_design": "【主板书】赤壁赋：主客双重人格的突围\n1. 乐（江月清风）→ 悲（沧海一粟）→ 喜（物我无尽）\n2. 变者（个体瞬逝） vs 不变者（宇宙共在）\n3. 落脚点：审视当下审美与入世韧性\n【副板书】跨界史料互证与避坑\n1. 汉赋问答传统：客并非旁人，乃自我怀疑面\n2. 史料锚点：黄州东坡筑室耕读（拒绝躺平）\n3. 哲学参照：庄子齐物 + 北宋格物理性",
        "exercises": [
            {
                "tier": "文史互证",
                "question": "试结合乌台诗案后苏轼在黄州的真实生活史料，评析“主客问答”为何并非单纯的消极避世宣言？",
                "solution": "主客二人即苏轼内心冲突；其借水月喻论证宇宙生生不息，落脚于“耳得之而为声、目遇之而成色”的积极当下创造，且史载其在黄州垦荒筑屋践行入世担当。",
            },
        ],
        "verification_checklist": [
            "文本引文严格核对中华书局通行本原文。",
            "历史年代（元丰五年壬戌之秋七月既望）编年无误。",
            "已提供文史哲跨学科对比讨论脚手架。",
        ],
    }
    les_hum_docx = compile_lesson_docx({**les_hum_data, "edit_count": 0}, les_hum_id)
    les_hum_art = upsert_artifact(
        "art_showcase_lesson_hum",
        title=les_hum_data["title"],
        category="docx_lesson",
        module="lesson",
        filename=les_hum_docx.name,
        file_path=str(les_hum_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=les_hum_docx.stat().st_size,
        verified_status="verified",
        meta={"lesson_id": les_hum_id},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (
                les_hum_id,
                les_hum_data["title"],
                les_hum_data["subject"],
                les_hum_data["grade_level"],
                les_hum_data["lesson_type"],
                json.dumps(les_hum_data, ensure_ascii=False),
                len(json.dumps(les_hum_data, ensure_ascii=False)),
                les_hum_art["id"],
                now - 60,
                now - 60,
            ),
        )

    deck_pbl_id = "deck_showcase_pbl_02"
    slides_pbl = [
        {
            "layout": "cover",
            "kicker": "跨学科主题学习 PBL · 数学 × 生物 × 公卫",
            "title": "Logistic 生态增长与公卫防控阈值",
            "subtitle": "从一根 S 型曲线洞察可持续发展拐点与社会决策权衡",
            "cards": [{"heading": "微分拐点定量"}, {"heading": "生态与公卫同构"}, {"heading": "Rubric 循证决策"}],
            "speaker_notes": "今天我们把高中数学的导数极值、生态学逻辑斯谛增长与公共卫生群体免疫放进同一根 S 型曲线里统一推演。",
        },
        {
            "layout": "objectives",
            "kicker": "跨学科目标协同",
            "title": "打通三门学科的核心建模坐标",
            "subtitle": "以同一组增长参数推导不同现实领域截然相反的决策行动",
            "cards": [
                {"heading": "代数极值转换", "body": "利用二次抛物线顶点直接得出生长速率峰值恰好位于 K/2。"},
                {"heading": "生态渔业留种", "body": "最大可持续捕捞不是养到满池 K，而是维持在半容量 K/2 再生峰。"},
                {"heading": "疫情阈值阻断", "body": "用不等式推导群体免疫门限 1 - 1/R₀ 并评估医疗床位承载压力。"},
                {"heading": "工程经济折中", "body": "结合成本函数权衡预防管控投入与后期突发危机社会损耗。"},
            ],
            "takeaway": "同一数学结构在正负场景下导出精准相反的最优行动律。",
            "speaker_notes": "这四项目标分别对应模型建立、生态决策、公卫阈值计算与政策经济权衡。",
        },
        {
            "layout": "visual_graph",
            "kicker": "跨学科核心动态曲线",
            "title": "Logistic S 型累积曲线与增长峰拐点",
            "subtitle": "以 K = 8 展示 N(t) 递增及单日速率 N'(t) 的拱形极值高峰",
            "plot_expr": "8/(1 + 7*exp(-1.5*x))",
            "plot_x_min": -0.6,
            "plot_x_max": 3.4,
            "cards": [
                {"heading": "早期近 J 型假象", "body": "当 N 远小于 K 时增长受环境阻力极小，呈现极具迷惑性的指数猛增。"},
                {"heading": "N = K/2 最大增长率", "body": "对应导数曲线（红色虚线）达到唯一波峰时刻，即疫情爆发最高单日新增峰。"},
                {"heading": "趋近环境上限收敛", "body": "越过拐点后剩余空间枯竭，增速逐步放缓平缓收敛于环境上限 K。"},
            ],
            "takeaway": "控制与利用的核心抓手全部聚焦在拐点 K/2 两侧斜率突变期。",
            "speaker_notes": "请看左侧曲线图，实线不断爬向天花板 8，而代表新增速率的红虚线恰好在半高位置冲上巅峰后一路下行。",
        },
        {
            "layout": "compare",
            "kicker": "跨界决策大反转",
            "title": "为什么“渔业”与“防疫/灭虫”行动完全相反？",
            "subtitle": "深刻对比收益最大化 vs 危害最小化在 K/2 两侧的策略分岔",
            "cards": [
                {"heading": "渔业可持续：死守 K/2", "tag": "正向收益", "bullets": ["每次捕捞后刻意保留 K/2 种群基数", "充分利用此处最高生物出生净增量", "切忌超采跌落左坡导致群体崩溃"]},
                {"heading": "害虫防治：截杀于前", "tag": "负向压制", "bullets": ["绝不可等虫群长到 K/2 再开始扑杀", "一旦接近半容量拐点单日暴增不可控", "在早坡基数微弱期干预事半功倍"]},
            ],
            "takeaway": "懂导数的人不会只盯总数看表象，而会提前盯着速率变化率动手。",
            "speaker_notes": "对比这张表格，同一张导数峰曲线对渔民是摇钱树，对农业和疾控则是必须提前越过的红线警报。",
        },
        {
            "layout": "steps",
            "kicker": "三步导出关键公卫线",
            "title": "从基本再生数 R₀ 算出免疫覆盖底线",
            "subtitle": "人人听得懂的高中不等式破除流行病盲区",
            "cards": [
                {"heading": "1. 定义有效再生数", "body": "若 1 名患者在全易感人群中可传 R₀ 人，现人群已有 p 比例具备免疫免疫力。"},
                {"heading": "2. 建立灭绝不等式", "body": "仅剩 1 - p 易感者可被传染，要使每代感染人数越来越少，必须满足 R₀(1 - p) < 1。"},
                {"heading": "3. 锁定阈值 1 - 1/R₀", "body": "解得关键护城河 p > 1 - 1/R₀：R₀=4 需 75% 免疫，R₀=5 需 80%。"},
            ],
            "takeaway": "数学阈值清晰界定了个体行动保护群体弱者的公共卫生底线。",
            "speaker_notes": "只需简单移项三步，我们便把复杂的流行病传代模型翻译为直观的不等式结论。",
        },
        {
            "layout": "data_chart",
            "kicker": "仿真情景推演指标",
            "title": "不同干预时机对医疗峰值的削峰效应",
            "subtitle": "模拟早介入、中介入与零干预下的峰值医疗资源占位比 (%)",
            "chart_title": "三种公卫策略下的重疾峰值占床率对比 (%)",
            "chart_bars": [
                {"label": "零干预放任", "value": 98},
                {"label": "高峰后补救", "value": 74},
                {"label": "拐点前压峰", "value": 36},
                {"label": "综合疫苗+通风", "value": 18},
            ],
            "cards": [
                {"heading": "提前干预显著削峰", "body": "在接近拐点前介入压降有效再生数，可将医院极值占位压降超六成。"},
                {"heading": "避免医疗挤兑次生灾害", "body": "只要峰值稳居警戒线之下，其它基础急救病患便不会发生无床悲剧。"},
                {"heading": "动态校准代价权重", "body": "结合疫苗接种提升与科学通风，以最小经济停摆换取高韧性防御。"},
            ],
            "takeaway": "定量仿真柱图直观印证了“早一拍降阻”带来的巨额社会收益。",
            "speaker_notes": "柱图数据对比十分震撼，提前介入削平峰值，能彻底避免医疗系统的剧烈挤兑危机。",
        },
        {
            "layout": "quiz",
            "kicker": "小组答辩与结构梳理",
            "title": "结合思维导图完成项目评估与说明",
            "subtitle": "梳理多学科变量联系，用评价量规自查方案完整性",
            "cards": [
                {"heading": "定量测算关", "body": "给定城市 K 与传染再生参数，独立求出不越界疫苗配比底线。"},
                {"heading": "跨界建模关", "body": "指出模型中“人群均匀混合”假设在实际地铁/校园场景下的偏差及修正方向。"},
                {"heading": "伦理平衡关", "body": "对比高风险人群优先保护与全域平均限行的社会经济学公平性。"},
            ],
            "takeaway": "真正优秀的跨学科方案必须经得起定量计算与人本追问的双重检验。",
            "speaker_notes": "请大家结合今天的导图工具，在课后用四维评价量规完善各小组的跨学科提案！",
        },
    ]
    ppt_pbl_res = compile_ppt_project(
        deck_id=deck_pbl_id,
        title="Logistic生态增长与公卫防控PBL课件",
        slides=slides_pbl,
        theme_id="emerald_chalkboard",
    )
    ppt_pbl_art = upsert_artifact(
        "art_showcase_pptx_pbl",
        title="跨学科：Logistic生态与公卫阈值（演示课件）",
        category="pptx",
        module="ppt",
        filename=ppt_pbl_res["pptx_filename"],
        file_path=ppt_pbl_res["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=ppt_pbl_res["size_bytes"],
        verified_status="verified",
        meta={"deck_id": deck_pbl_id, "audit": ppt_pbl_res["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ppt_decks (id, title, subject, grade_level, theme_id, project_dir, slides_json, quality_report_json, pptx_audit_json, pptx_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                deck_pbl_id,
                "跨学科PBL：Logistic生态与公卫防控阈值（7页示范）",
                "跨学科主题学习 (PBL)",
                "高二/大学通识",
                "emerald_chalkboard",
                ppt_pbl_res["project_dir"],
                json.dumps(ppt_pbl_res["slides"], ensure_ascii=False),
                json.dumps(ppt_pbl_res["quality_report"], ensure_ascii=False),
                json.dumps(ppt_pbl_res["pptx_audit"], ensure_ascii=False),
                ppt_pbl_art["id"],
                now - 30,
                now - 30,
            ),
        )

    # 7. Showcase Draw.io Mindmaps (2 native mxGraphModel maps saved in mindmaps & artifacts)
    corpus_map = {t["id"]: t for t in load_pedagogy_corpus()}
    for m_idx, (map_id, topic_id, art_id, ts_offset) in enumerate(
        [
            ("mmap_showcase_01", "zhihu_deriv_mono", "art_showcase_mmap_01", 0),
            ("mmap_showcase_pbl_02", "v3_pbl_sponge_city", "art_showcase_mmap_02", 30),
        ]
    ):
        t_obj = corpus_map.get(topic_id)
        if not t_obj:
            continue
        g_obj = build_mindmap_from_topic(t_obj)
        xml_str, xml_path = compile_drawio_xml(g_obj, map_id)
        m_art = upsert_artifact(
            art_id,
            title=f"思维导图：{g_obj['title']}",
            category="drawio",
            module="tutor",
            filename=xml_path.name,
            file_path=str(xml_path),
            mime_type="application/xml",
            size_bytes=xml_path.stat().st_size,
            verified_status="verified",
            meta={"mindmap_id": map_id, "node_count": len(g_obj.get("nodes") or [])},
        )
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mindmaps (id, title, subject, domain_id, branch, graph_json, drawio_xml, artifact_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    map_id,
                    g_obj["title"],
                    t_obj["subject"],
                    t_obj.get("domain_id", ""),
                    t_obj.get("branch", ""),
                    json.dumps(g_obj, ensure_ascii=False),
                    xml_str,
                    m_art["id"],
                    now - ts_offset,
                    now - ts_offset,
                ),
            )

    # 8. v3.5 Showcase Additions: Abstract Algebra Lesson, Astronomy PPT Deck, Renjiao-A Bank Exam
    les_alg_id = "les_showcase_alg_04"
    les_alg_data = {
        "id": les_alg_id,
        "title": "抽象代数：陪集分解、正规子群与商群构造",
        "subject": "大学数学 · 抽象代数",
        "grade_level": "大学本科/师范",
        "lesson_type": "45分钟新授课",
        "duration": "45 分钟",
        "objectives": [
            "理解左等价关系诱导的群 $G$ 按子群 $H$ 的陪集划分，掌握拉格朗日定理 $|G| = [G:H]|H|$ 的严谨证明与整除推论。",
            "明确商集合 $G/N$ 上群乘法良定义的充要条件是正规子群条件 $gNg^{-1} = N$。",
            "能分辨拉格朗日定理的逆命题不成立（如 $A_4$ 不含 6 阶子群），并应用同态第一定理识别具体商群同构结构。",
        ],
        "learner_analysis": "学生已熟悉对称群 $S_n$ 置换乘法与循环子群阶数计算，但初学商群时容易直接照搬乘法 $(aH)(bH)=(ab)H$ 而忽略代表元选取无关性的良定义证明。",
        "key_points": "陪集等势分解构造双射 $h \\mapsto gh$ 与正规子群确保商群乘法良定义。",
        "difficult_points": "1) 为何非阿贝尔群的左陪集与右陪集可能不同；2) 借助交错群 $A_4$ 反例打破对“因子必存在对应阶子群”的直觉预设。",
        "teaching_steps": [
            {
                "phase": "一、从模剩余类引入陪集等价分解",
                "duration": "10 分钟",
                "teacher_activity": "以整数加群 $\\mathbb{Z}$ 对子群 $n\\mathbb{Z}$ 的模 $n$ 划分启发一般群上的左同余关系 $a^{-1}b \\in H$。",
                "student_activity": "检验自反性、对称性与传递性，得出任意两个左陪集要么完全相等要么互不相交。",
                "design_intent": "从熟悉的数论模同余平稳过渡到一般非交换群的陪集划分。",
            },
            {
                "phase": "二、双射等势与拉格朗日定理",
                "duration": "12 分钟",
                "teacher_activity": "构造左平移映射 $h \\mapsto gh$，证明任意陪集基数均等于 $|H|$，从而导出 $|G|=[G:H]|H|$。",
                "student_activity": "推演素数阶群必为循环群，并检验元素阶 $\\mathrm{ord}(a)$ 必整除群阶 $|G|$。",
                "design_intent": "建立集合划分与群阶整除之间的严格算术桥梁。",
            },
            {
                "phase": "三、代表元冲突与正规子群",
                "duration": "15 分钟",
                "teacher_activity": "在 $S_3$ 中取非正规子群 $H=\\{e, (1\\;2)\\}$，演示不同代表元给出不同乘积陪集，自然逼出 $gNg^{-1}=N$。",
                "student_activity": "动手计算左陪集与右陪集，验证指数为 2 的子群必定正规。",
                "design_intent": "先制造计算矛盾再给出定义，使学生理解正规子群条件的必然性。",
            },
            {
                "phase": "四、商群同构应用与课后梳理",
                "duration": "8 分钟",
                "teacher_activity": "总结“同态核 = 正规子群，商群 = 同态像”，布置循环群商群判定练习。",
                "student_activity": "完成分层巩固练习并记录边界反例。",
                "design_intent": "收束商群与群同态基本定理的内在统一。",
            },
        ],
        "blackboard_design": "【主板书】陪集、拉格朗日定理与商群\n1. 左等价：$a \\sim b \\iff a^{-1}b \\in H$，等价类 $[a] = aH$\n2. 双射等势：$|aH| = |H| \\implies |G| = [G:H]\\cdot |H|$\n3. 良定义条件：$(a_1 N)(b_1 N) = (ab)N \\iff gNg^{-1} = N$\n【副板书】高频辨析与反例\n1. 反例：$|A_4| = 12$，但 $A_4$ 不含 6 阶子群\n2. 判定技巧：$[G:N] = 2 \\implies N \\triangleleft G$\n3. 群同态基本定理：$G/\\ker(\\varphi) \\cong \\mathrm{Im}(\\varphi)$",
        "exercises": [
            {
                "tier": "基础巩固",
                "question": "设 $G = \\mathbb{Z}_{12}$，$H = \\langle 4 \\rangle = \\{0, 4, 8\\}$，列出 $G/H$ 的全部陪集并指出其阶数。",
                "solution": "共 4 个陪集：$H=\\{0,4,8\\},\\ 1+H=\\{1,5,9\\},\\ 2+H=\\{2,6,10\\},\\ 3+H=\\{3,7,11\\}$；商群 $G/H \\cong \\mathbb{Z}_4$，阶数为 $4$。",
            },
            {
                "tier": "反例辨析",
                "question": "在对称群 $S_3$ 中取 $H = \\{e, (1\\;2)\\}$，验证 $H$ 是否为 $S_3$ 的正规子群。",
                "solution": "取 $\\sigma = (1\\;3)$，左陪集 $(1\\;3)H = \\{(1\\;3), (1\\;2\\;3)\\}$，右陪集 $H(1\\;3) = \\{(1\\;3), (1\\;3\\;2)\\}$，两者不等，故 $H$ 不是正规子群。",
            },
        ],
        "verification_checklist": [
            "已明确区分非交换群中的左陪集与右陪集。",
            "已通过具体置换算例核对 S_3 子群的正规性反例。",
            "已包含拉格朗日定理逆命题反例说明。",
        ],
    }
    les_alg_docx = compile_lesson_docx({**les_alg_data, "edit_count": 0}, les_alg_id)
    les_alg_art = upsert_artifact(
        "art_showcase_lesson_alg",
        title=les_alg_data["title"],
        category="docx_lesson",
        module="lesson",
        filename=les_alg_docx.name,
        file_path=str(les_alg_docx),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=les_alg_docx.stat().st_size,
        verified_status="verified",
        meta={"lesson_id": les_alg_id},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (
                les_alg_id,
                les_alg_data["title"],
                les_alg_data["subject"],
                les_alg_data["grade_level"],
                les_alg_data["lesson_type"],
                json.dumps(les_alg_data, ensure_ascii=False),
                len(json.dumps(les_alg_data, ensure_ascii=False)),
                les_alg_art["id"],
                now - 90,
                now - 90,
            ),
        )

    deck_astro_id = "deck_showcase_astro_03"
    slides_astro = [
        {
            "layout": "cover",
            "kicker": "大学科学通识 · 天文学与测量物理",
            "title": "行星运动、潮汐锁定与宇宙距离阶梯",
            "subtitle": "从地月潮汐力学到百亿光年量天测距尺的系统梳理",
            "cards": [{"heading": "开普勒与角动量"}, {"heading": "潮汐锁定与天平动"}, {"heading": "五级宇宙量天尺"}],
            "speaker_notes": "今天我们从地球出发，依次解释为何月球始终只露出同一面、行星遵循什么轨道规律，以及天文学家如何丈量深空距离。",
        },
        {
            "layout": "objectives",
            "kicker": "课程核心目标",
            "title": "理解太阳系力学机制与深空测距标尺",
            "subtitle": "打通天体力学、几何视差、标准蜡烛与文化星官视角",
            "cards": [
                {"heading": "辨析天体层级尺度", "body": "建立地球、太阳系、银河系与星系团的数量级尺度概念。"},
                {"heading": "解释潮汐锁定成因", "body": "区分潮汐引力差 1/r³ 与万有引力 1/r²，理解 1:1 同步自转与 59% 月面可见现象。"},
                {"heading": "串联开普勒三定律", "body": "由角动量守恒解释面积速度相等，并估算大行星轨道周期 T² ∝ a³。"},
                {"heading": "搭建五级测距阶梯", "body": "明确三角视差、造父变星周光律、Ia 超新星与哈勃红移如何逐级重叠校准。"},
            ],
            "takeaway": "从近地卫星到百亿光年深空，物理规律与接力定标共同构成认知基础。",
            "speaker_notes": "本课围绕天体层级、潮汐锁定力学、开普勒运动与距离阶梯四个核心要点展开。",
        },
        {
            "layout": "visual_graph",
            "kicker": "引力梯度与反平方规律",
            "title": "万有引力 (1/r²) 与潮汐力差 (1/r³) 衰减对比",
            "subtitle": "近距天体受到的潮汐拉伸梯度对距离变化极为敏感",
            "plot_expr": "1/(x**2 + 0.35)",
            "plot_x_min": 0.4,
            "plot_x_max": 3.4,
            "cards": [
                {"heading": "距离加倍，潮汐力减至八分之一", "body": "万有引力按 1/r² 衰减，而天体直径两端受到的引力差按 1/r³ 剧烈下降。"},
                {"heading": "地月潮汐锁定 1:1 周期", "body": "持续潮汐形变摩擦消耗月球原始角动量，最终使其自转周期严格等于公转周期。"},
                {"heading": "天平动露出 59% 月面", "body": "月球自转匀速但椭圆轨道公转速度不均，使地球观测者累计能见约 59% 月面。"},
            ],
            "takeaway": "潮汐锁定不是停止自转，而是自转与公转周期在长期耗散后达成 1:1 同步。",
            "speaker_notes": "左侧曲线演示距离增大时引力场的快速衰减。月球受到的潮汐力差使其自转长期被刹车并锁定在与公转相同的周期。",
        },
        {
            "layout": "compare",
            "kicker": "东西方观星与星表体系对照",
            "title": "中国古代三垣二十八宿与西方黄道星座",
            "subtitle": "观测基准面与社会应用需求决定了两套星空划分逻辑",
            "cards": [
                {
                    "heading": "中国古代星官体系",
                    "tag": "赤道坐标系 · 授时",
                    "bullets": ["以北天极紫微垣为核心，围绕天赤道划分二十八宿", "直接观测黄昏黎明中星位置用于制定农时历法", "星官命名对应地上行政建制与社会秩序"],
                },
                {
                    "heading": "西方现代星座体系",
                    "tag": "黄道带 · 几何测绘",
                    "bullets": ["早期沿太阳周年视路径划分黄道十二星座", "结合希腊神话形象命名并在大航海时代补全南天星图", "现代天文学由国际天文学联合会划定全天 88 星座准确边界"],
                },
            ],
            "takeaway": "不同文明针对同一片星空发展出了兼顾授时历法与几何定标的多样认知体系。",
            "speaker_notes": "东西方对星空的命名反映了各自独特的坐标基准：中国重视北极与赤道宿度以定农时，西方由黄道与航海测绘演进出全天 88 星座。",
        },
        {
            "layout": "steps",
            "kicker": "量天尺牍：由近及远逐级定标",
            "title": "五级宇宙距离阶梯的工作逻辑",
            "subtitle": "任何高一级尺子都必须在重叠距离区间用低一级尺子精准校零",
            "cards": [
                {"heading": "1. 雷达与三角视差", "body": "以地球公转直径为基线测量近邻恒星视角摆动，定义 1 秒差距 pc ≈ 3.26 光年。"},
                {"heading": "2. 造父变星标准蜡烛", "body": "利用脉动周期严格锁定绝对星等的关系，结合表观星等差 m - M 推算河外星系距离。"},
                {"heading": "3. Ia 超新星与宇宙学红移", "body": "借恒定峰值光度超新星衔接哈勃定律 v = H₀d，将测量尺延伸至数十亿光年。"},
            ],
            "takeaway": "没有直接测量全宇宙的万能尺，距离测量依赖环环相扣的重叠定标接力。",
            "speaker_notes": "第一步用地球轨道作几何三角，第二步在重叠星团校准造父变星亮度标尺，第三步再接力到超新星和光谱红移。",
        },
        {
            "layout": "timeline",
            "kicker": "课堂时间安排 (45分钟)",
            "title": "从地月直观问题展开天文学通识探究",
            "subtitle": "层层递进打通宏观尺度、天体物理机制与观测方法论",
            "cards": [
                {"tag": "0-8 min", "heading": "尺度认知破冰", "body": "对比地球、木星、太阳系及银河系空间层次，抛出“59% 月面”疑问。"},
                {"tag": "8-20 min", "heading": "潮汐与轨道物理", "body": "推导潮汐引力差随 1/r³ 衰减机制，阐明开普勒定律背后的角动量守恒。"},
                {"tag": "20-35 min", "heading": "量天阶梯推演", "body": "用双手基线视差课堂实验模拟秒差距，演练绝对星等与视星等换算。"},
                {"tag": "35-45 min", "heading": "中西星图思辨", "body": "对比二十八宿与 88 星座坐标系差异，总结测距误差控制原则。"},
            ],
            "takeaway": "将肉眼生活观察与精密测量物理结合，让学生真正读懂星空背后的物理定律。",
            "speaker_notes": "这是 45 分钟通识示范课的时间节奏，中间特别安排了学生用双指模拟三角视差的课堂小实验。",
        },
        {
            "layout": "quiz",
            "kicker": "随堂检测与思考",
            "title": "天体距离估算与轨道周期检验",
            "subtitle": "运用开普勒第三定律与三角视差公式完成快速验算",
            "cards": [
                {"heading": "轨道周期估算", "body": "已知某小行星半长轴 a = 4 AU，由 T² = a³ 估算其绕日公转周期约为多少年？（答案：8 年）"},
                {"heading": "视差换算检验", "body": "若观测某恒星周年视差 p = 0.25 角秒，它距离太阳系多少秒差距？（答案：d = 1/p = 4 pc ≈ 13.0 光年）"},
                {"heading": "概念辨析作业", "body": "说明为何造父变星周光关系的绝对定标仍须依赖近距恒星三角视差结果。"},
            ],
            "takeaway": "开普勒公式与视差倒数关系是解决基础天体测量问题的两把基本算尺。",
            "speaker_notes": "请同学们动手完成这两道计算题，验证开普勒立方根与秒差距倒数关系。谢谢各位老师！",
        },
    ]
    ppt_astro_res = compile_ppt_project(
        deck_id=deck_astro_id,
        title="行星运动、潮汐锁定与宇宙距离阶梯",
        slides=slides_astro,
        theme_id="azure_scholar",
    )
    ppt_astro_art = upsert_artifact(
        "art_showcase_pptx_astro",
        title="天文学：行星运动与宇宙距离阶梯（演示课件）",
        category="pptx",
        module="ppt",
        filename=ppt_astro_res["pptx_filename"],
        file_path=ppt_astro_res["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=ppt_astro_res["size_bytes"],
        verified_status="verified",
        meta={"deck_id": deck_astro_id, "audit": ppt_astro_res["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ppt_decks (id, title, subject, grade_level, theme_id, project_dir, slides_json, quality_report_json, pptx_audit_json, pptx_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                deck_astro_id,
                "行星运动、潮汐锁定与宇宙距离阶梯",
                "天文学通识",
                "高中/大学通识",
                "azure_scholar",
                ppt_astro_res["project_dir"],
                json.dumps(ppt_astro_res["slides"], ensure_ascii=False),
                json.dumps(ppt_astro_res["quality_report"], ensure_ascii=False),
                json.dumps(ppt_astro_res["pptx_audit"], ensure_ascii=False),
                ppt_astro_art["id"],
                now - 90,
                now - 90,
            ),
        )

    exam_rja_id = "exam_showcase_rja_02"
    rja_res = assemble_from_bank(
        unit="r1-3",
        topics=[],
        mode="thinking",
        preference="balanced",
        count=5,
        duration=45,
        versions=1,
        seed=42,
    )
    if rja_res.get("papers"):
        rja_exam = rja_res["papers"][0]
        rja_exam["id"] = exam_rja_id
        rja_stu_docx = compile_exam_docx(rja_exam, exam_rja_id, edition="student")
        rja_tea_docx = compile_exam_docx(rja_exam, exam_rja_id, edition="teacher")
        rja_stu_art = upsert_artifact(
            "art_showcase_exam_rja_stu",
            title=f"{rja_exam['title']}（学生卷）",
            category="docx_exam_student",
            module="exam",
            filename=rja_stu_docx.name,
            file_path=str(rja_stu_docx),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=rja_stu_docx.stat().st_size,
        )
        rja_tea_art = upsert_artifact(
            "art_showcase_exam_rja_tea",
            title=f"{rja_exam['title']}（教师解析卷）",
            category="docx_exam_teacher",
            module="exam",
            filename=rja_tea_docx.name,
            file_path=str(rja_tea_docx),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=rja_tea_docx.stat().st_size,
        )
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO exams (id, title, subject, grade_level, exam_json, student_artifact_id, teacher_artifact_id, edit_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    exam_rja_id,
                    rja_exam["title"],
                    rja_exam["subject"],
                    rja_exam["grade_level"],
                    json.dumps(rja_exam, ensure_ascii=False),
                    rja_stu_art["id"],
                    rja_tea_art["id"],
                    now - 90,
                    now - 90,
                ),
            )

    # v4.0: Multi-chapter Source Knowledge Index + Persistent Memory + Showcase Multi-Step Thread
    tex_sample = Path(r"c:\Users\zyy20\Downloads\第一讲.tex")
    if tex_sample.is_file():
        try:
            tex_parsed = convert_uploaded_source_to_markdown(tex_sample)
            sets_md = str(tex_parsed["markdown"])
        except Exception:
            sets_md = ""
    else:
        sets_md = ""
    if not sets_md:
        sets_md = (
            "# 集合与常用逻辑用语讲义\n\n"
            "## 第一节 集合的概念与表示\n元素具有确定性、互异性与无序性。常用数集包括自然数集 N、整数集 Z、有理数集 Q、实数集 R。\n\n"
            "## 第二节 集合间的基本关系与运算\n空集是任何集合的子集。交集、并集与补集运算满足德摩根律：$C_U(A \\cup B) = (C_U A) \\cap (C_U B)$。\n\n"
            "## 第三节 充分条件与必要条件\n若 $p \\Rightarrow q$，则 p 是 q 的充分条件，q 是 p 的必要条件；结合集合包含关系“小范围推大范围”不易混淆。"
        )
    index_markdown_document(
        doc_id="doc_showcase_sets_01",
        filename="第一讲_集合与常用逻辑用语.tex",
        title="第一讲：集合与常用逻辑用语讲义",
        markdown_text=sets_md,
    )

    deriv_md = (
        "# 函数单调性与导数专题讲义\n\n"
        "## 一、导数符号与区间单调性\n在某可导区间内，若 $f'(x) > 0$，函数单调递增；但“函数在区间内递增”不能推出严格大于，例如 $f(x)=x^3$ 在 $x=0$ 处切线水平。\n\n"
        "## 二、规范解题四步法\n第一步：先确定定义域（对数、分母、偶次根号优先限定）；第二步：求导并通分因式分解；第三步：寻找驻点与无定义点分段列表；第四步：多个增区间必须用“和”或逗号连接，不能写并集符号。\n\n"
        "## 三、含参单调性分类讨论策略\n遇到 $f'(x)$ 含参数 $a$ 时，按导函数最高次项系数正负、零点是否在定义域内、以及两根大小顺序三级讨论。"
    )
    index_markdown_document(
        doc_id="doc_showcase_deriv_02",
        filename="导数单调性与极值讲义.md",
        title="函数单调性与导数专题讲义",
        markdown_text=deriv_md,
    )

    alg_md = (
        "# 抽象代数：群、陪集分解与商群讲义\n\n"
        "## 第一章 正规子群与左右陪集\n设 H 是群 G 的子群，对任意 a 属于 G，左陪集 $aH$ 构成 G 的一个互不相交等价划分，由此直接得到有限群的拉格朗日定理：$|G| = [G:H] \\cdot |H|$。\n\n"
        "## 第二章 商群与同态基本定理\n仅当子群 N 满足共轭不变性 $gNg^{-1}=N$（正规子群）时，陪集乘法 $(aN)(bN)=(ab)N$ 才是良定义的。商群 $G/N$ 把核 $\\ker \\varphi$ 中的细节折叠，保留同态像的结构本质。"
    )
    index_markdown_document(
        doc_id="doc_showcase_alg_03",
        filename="抽象代数_陪集与商群讲义.md",
        title="抽象代数：陪集分解与商群讲义",
        markdown_text=alg_md,
    )

    sync_error_book_to_memory()
    update_teacher_preferences(DEFAULT_TEACHER_PREFERENCES)

    thr_id = "thr_showcase_01"
    thr_plan = [
        {"tool": "search_materials", "step_label": "检索《函数单调性与导数》讲义重难点与四步解法", "args": {"query": "导数 单调性 定义域"}},
        {"tool": "create_mindmap", "step_label": "梳理函数单调性与极值思维导图", "args": {"topic": "函数的单调性与导数"}},
        {"tool": "create_or_edit_lesson", "step_label": "生成 15 分钟微格试讲教案", "args": {"topic": "函数的单调性与导数"}},
        {"tool": "create_or_edit_slides", "step_label": "制作配套图形演示课件（7 页）", "args": {"title": "函数的单调性与导数"}},
        {"tool": "assemble_exam", "step_label": "从题库抽取 5 道递进巩固测试题", "args": {"knowledge_points": "导数与单调性"}},
    ]
    thr_traces = [
        {"index": 1, "tool": "search_materials", "label": "检索《函数单调性与导数》讲义重难点与四步解法", "ok": True, "summary": "已定位“定义域优先、驻点变号检验及反例 f(x)=x³”核心段落。", "auto_repaired": False},
        {"index": 2, "tool": "create_mindmap", "label": "梳理函数单调性与极值思维导图", "ok": True, "summary": "已生成《函数的单调性与导数》知识脉络导图。", "auto_repaired": False},
        {"index": 3, "tool": "create_or_edit_lesson", "label": "生成 15 分钟微格试讲教案", "ok": True, "summary": "已生成含时间轴、正副板书与分层练习的示范教案。", "auto_repaired": False},
        {"index": 4, "tool": "create_or_edit_slides", "label": "制作配套图形演示课件（7 页）", "ok": True, "summary": "已生成 7 页图文演示课件，含动态导数切线图示页。", "auto_repaired": False},
        {"index": 5, "tool": "assemble_exam", "label": "从题库抽取 5 道递进巩固测试题", "ok": True, "summary": "已组配 5 道阶梯测试题并完成答案核对，支持直接在线作答。", "auto_repaired": False},
    ]
    thr_linked = [
        {"kind": "mindmap", "id": "mmap_showcase_01", "title": "函数的单调性与导数 · 思维导图", "subtitle": "高中数学 · 知识结构"},
        {"kind": "lesson", "id": "les_showcase_01", "title": lesson_data["title"], "subtitle": "高中数学 · 高二年级 · 15分钟示范", "artifact_id": "art_showcase_lesson", "download_url": "/api/artifacts/art_showcase_lesson/download"},
        {"kind": "ppt", "id": "deck_showcase_01", "title": "函数的单调性与导数（图形导学示范）", "subtitle": "高中数学 · 7 页图文课件", "artifact_id": "art_showcase_pptx", "download_url": "/api/artifacts/art_showcase_pptx/download"},
        {"kind": "exam", "id": "exam_showcase_01", "title": "导数单调性与极值随堂巩固卷", "subtitle": "支持在线作答与自动记入错题", "artifact_id": "art_showcase_exam_stu", "download_url": "/api/artifacts/art_showcase_exam_stu/download"},
    ]
    thr_artifacts = {"mindmap_id": "mmap_showcase_01", "lesson_id": "les_showcase_01", "deck_id": "deck_showcase_01", "exam_id": "exam_showcase_01"}
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_threads (id, title, status, plan_json, pending_goal, artifacts_json, created_at, updated_at)
            VALUES (?, ?, 'completed', ?, '', ?, ?, ?)
            """,
            (thr_id, "导数单调性全套备课示例", json.dumps(thr_plan, ensure_ascii=False), json.dumps(thr_artifacts, ensure_ascii=False), now - 120, now - 120),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
            VALUES (?, ?, 'user', ?, '[]', '[]', '[]', 0, ?)
            """,
            ("amsg_sc_u1", thr_id, "按《函数单调性与导数》讲义备一节 15 分钟示范课，顺便出思维导图、课件和随堂巩固题。", now - 121),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_messages (id, thread_id, role, content, plan_json, tool_traces_json, linked_items_json, needs_confirmation, created_at)
            VALUES (?, ?, 'assistant', ?, ?, ?, ?, 0, ?)
            """,
            (
                "amsg_sc_a1",
                thr_id,
                "已按讲义章节顺序完成全套备课闭环：先提取了定义域优先与三次函数反例要点，随后协同生成思维导图、15 分钟教案、7 页带图像课件以及可在线作答的随堂巩固卷。你可以直接在右侧点击卡片预览、下载，或继续让我联动修改某一页课件或某一道题。",
                json.dumps(thr_plan, ensure_ascii=False),
                json.dumps(thr_traces, ensure_ascii=False),
                json.dumps(thr_linked, ensure_ascii=False),
                now - 120,
            ),
        )

    # v4.1: Structured Showcase Courses (Course Space + Whiteboard Classroom + Cheatsheet)
    today_iso = datetime.date.today().isoformat()
    yesterday_iso = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    crs1_units = [
        {
            "unit_index": 1,
            "title": "导数几何直观与单调性判定",
            "summary": "从切线斜率直观理解单调性，掌握定域→求导→求根→列表四步标准程序。",
            "lectures": [
                {
                    "id": "lec_crs1_1_1",
                    "title": "切线斜率与函数单调性",
                    "summary": "理解 f'(x)>0 与曲线上升的充分条件关系，辨析 f(x)=x³ 在原点处的水平切线反例。",
                    "kind": "lecture",
                    "mastery": "mastered",
                    "duration_min": 18,
                    "visualizer_preset": "cubic",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "本节课路线图",
                            "blocks": [
                                {
                                    "id": "blk_1_1_roadmap",
                                    "heading": "一、核心问题：导数符号 vs 曲线升降",
                                    "lines": [
                                        "几何直观：切线倾斜角为锐角 $\\Rightarrow k=f'(x)>0 \\Rightarrow$ 曲线上升",
                                        "反例警醒：$f(x)=x^3$ 在 $x=0$ 处 $f'(0)=0$，切线水平但整条曲线在 $\\mathbb{R}$ 上严格递增",
                                        "严格条件：$f'(x) \\ge 0$ 且仅在离散点处取等号，不在任何子区间恒为零",
                                    ],
                                    "highlight_note": "先定定义域，再判导数变号；区间之间写“和”，切忌直接写并集 $\\cup$！",
                                },
                                {
                                    "id": "blk_1_1_example",
                                    "heading": "二、典例演算：$f(x)=x^3-3x^2+2$",
                                    "lines": [
                                        "1. 定义域为 $\\mathbb{R}$",
                                        "2. 求导分解：$f'(x)=3x^2-6x=3x(x-2)$，驻点为 $x=0$ 与 $x=2$",
                                        "3. 分段列表：$x \\in (-\\infty,0)$ 与 $(2,+\\infty)$ 时 $f'(x)>0$（单调递增）；$x \\in (0,2)$ 时 $f'(x)<0$（单调递减）",
                                    ],
                                    "highlight_note": "极大值 $f(0)=2$，极小值 $f(2)=-2$",
                                },
                            ],
                        },
                        {
                            "page_index": 2,
                            "roadmap_title": "含参函数分类讨论扩展板书",
                            "blocks": [
                                {
                                    "id": "blk_1_1_param",
                                    "heading": "三、含参单调性的三级讨论标尺",
                                    "lines": [
                                        "第一级：讨论导函数最高次项系数正负或有无零点",
                                        "第二级：判断所求根是否落在给定定义域区间内",
                                        "第三级：当两根同时存在时，比较两根大小决定左右位置",
                                    ],
                                    "highlight_note": "先画参数临界数轴，再按左中右区间分条作答。",
                                }
                            ],
                        },
                    ],
                    "messages": [
                        {
                            "id": "wmsg_1_1_1",
                            "role": "assistant",
                            "content": "我们先把《函数的单调性与导数》拆成一条清晰主线：在某区间内，只要曲线沿着切线方向一路向上爬坡，一阶导数就大于零。\n\n左侧第一块板书把最容易混淆的反例标出来了：为什么 $f(x)=x^3$ 在 $x=0$ 处导数为零，却依然在全实数域递增？你可以点击下方板书标签对照看看。",
                            "board_anchor_id": "blk_1_1_roadmap",
                            "created_at": now - 600,
                        },
                        {
                            "id": "wmsg_1_1_2",
                            "role": "user",
                            "content": "那为什么多个单调增区间不能直接写成并集符号？",
                            "board_anchor_id": "",
                            "created_at": now - 580,
                        },
                        {
                            "id": "wmsg_1_1_3",
                            "role": "assistant",
                            "content": "看一个最直接的检验：$f(x)=\\frac{1}{x}$ 在 $(-\\infty,0)$ 和 $(0,+\\infty)$ 上各自严格递减。但如果我们取 $-1 < 1$，会发现 $f(-1)=-1 < f(1)=1$，大小顺序反过来了！\n\n所以跨越间断点的两段单调区间只能用“和”或逗号连接。右侧典例 $x^3-3x^2+2$ 的严格分段列表已经写在板书第二块，你可以试着用这个步骤自己推一遍含参题，或者在下方继续提问。",
                            "board_anchor_id": "blk_1_1_example",
                            "created_at": now - 560,
                        },
                    ],
                    "quiz_items": [
                        {
                            "id": "qc1_1",
                            "question": "函数 $f(x) = x - \\ln x$ 的单调递减区间是（ ）",
                            "options": ["A. $(0, 1)$", "B. $(-\\infty, 1)$", "C. $(1, +\\infty)$", "D. $(0, +\\infty)$"],
                            "answer": "A",
                            "explanation": "定义域优先限定 $x > 0$；$f'(x) = 1 - \\frac{1}{x} < 0 \\Rightarrow 0 < x < 1$。",
                        },
                        {
                            "id": "qc1_2",
                            "question": "下列关于驻点 $f'(x_0)=0$ 与极值关系的说法正确的是（ ）",
                            "options": [
                                "A. $f'(x_0)=0$ 是可导函数在 $x_0$ 处取极值的必要非充分条件",
                                "B. 只要满足 $f'(x_0)=0$ 就一定是极值点",
                                "C. 函数在极值点处必然可导",
                                "D. 多个递增区间可以直接用 $\\cup$ 连接",
                            ],
                            "answer": "A",
                            "explanation": "如 $f(x)=x^3$ 满足 $f'(0)=0$ 但无极值；$f(x)=|x|$ 不可导但取极小值。",
                        },
                    ],
                },
                {
                    "id": "lec_crs1_1_2",
                    "title": "极值点变号检验与最值对比",
                    "summary": "区分局部极值与闭区间全局最值，掌握边界端点函数值比较法。",
                    "kind": "lecture",
                    "mastery": "proficient",
                    "duration_min": 16,
                    "visualizer_preset": "ln_quad",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "极值与最值核心路线图",
                            "blocks": [
                                {
                                    "id": "blk_1_2_1",
                                    "heading": "一、一阶导变号判据（比二阶导更稳妥）",
                                    "lines": [
                                        "左正右负 $\\Rightarrow$ 极大值点；左负右正 $\\Rightarrow$ 极小值点",
                                        "反例警示：$y=x^4$ 与 $y=x^3$ 在 $x=0$ 处二阶导均等于 $0$，仍需看一阶导两侧符号",
                                    ],
                                    "highlight_note": "闭区间最值 = {区间内所有极值点值, 区间左右端点值} 取最大最小",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_1_2_1",
                            "role": "assistant",
                            "content": "求闭区间最值时，极值只是“局部山峰/谷底”，千万别漏掉左右两个区间端点函数值的比较。试着口述一下 $y=x^4$ 为什么不能靠二阶导数为零下结论？",
                            "board_anchor_id": "blk_1_2_1",
                            "created_at": now - 400,
                        }
                    ],
                    "quiz_items": [
                        {
                            "id": "qc1_3",
                            "question": "函数 $f(x)=x^3-3x^2+2$ 在 $[-1, 3]$ 上的最小值是（ ）",
                            "options": ["A. $-2$", "B. $0$", "C. $2$", "D. $-4$"],
                            "answer": "A",
                            "explanation": "比较端点 $f(-1)=-2, f(3)=2$ 与极小值 $f(2)=-2$，最小值为 $-2$。",
                        }
                    ],
                },
            ],
        },
        {
            "unit_index": 2,
            "title": "含参单调性与不等式恒成立",
            "summary": "攻克对数含参分类讨论、参变分离及隐零点估算策略。",
            "lectures": [
                {
                    "id": "lec_crs1_2_1",
                    "title": "对数型函数定义域与含参讨论",
                    "summary": "以 $f(x)=\\ln x + ax^2$ 为例完整推演定义域约束下的区间切分。",
                    "kind": "lecture",
                    "mastery": "familiar",
                    "duration_min": 20,
                    "visualizer_preset": "ln_quad",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "含参分类讨论路线图",
                            "blocks": [
                                {
                                    "id": "blk_2_1_1",
                                    "heading": "一、分类边界锚点设定",
                                    "lines": [
                                        "设 $f(x)=\\ln x + a x^2$，首要先标明定义域 $(0, +\\infty)$",
                                        "求导通分：$f'(x) = \\frac{1 + 2ax^2}{x}$，分母恒正，符号完全由分子 $1+2ax^2$ 决定",
                                        "若 $a \\ge 0$ 则恒增；若 $a < 0$ 则在 $x_0 = \\sqrt{-\\frac{1}{2a}}$ 处由正转负",
                                    ],
                                    "highlight_note": "通分之后只看关键分子，分类按参数令分子无实根/有正根切分。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_2_1_1",
                            "role": "assistant",
                            "content": "遇到含 $\\ln x$ 的导数大题，第一行先把定义域 $(0,+\\infty)$ 圈出来，能帮你过滤掉所有负根伪驻点。你可以点击右上角可视化画板观察不同参数下的曲线变化。",
                            "board_anchor_id": "blk_2_1_1",
                            "created_at": now - 200,
                        }
                    ],
                    "quiz_items": [],
                },
                {
                    "id": "lec_crs1_2_2",
                    "title": "参变分离与端点效应辨析",
                    "summary": "明确除数符号检验法则，避免恒成立问题中的等号漏判。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 18,
                    "visualizer_preset": "cubic",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "恒成立与参变分离路线图",
                            "blocks": [
                                {
                                    "id": "blk_2_2_1",
                                    "heading": "一、参变分离两项前提",
                                    "lines": [
                                        "1. 待分离自变量系数项必须先判别严格正负（防止变号反转）",
                                        "2. $a \\le g(x)_{\\min}$ 取等号后务必回代检验函数是否仍满足单调性要求",
                                    ],
                                    "highlight_note": "孤立端点导数为零时不等式仍可能严格单调。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_2_2_1",
                            "role": "assistant",
                            "content": "这是高中压轴题的高频分水岭。左侧板书总结了参变分离最关键的两步安全检查。",
                            "board_anchor_id": "blk_2_2_1",
                            "created_at": now - 120,
                        }
                    ],
                    "quiz_items": [],
                },
            ],
        },
        {
            "unit_index": 3,
            "title": "随堂巩固与综合测评",
            "summary": "衔接题库真题卷与错题自动诊断闭环。",
            "lectures": [
                {
                    "id": "lec_crs1_3_1",
                    "title": "导数单调性核心通关测验",
                    "summary": "完成 5 道梯度变式测验，错题自动进入个人复习队列。",
                    "kind": "quiz",
                    "mastery": "attempted",
                    "duration_min": 25,
                    "visualizer_preset": "",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "测验命题范围概览",
                            "blocks": [
                                {
                                    "id": "blk_3_1_1",
                                    "heading": "本次测验重点维度",
                                    "lines": [
                                        "维度一：基础求导与单调区间正确书写",
                                        "维度二：极值存在性与闭合区间最值计算",
                                        "维度三：含参不等式与反例辨析",
                                    ],
                                    "highlight_note": "点击课程左栏「练习」可直接打开整卷在线作答并自动批改。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_3_1_1",
                            "role": "assistant",
                            "content": "测验前可以先在速查表中快速回顾四步法与三大反例，祝一次通关。",
                            "board_anchor_id": "blk_3_1_1",
                            "created_at": now - 80,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        },
    ]

    crs1_cheatsheet = {
        "title": "函数的单调性与导数 · 高密度速查表",
        "subtitle": "高中数学 · 高二年级核心公式与避坑清单",
        "sections": [
            {
                "title": "一、核心定理与区间规范",
                "badge": "基础框架",
                "items": [
                    {
                        "term": "导数正负判据",
                        "formula_or_rule": "区间内 $f'(x)>0 \\Rightarrow$ 严格递增；$f'(x)\\ge 0$ 且仅在离散点取零依然递增",
                        "highlight_color": "blue",
                        "trap_note": "切忌写成充分必要条件的双向误解",
                    },
                    {
                        "term": "区间分隔禁忌",
                        "formula_or_rule": "两段增区间如 $(-\\infty,0)$ 与 $(2,+\\infty)$ 必须写“和”或逗号",
                        "highlight_color": "yellow",
                        "trap_note": "严禁直接写并集符号 $\\cup$！反例：$f(x)=1/x$",
                    },
                ],
            },
            {
                "title": "二、极值与最值标准四步",
                "badge": "操作流程",
                "items": [
                    {
                        "term": "四步动作口诀",
                        "formula_or_rule": "① 先标定义域（对数 $x>0$、分母 $\\neq 0$） $\\rightarrow$ ② 求导因式分解 $\\rightarrow$ ③ 找驻点与不可导点 $\\rightarrow$ ④ 列表判左右符号",
                        "highlight_color": "blue",
                        "trap_note": "三阶/四阶切线水平点（如 $x^3, x^4$）均需靠一阶导变号判定",
                    },
                    {
                        "term": "闭区间 $[a,b]$ 最值",
                        "formula_or_rule": "$\\max_{[a,b]} f = \\max\\{f(a), f(b), f(\\text{各极值点})\\}$",
                        "highlight_color": "yellow",
                        "trap_note": "不可漏比左右端点函数值",
                    },
                ],
            },
            {
                "title": "三、常见经典反例库",
                "badge": "考前速扫",
                "items": [
                    {
                        "term": "驻点非极值",
                        "formula_or_rule": "$f(x)=x^3$ 在 $x=0$ 处 $f'(0)=0$ 但严格递增无极值",
                        "highlight_color": "yellow",
                        "trap_note": "常用于概念辨析选择题",
                    },
                    {
                        "term": "极值点不可导",
                        "formula_or_rule": "$f(x)=|x|$ 在 $x=0$ 处尖点不可导，却是极小值点",
                        "highlight_color": "none",
                        "trap_note": "极值点可在连续不可导处取到",
                    },
                ],
            },
        ],
    }

    crs2_units = [
        {
            "unit_index": 1,
            "title": "群公理与子群陪集切分",
            "summary": "从整数模加群与几何对称理解陪集对群的无重叠切分。",
            "lectures": [
                {
                    "id": "lec_crs2_1_1",
                    "title": "循环群、子群与左右陪集直观",
                    "summary": "理解 $aH$ 如何作为等大小木块铺满母群 $G$。",
                    "kind": "lecture",
                    "mastery": "familiar",
                    "duration_min": 20,
                    "visualizer_preset": "group_z6",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "群与陪集直观路线图",
                            "blocks": [
                                {
                                    "id": "blk_c2_1",
                                    "heading": "一、陪集的等价类本质",
                                    "lines": [
                                        "定义等价关系 $x \\sim y \\iff x^{-1}y \\in H$",
                                        "每个左陪集 $aH$ 的元素个数均严格等于 $|H|$",
                                        "拉格朗日定理推论：$|G| = [G:H] \\cdot |H|$，子群阶数必整除母群阶数",
                                    ],
                                    "highlight_note": "可在上方画板切至「循环群模运算矩阵」实地观察。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_c2_1",
                            "role": "assistant",
                            "content": "想直观感受拉格朗日定理，可以把顶部工具栏切换到图形画板模式，选中循环群或正规子群实验。左陪集就像等长切片，把有限群 $G$ 不重不漏地铺满。",
                            "board_anchor_id": "blk_c2_1",
                            "created_at": now - 500,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        },
        {
            "unit_index": 2,
            "title": "正规子群与商群构造",
            "summary": "理解 $gNg^{-1}=N$ 为何保证陪集乘法良定义。",
            "lectures": [
                {
                    "id": "lec_crs2_2_1",
                    "title": "正规子群与同态基本定理",
                    "summary": "分辨对称群 $S_3$ 中非正规子群的反例，理解商群乘法。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 22,
                    "visualizer_preset": "group_z6",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "商群良定义检查路线图",
                            "blocks": [
                                {
                                    "id": "blk_c2_2",
                                    "heading": "一、陪集乘法为何依赖正规性",
                                    "lines": [
                                        "令 $(aN)(bN) = (ab)N$ 不随代表元选取改变，充要条件即 $aN=Na$",
                                        "经典反例：在 $S_3$ 中取 2 阶反射子群 $H=\\{e, (12)\\}$，其左陪集与右陪集不重合",
                                    ],
                                    "highlight_note": "同态核 $\\ker \\varphi$ 永远是正规子群，且 $G/\\ker \\varphi \\cong \\text{Im}\\,\\varphi$。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_c2_2",
                            "role": "assistant",
                            "content": "如果母群是非阿贝尔群，随意挑一个子群并不能直接造出商群——只有左右陪集处处对齐的正规子群才支持稳健乘法。",
                            "board_anchor_id": "blk_c2_2",
                            "created_at": now - 300,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        },
    ]

    crs3_units = [
        {
            "unit_index": 1,
            "title": "解析函数与柯西-黎曼方程",
            "summary": "从微圆保角缩放理解复可微与二维调和函数。",
            "lectures": [
                {
                    "id": "lec_crs3_1_1",
                    "title": "复可微的几何含义与多值曲面",
                    "summary": "直观认识 $w=z^2$ 的翻倍转角及 $\\sqrt{z}$ 双叶曲面切开逻辑。",
                    "kind": "lecture",
                    "mastery": "unstarted",
                    "duration_min": 20,
                    "visualizer_preset": "riemann",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "解析映照核心路线图",
                            "blocks": [
                                {
                                    "id": "blk_c3_1",
                                    "heading": "一、柯西-黎曼方程的保角直觉",
                                    "lines": [
                                        "复可微要求从任意方向趋近导数极值相同，等价于：$u_x = v_y,\\; u_y = -v_x$",
                                        "几何效应：无穷小邻域只发生旋转和等比例缩放，不产生剪切变形",
                                    ],
                                    "highlight_note": "可点击顶部图形切换至「3D 多叶曲面实验台」立体旋转观察。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_c3_1",
                            "role": "assistant",
                            "content": "实数函数只有一个趋近方向（左右两侧），复平面却有无穷多方向！这就是复可微比实可微苛刻得多的原因。",
                            "board_anchor_id": "blk_c3_1",
                            "created_at": now - 250,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        }
    ]

    crs4_units = [
        {
            "unit_index": 1,
            "title": "太阳系轨道力学与潮汐锁定",
            "summary": "用角动量守恒解释开普勒第二定律，区分引力 1/r² 与潮汐引力差 1/r³。",
            "lectures": [
                {
                    "id": "lec_crs4_1_1",
                    "title": "为什么月球只对地球露出同一面",
                    "summary": "梳理潮汐摩擦制动与天平动 59% 可见月面的力学成因。",
                    "kind": "lecture",
                    "mastery": "mastered",
                    "duration_min": 15,
                    "visualizer_preset": "kepler",
                    "board_pages": [
                        {
                            "page_index": 1,
                            "roadmap_title": "潮汐锁定与距离阶梯路线图",
                            "blocks": [
                                {
                                    "id": "blk_c4_1",
                                    "heading": "一、1/r³ 引力梯度差与同步自转",
                                    "lines": [
                                        "万有引力按 $1/r^2$ 衰减，而近侧与远侧受到的潮汐拉伸差按 $1/r^3$ 衰减",
                                        "1:1 潮汐锁定并非停止自转，而是自转角速度与平均公转角速度相等",
                                    ],
                                    "highlight_note": "因椭圆轨道公转角速度不均而自转匀速，积累出 59% 月面可见。",
                                }
                            ],
                        }
                    ],
                    "messages": [
                        {
                            "id": "wmsg_c4_1",
                            "role": "assistant",
                            "content": "本节已全部学习掌握。你可以随时打开本课配套的 7 页天文学演示课件或重温量天阶梯思维导图。",
                            "board_anchor_id": "blk_c4_1",
                            "created_at": now - 150,
                        }
                    ],
                    "quiz_items": [],
                }
            ],
        }
    ]

    showcase_courses = [
        (
            "crs_showcase_01",
            "函数的单调性与导数进阶",
            "高中数学 · 高二年级",
            "高中数学",
            "高二年级",
            "知学教研组",
            "知学精品库",
            "/assets/hk/course_calculus.png",
            "self_study",
            "从几何切线直观出发，贯穿导数符号判定、含参分类讨论、极值最值辨析与典型反例清单，并已关联同步教案、7页图文课件及随堂巩固卷。",
            crs1_units,
            crs1_cheatsheet,
            {
                "lesson_id": "les_showcase_01",
                "deck_id": "deck_showcase_01",
                "exam_id": "exam_showcase_01",
                "mindmap_id": "mmap_showcase_01",
                "source_doc_ids": ["doc_showcase_deriv_02"],
            },
            {today_iso: 2, yesterday_iso: 1},
            "lec_crs1_1_1",
            now - 30,
        ),
        (
            "crs_showcase_02",
            "抽象代数：群、陪集与商群",
            "高等代数 · 大学数学",
            "高等代数",
            "大学本科/师范",
            "知学教研组",
            "知学精品库",
            "/assets/hk/course_algebra.png",
            "self_study",
            "围绕子群陪集切分、拉格朗日定理、正规子群与同态基本定理构建直观几何映射。",
            crs2_units,
            {
                "title": "抽象代数 · 群与商群速查表",
                "subtitle": "高等代数核心判定规则",
                "sections": [
                    {
                        "title": "子群与商群关键判据",
                        "badge": "核心定理",
                        "items": [
                            {"term": "拉格朗日定理", "formula_or_rule": "对任意有限群 $G$ 及其子群 $H$，必有 $|H| \\mid |G|$", "highlight_color": "blue", "trap_note": "逆命题不成立，如 $A_4$ 无 6 阶子群"},
                            {"term": "正规子群等价式", "formula_or_rule": "$gNg^{-1}=N$ 或 $gN=Ng$ 对所有 $g\\in G$ 成立", "highlight_color": "yellow", "trap_note": "S₃ 中的二阶子群不是正规子群"},
                        ],
                    }
                ],
            },
            {"lesson_id": "les_showcase_alg_02", "source_doc_ids": ["doc_showcase_alg_03"]},
            {yesterday_iso: 1},
            "lec_crs2_1_1",
            now - 100,
        ),
        (
            "crs_showcase_03",
            "复变函数与解析映照",
            "复变函数 · 大学数学",
            "复变函数",
            "大学本科",
            "知学教研组",
            "知学精品库",
            "/assets/hk/course_complex.png",
            "self_study",
            "结合保角映照直觉与三维曲面视角，系统掌握解析函数判定、复积分与留数计算。",
            crs3_units,
            {
                "title": "复变函数核心结论速查",
                "subtitle": "大学数学专题",
                "sections": [
                    {
                        "title": "解析性判定",
                        "badge": "必记方程",
                        "items": [
                            {"term": "柯西-黎曼方程", "formula_or_rule": "$u_x = v_y,\\; u_y = -v_x$", "highlight_color": "blue", "trap_note": "须同时满足偏导连续方可推解析"},
                        ],
                    }
                ],
            },
            {},
            {},
            "lec_crs3_1_1",
            now - 180,
        ),
        (
            "crs_showcase_04",
            "天体力学与宇宙距离阶梯",
            "物理与天文 · 通识课程",
            "天文学通识",
            "高中 / 大学通识",
            "知学教研组",
            "知学精品库",
            "/assets/hk/course_astro.png",
            "self_study",
            "由潮汐锁定力学与开普勒行星三定律起步，打通五级宇宙距离测量标尺，并关联演示课件。",
            crs4_units,
            {
                "title": "天文学与距离阶梯速查",
                "subtitle": "物理与天文通识",
                "sections": [
                    {
                        "title": "核心物理标尺",
                        "badge": "测距与轨道",
                        "items": [
                            {"term": "开普勒第三定律", "formula_or_rule": "$T^2 \\propto a^3$（以年与天文单位计量可直接 $T^2 = a^3$）", "highlight_color": "blue", "trap_note": "仅适用于同一中心天体系统"},
                            {"term": "周年视差测距", "formula_or_rule": "$d(\\text{pc}) = 1 / p(\\text{arcsec})$，$1\\,\\text{pc} \\approx 3.26\\,\\text{ly}$", "highlight_color": "yellow", "trap_note": "视差角越小代表距离越远"},
                        ],
                    }
                ],
            },
            {"deck_id": "deck_showcase_astro_03"},
            {yesterday_iso: 1},
            "lec_crs4_1_1",
            now - 260,
        ),
    ]

    with get_conn() as conn:
        for (
            c_id, c_title, c_sub, c_subj, c_grade, c_cur, c_src, c_cov, c_mode,
            c_desc, c_units, c_cs, c_linked, c_wk, c_last, c_ts,
        ) in showcase_courses:
            total_l = sum(len(u.get("lectures") or []) for u in c_units)
            w_sum = 0.0
            for u in c_units:
                for l in u.get("lectures") or []:
                    w_sum += {"unstarted": 0.0, "attempted": 0.25, "familiar": 0.5, "proficient": 0.78, "mastered": 1.0}.get(l.get("mastery", "unstarted"), 0.0)
            pct = int(round((w_sum / total_l) * 100)) if total_l else 0
            st = "completed" if pct >= 95 else "in_progress"
            conn.execute(
                """
                INSERT OR REPLACE INTO courses (
                    id, title, subtitle, subject, grade_level, curator, source_label, cover_image,
                    status, progress_pct, mode, description, units_json, cheatsheet_json,
                    linked_ids_json, weekly_sessions_json, last_lecture_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    c_id, c_title, c_sub, c_subj, c_grade, c_cur, c_src, c_cov,
                    st, pct, c_mode, c_desc,
                    json.dumps(c_units, ensure_ascii=False),
                    json.dumps(c_cs, ensure_ascii=False),
                    json.dumps(c_linked, ensure_ascii=False),
                    json.dumps(c_wk, ensure_ascii=False),
                    c_last, c_ts, c_ts,
                ),
            )

    version_file.write_text(SHOWCASE_VERSION, encoding="utf-8")
    log_telemetry("system", "showcase_bootstrap", duration_ms=420, verified_ok=True, human_edited=False)
