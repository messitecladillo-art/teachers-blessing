import { BoardBlock } from '../types';
import { assetUrl } from '../utils/assets';
import { extractPlottableFromBlock, latexToSpokenZh } from '../utils/speechMath';

type EventCallback = (event: string, data: Record<string, unknown>) => void;

export interface StreamHandlers {
  onStage?: (stage: string, message: string) => void;
  onThinking?: (delta: string) => void;
  onText?: (delta: string) => void;
  onResult: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

const DEMO_STORAGE_KEY = 'eduforge_demo_state_v45';

interface DemoMutableState {
  courses: Record<string, unknown>[];
  memory: {
    weak_topics: Record<string, unknown>[];
    mastered_topics: Record<string, unknown>[];
    recent_submissions: Record<string, unknown>[];
    preferences: Record<string, string>;
  };
  threads: Record<string, unknown>[];
  thread_details: Record<string, Record<string, unknown>>;
  sources: Record<string, unknown>[];
  source_chunks: Record<string, Record<string, unknown>[]>;
  artifacts: Record<string, unknown>[];
  lessons: Record<string, unknown>[];
  ppt_decks: Record<string, unknown>[];
  exams: Record<string, unknown>[];
  analytics_reports: Record<string, unknown>[];
  mindmaps: Record<string, unknown>[];
  error_book: Record<string, unknown>[];
  study_plans: Record<string, unknown>[];
  calendar_tasks: Record<string, unknown>[];
}

interface DemoSnapshot extends DemoMutableState {
  system_status: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  weekly_tracker: Record<string, unknown>;
  marketplace_curated: Record<string, unknown>;
  marketplace_teaching: Record<string, unknown>;
  pedagogy_topics: {
    topics: Record<string, unknown>[];
    subjects: string[];
    domains: Record<string, unknown>[];
    total: number;
  };
  pedagogy_taxonomy: Record<string, unknown>;
  ppt_themes: Record<string, unknown>;
  exam_catalog: Record<string, unknown>;
  sample_csv: Record<string, unknown>;
  plots_2d: Record<string, Record<string, unknown>>;
  surface_3d: Record<string, unknown>;
}

let snapshotCache: DemoSnapshot | null = null;
let snapshotLoadingPromise: Promise<DemoSnapshot> | null = null;
let runtimeState: DemoMutableState | null = null;

function cloneJson<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

function makeId(prefix: string): string {
  return `${prefix}_demo_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureDemoLoaded(): Promise<{ snap: DemoSnapshot; state: DemoMutableState }> {
  if (!snapshotCache) {
    if (!snapshotLoadingPromise) {
      snapshotLoadingPromise = fetch(assetUrl('/demo-data/snapshot.json')).then(async (resp) => {
        if (!resp.ok) throw new Error(`演示数据加载失败 (${resp.status})`);
        return (await resp.json()) as DemoSnapshot;
      });
    }
    snapshotCache = await snapshotLoadingPromise;
  }

  if (!runtimeState) {
    let saved: Partial<DemoMutableState> | null = null;
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as Partial<DemoMutableState>;
    } catch {
      saved = null;
    }

    runtimeState = {
      courses: saved?.courses ?? cloneJson(snapshotCache.courses || []),
      memory: saved?.memory ?? cloneJson(snapshotCache.memory || { weak_topics: [], mastered_topics: [], recent_submissions: [], preferences: {} }),
      threads: saved?.threads ?? cloneJson(snapshotCache.threads || []),
      thread_details: saved?.thread_details ?? cloneJson(snapshotCache.thread_details || {}),
      sources: saved?.sources ?? cloneJson(snapshotCache.sources || []),
      source_chunks: saved?.source_chunks ?? cloneJson(snapshotCache.source_chunks || {}),
      artifacts: saved?.artifacts ?? cloneJson(snapshotCache.artifacts || []),
      lessons: saved?.lessons ?? cloneJson(snapshotCache.lessons || []),
      ppt_decks: saved?.ppt_decks ?? cloneJson(snapshotCache.ppt_decks || []),
      exams: saved?.exams ?? cloneJson(snapshotCache.exams || []),
      analytics_reports: saved?.analytics_reports ?? cloneJson(snapshotCache.analytics_reports || []),
      mindmaps: saved?.mindmaps ?? cloneJson(snapshotCache.mindmaps || []),
      error_book: saved?.error_book ?? cloneJson(snapshotCache.error_book || []),
      study_plans: saved?.study_plans ?? cloneJson(snapshotCache.study_plans || []),
      calendar_tasks: saved?.calendar_tasks ?? cloneJson(snapshotCache.calendar_tasks || []),
    };
  }

  return { snap: snapshotCache, state: runtimeState };
}

function persistState(): void {
  if (!runtimeState) return;
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(runtimeState));
  } catch {
    /* ignore quota errors cleanly */
  }
}

function recomputeCourseProgress(course: Record<string, unknown>): Record<string, unknown> {
  const weights: Record<string, number> = {
    unstarted: 0,
    attempted: 0.25,
    familiar: 0.5,
    proficient: 0.78,
    mastered: 1.0,
  };
  const units = (course.units as Record<string, unknown>[]) || [];
  let total = 0;
  let scoreSum = 0;
  let nextLec: Record<string, unknown> | null = null;
  for (const u of units) {
    const lecs = (u.lectures as Record<string, unknown>[]) || [];
    for (const l of lecs) {
      total += 1;
      const m = String(l.mastery || 'unstarted');
      scoreSum += weights[m] ?? 0;
      if (!nextLec && m !== 'mastered') {
        nextLec = {
          id: l.id,
          title: l.title,
          kind: l.kind || 'lecture',
          unit_index: u.unit_index,
        };
      }
    }
  }
  const pct = total ? Math.min(100, Math.max(0, Math.round((scoreSum / total) * 100))) : 0;
  const status = pct >= 95 ? 'completed' : 'in_progress';
  return { ...course, progress_pct: pct, status, next_lecture: nextLec };
}

function buildWeeklyTracker(courses: Record<string, unknown>[]): Record<string, unknown> {
  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const counts: Record<string, number> = {};
  for (const c of courses) {
    const ws = (c.weekly_sessions as Record<string, number>) || {};
    for (const [k, v] of Object.entries(ws)) {
      counts[k] = (counts[k] || 0) + Number(v || 0);
    }
  }
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let totalSessions = 0;
  const days = labels.map((label, idx) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + idx);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const cnt = counts[iso] || 0;
    totalSessions += cnt;
    return { label, date: iso, count: cnt, is_today: iso === isoToday };
  });
  const firstCourse = courses.find((c) => c.status !== 'completed') || courses[0];
  const nextLec = (firstCourse?.next_lecture as Record<string, unknown>) || ((firstCourse?.units as { lectures?: Record<string, unknown>[] }[])?.[0]?.lectures?.[0]);
  const continueLearning =
    firstCourse && nextLec
      ? {
          course_id: firstCourse.id,
          course_title: firstCourse.title,
          lecture_id: nextLec.id,
          lecture_title: nextLec.title,
          kind: nextLec.kind || 'lecture',
        }
      : null;
  return { total_sessions: totalSessions, days, continue_learning: continueLearning };
}

function sampleFunctionInBrowser(exprRaw: string, xMin = -2, xMax = 3.5): Record<string, unknown> {
  const clean = (exprRaw || 'x^3 - 3*x^2 + 2').replace(/^y\s*=|^f\(x\)\s*=/i, '').trim();
  const jsExpr = clean
    .replace(/\^/g, '**')
    .replace(/\bln\(/g, 'Math.log(')
    .replace(/\blog\(/g, 'Math.log(')
    .replace(/\bsin\(/g, 'Math.sin(')
    .replace(/\bcos\(/g, 'Math.cos(')
    .replace(/\btan\(/g, 'Math.tan(')
    .replace(/\bsqrt\(/g, 'Math.sqrt(')
    .replace(/\babs\(/g, 'Math.abs(')
    .replace(/\bexp\(/g, 'Math.exp(')
    .replace(/(\d)(x)/g, '$1*$2');

  try {
    const fn = new Function('x', `return (${jsExpr});`) as (x: number) => number;
    const pts: { x: number; y: number }[] = [];
    const steps = 120;
    const dx = (xMax - xMin) / steps;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const xv = xMin + i * dx;
      const yv = fn(xv);
      if (Number.isFinite(yv) && Math.abs(yv) < 1e4) {
        const rx = Math.round(xv * 1000) / 1000;
        const ry = Math.round(yv * 1000) / 1000;
        pts.push({ x: rx, y: ry });
        if (ry < yMin) yMin = ry;
        if (ry > yMax) yMax = ry;
      }
    }
    if (!pts.length) throw new Error('no valid points');
    return {
      ok: true,
      expression: clean,
      latex: clean,
      derivative_latex: "f'(x)",
      x_min: xMin,
      x_max: xMax,
      y_min: Math.round((yMin - 0.5) * 100) / 100,
      y_max: Math.round((yMax + 0.5) * 100) / 100,
      segments: [pts],
      extrema: [],
    };
  } catch {
    return { ok: false, detail: '演示模式下仅支持基础单变量初等函数绘图。' };
  }
}

function desensitizeCsvInBrowser(csvText: string): Record<string, unknown> {
  const lines = (csvText || '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('请至少提供表头和一行学生成绩记录');
  const headers = lines[0].split(',').map((h) => h.trim());
  const dropIdx = new Set<number>();
  const maskIdx = new Set<number>();
  const droppedCols: string[] = [];
  const maskedCols: string[] = [];

  headers.forEach((h, i) => {
    if (/学号|身份证|电话|手机|id|student_id/i.test(h)) {
      dropIdx.add(i);
      droppedCols.push(h);
    } else if (/姓名|名字|name/i.test(h)) {
      maskIdx.add(i);
      maskedCols.push(h);
    }
  });

  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()));
  const sampleBefore = rows.slice(0, 4).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  let redactedCount = 0;
  const keptHeaders = headers.filter((_, i) => !dropIdx.has(i));
  const sampleAfter = rows.slice(0, 4).map((r, ri) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (dropIdx.has(i)) {
        redactedCount += 1;
        return;
      }
      if (maskIdx.has(i)) {
        redactedCount += 1;
        out[h] = `学生_${String(ri + 1).padStart(2, '0')}`;
      } else {
        out[h] = r[i] ?? '';
      }
    });
    return out;
  });
  return {
    ok: true,
    student_count: rows.length,
    dropped_columns: droppedCols,
    masked_columns: maskedCols,
    redacted_fields_count: Math.max(redactedCount, rows.length * (droppedCols.length + maskedCols.length)),
    kept_headers: keptHeaders,
    sample_before: sampleBefore,
    sample_after: sampleAfter,
  };
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function buildCourseFromTemplate(item: Record<string, unknown>, mode: 'self_study' | 'teaching'): Record<string, unknown> {
  const cid = makeId('crs');
  const now = Math.floor(Date.now() / 1000);
  const title = String(item.title || '专题课程');
  const subject = String(item.subject || '综合学科');
  const grade = String(item.grade_level || '高二年级');
  const lecId1 = `lec_${cid}_1_1`;
  const lecId2 = `lec_${cid}_1_2`;
  return {
    id: cid,
    title,
    subtitle: `${subject} · ${grade}`,
    subject,
    grade_level: grade,
    curator: String(item.curator || '知学教研组'),
    source_label: mode === 'teaching' ? '教研备课集' : '课程集市',
    cover_image: String(item.cover_image || '/assets/hk/course_calculus.png'),
    status: 'in_progress',
    progress_pct: 0,
    mode,
    description: String(item.description || ''),
    units: [
      {
        unit_index: 1,
        title: '核心直观与推演主线',
        summary: `围绕《${title}》构建清晰概念直觉与标准解题步骤。`,
        lectures: [
          {
            id: lecId1,
            title: `${title}：核心直观与边界`,
            summary: '梳理定义前提、典型图景与标准程序。',
            kind: 'lecture',
            mastery: 'unstarted',
            duration_min: 18,
            visualizer_preset: 'cubic',
            board_pages: [
              {
                page_index: 1,
                roadmap_title: '核心主线板书',
                blocks: [
                  {
                    id: `blk_${cid}_1`,
                    heading: `一、${title} 核心要点`,
                    lines: ['1. 先核对定义域与核心适用前提', '2. 拆解中间关系表达式并标定临界点', '3. 特例回代校验结论一致性'],
                    highlight_note: '先定边界，再推结论',
                  },
                ],
              },
            ],
            messages: [
              {
                id: makeId('wmsg'),
                role: 'assistant',
                content: `欢迎进入《${title}》白板课堂。左侧已列出核心脉络，你可以直接在下方输入追问或方程（如 \`x^2 - 1 = 0\`）体验实时推演与验算。`,
                board_anchor_id: `blk_${cid}_1`,
                created_at: now,
              },
            ],
            quiz_items: [
              {
                id: `q_${cid}_1`,
                question: `研习《${title}》时，面对含参数条件最优先检查哪一步？`,
                options: ['A. 明确定义域与分类边界前提', 'B. 直接特值代入猜测', 'C. 合并多段区间为并集', 'D. 忽略端点验证'],
                answer: 'A',
                explanation: '清晰界定定义域与分类临界值是推理无误的首要保障。',
              },
            ],
          },
          {
            id: lecId2,
            title: '典型反例与巩固演练',
            summary: '对比高频误区与随堂检验。',
            kind: 'quiz',
            mastery: 'unstarted',
            duration_min: 15,
            visualizer_preset: 'cubic',
            board_pages: [
              {
                page_index: 1,
                roadmap_title: '反例辨析清单',
                blocks: [
                  {
                    id: `blk_${cid}_2`,
                    heading: '一、高频陷阱排查',
                    lines: ['区分必要条件与充分条件', '端点处孤立值单独验证'],
                    highlight_note: '反例是检验理解深度的试金石',
                  },
                ],
              },
            ],
            messages: [],
            quiz_items: [],
          },
        ],
      },
    ],
    cheatsheet: {
      title: `${title} · 重点速查表`,
      subtitle: `${subject} · ${grade}`,
      sections: [
        {
          title: '核心框架与规范',
          badge: '必记',
          items: [
            {
              term: title,
              formula_or_rule: String(item.description || '先定前提范围，再分步推演并做特例回代。'),
              highlight_color: 'blue',
              trap_note: '注意隐含条件及临界值验证',
            },
          ],
        },
      ],
    },
    linked_ids: {},
    weekly_sessions: {},
    last_lecture_id: lecId1,
    next_lecture: { id: lecId1, title: `${title}：核心直观与边界`, kind: 'lecture', unit_index: 1 },
    created_at: now,
    updated_at: now,
  };
}

export async function demoApiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const { snap, state } = await ensureDemoLoaded();
  const method = (options?.method || 'GET').toUpperCase();
  const parsedUrl = new URL(url, 'http://demo.local');
  const path = parsedUrl.pathname;
  const qp = parsedUrl.searchParams;
  const body = options?.body && typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {};

  // ---- System ----
  if (path === '/api/system/status') return cloneJson(snap.system_status) as T;
  if (path === '/api/system/telemetry') {
    const base = cloneJson(snap.telemetry);
    const tel = (base.telemetry as Record<string, unknown>) || {};
    tel.total_artifacts = state.artifacts.length;
    base.telemetry = tel;
    return base as T;
  }
  if (path === '/api/system/config' && method === 'POST') {
    const llm = (snap.system_status.llm as Record<string, unknown>) || {};
    return { ok: true, llm: { ...llm, model: body.model || llm.model, protocol: body.protocol || llm.protocol } } as T;
  }
  if (path === '/api/system/privacy/purge' && method === 'POST') {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    runtimeState = null;
    if (qp.get('restore_showcase') === 'false') {
      const emptyState: DemoMutableState = {
        courses: [],
        memory: { weak_topics: [], mastered_topics: [], recent_submissions: [], preferences: { ...state.memory.preferences } },
        threads: [],
        thread_details: {},
        sources: [],
        source_chunks: {},
        artifacts: [],
        lessons: [],
        ppt_decks: [],
        exams: [],
        analytics_reports: [],
        mindmaps: [],
        error_book: [],
        study_plans: [],
        calendar_tasks: [],
      };
      runtimeState = emptyState;
      persistState();
    } else {
      await ensureDemoLoaded();
    }
    return { ok: true } as T;
  }

  // ---- Courses & Marketplace ----
  if (path === '/api/courses' && method === 'GET') {
    const stFilter = qp.get('status') || 'all';
    const q = (qp.get('q') || '').trim().toLowerCase();
    let list = state.courses.map(recomputeCourseProgress);
    if (stFilter === 'in_progress') list = list.filter((c) => c.status !== 'completed');
    if (stFilter === 'completed') list = list.filter((c) => c.status === 'completed');
    if (q) list = list.filter((c) => `${c.title} ${c.subject} ${c.description}`.toLowerCase().includes(q));
    return { ok: true, courses: list, weekly_tracker: buildWeeklyTracker(state.courses) } as T;
  }

  if (path === '/api/courses/marketplace' && method === 'GET') {
    const tab = qp.get('tab') || 'curated';
    const cat = qp.get('category') || '全部';
    const q = (qp.get('q') || '').trim().toLowerCase();
    const src = cloneJson(tab === 'teaching' ? snap.marketplace_teaching : snap.marketplace_curated);
    let items = (src.items as Record<string, unknown>[]) || [];
    if (cat && cat !== '全部' && cat !== 'all') {
      items = items.filter((it) => it.category === cat || it.extra_category === cat);
    }
    if (q) {
      items = items.filter((it) => `${it.title} ${it.subject} ${it.category} ${it.description}`.toLowerCase().includes(q));
    }
    src.items = items;
    return src as T;
  }

  if (path === '/api/courses/enroll' && method === 'POST') {
    const mid = String(body.market_id || '');
    const mode = body.mode === 'teaching' ? 'teaching' : 'self_study';
    const allMkt = [...((snap.marketplace_curated.items as Record<string, unknown>[]) || []), ...((snap.marketplace_teaching.items as Record<string, unknown>[]) || [])];
    const spec = allMkt.find((it) => it.market_id === mid) || allMkt[0];
    const existing = state.courses.find((c) => c.title === spec?.title);
    if (existing) {
      existing.mode = mode;
      persistState();
      return { ok: true, course: recomputeCourseProgress(existing), reused: true } as T;
    }
    const created = buildCourseFromTemplate(spec || { title: '新课程专题' }, mode);
    state.courses.unshift(created);
    persistState();
    return { ok: true, course: created } as T;
  }

  const courseDetailMatch = path.match(/^\/api\/courses\/([^/]+)$/);
  if (courseDetailMatch) {
    const cid = decodeURIComponent(courseDetailMatch[1]);
    const idx = state.courses.findIndex((c) => c.id === cid);
    if (idx === -1) throw new Error('课程不存在');
    if (method === 'GET') {
      return { ok: true, course: recomputeCourseProgress(state.courses[idx]), materials: state.sources.slice(0, 2) } as T;
    }
    if (method === 'PATCH') {
      state.courses[idx] = {
        ...state.courses[idx],
        title: body.title ?? state.courses[idx].title,
        description: body.description ?? state.courses[idx].description,
      };
      persistState();
      return { ok: true, course: recomputeCourseProgress(state.courses[idx]) } as T;
    }
    if (method === 'DELETE') {
      state.courses.splice(idx, 1);
      persistState();
      return { ok: true } as T;
    }
  }

  const progressMatch = path.match(/^\/api\/courses\/([^/]+)\/progress$/);
  if (progressMatch && method === 'PATCH') {
    const cid = decodeURIComponent(progressMatch[1]);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) throw new Error('课程不存在');
    const lid = String(body.lecture_id || '');
    const mastery = String(body.mastery || 'mastered');
    for (const u of (course.units as { lectures: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (l.id === lid) l.mastery = mastery;
      }
    }
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ws = (course.weekly_sessions as Record<string, number>) || {};
    ws[iso] = (ws[iso] || 0) + 1;
    course.weekly_sessions = ws;
    course.last_lecture_id = lid;
    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();
    return { ok: true, course: norm } as T;
  }

  const boardMutateMatch = path.match(/^\/api\/courses\/([^/]+)\/lectures\/([^/]+)\/board$/);
  if (boardMutateMatch && method === 'PATCH') {
    const cid = decodeURIComponent(boardMutateMatch[1]);
    const lid = decodeURIComponent(boardMutateMatch[2]);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) throw new Error('课程不存在');
    let targetLec: Record<string, unknown> | null = null;
    for (const u of (course.units as { lectures: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (l.id === lid) targetLec = l;
      }
    }
    if (!targetLec) throw new Error('讲次不存在');

    const op = String(body.op || '').trim();
    type DemoPage = { page_index: number; roadmap_title: string; blocks: Record<string, unknown>[] };
    let pages = ((targetLec.board_pages as DemoPage[]) || [{ page_index: 1, roadmap_title: '本节课路线图', blocks: [] }]);
    let resultBlock: Record<string, unknown> | null = null;
    let resultPageIdx = Math.max(1, Math.min(pages.length, Number(body.page_index || 1)));

    const enrichBlock = (raw: Record<string, unknown>): Record<string, unknown> => {
      const heading = String(raw.heading || '板书要点').trim();
      const lines = Array.isArray(raw.lines) ? raw.lines.map((x) => String(x).trim()).filter(Boolean) : [heading];
      const highlightNote = String(raw.highlight_note || '').trim();
      const blockType = String(raw.block_type || 'derivation');
      const vExpr =
        String(raw.visual_expr || '').trim() ||
        extractPlottableFromBlock({ id: '', heading, lines } as BoardBlock);
      const narration =
        String(raw.narration || '').trim() ||
        latexToSpokenZh(`${heading}。${lines.join('；')}${highlightNote ? `。重点提示：${highlightNote}` : ''}`);
      return {
        id: String(raw.id || makeId('blk')),
        block_type: blockType,
        heading,
        lines,
        highlight_note: highlightNote,
        narration,
        teaching_tip: String(raw.teaching_tip || '').trim() || `板书停顿：引导学生核对「${heading.slice(0, 12)}」的关键条件。`,
        verified_badge: /=|\^|f'/.test(lines.join(' ')) ? '推导要点已校验 · 已验算' : undefined,
        ...(vExpr ? { visual_expr: vExpr } : {}),
      };
    };

    if (op === 'add_page') {
      const nextIdx = pages.length + 1;
      const newBlocks: Record<string, unknown>[] = [];
      if (String(body.heading || '').trim() || (Array.isArray(body.lines) && body.lines.length)) {
        resultBlock = enrichBlock(body);
        newBlocks.push(resultBlock);
      }
      pages.push({
        page_index: nextIdx,
        roadmap_title: String(body.roadmap_title || `课堂板书 · 第 ${nextIdx} 页`).trim(),
        blocks: newBlocks,
      });
      resultPageIdx = nextIdx;
    } else if (op === 'add_block') {
      resultBlock = enrichBlock(body);
      const pgIdx0 = Math.max(0, Math.min(pages.length - 1, Number(body.page_index || 1) - 1));
      pages[pgIdx0].blocks = [...(pages[pgIdx0].blocks || []), resultBlock];
      resultPageIdx = pgIdx0 + 1;
    } else if (op === 'update_block') {
      const targetId = String(body.block_id || '');
      for (let pi = 0; pi < pages.length; pi++) {
        const bi = (pages[pi].blocks || []).findIndex((b) => b.id === targetId);
        if (bi !== -1) {
          resultBlock = enrichBlock({ ...pages[pi].blocks[bi], ...body, id: targetId });
          pages[pi].blocks[bi] = resultBlock;
          resultPageIdx = pi + 1;
          break;
        }
      }
    } else if (op === 'delete_block') {
      const targetId = String(body.block_id || '');
      pages.forEach((pg) => {
        pg.blocks = (pg.blocks || []).filter((b) => b.id !== targetId);
      });
      pages = pages.filter((pg, i) => i === 0 || (pg.blocks || []).length > 0);
      pages.forEach((pg, i) => {
        pg.page_index = i + 1;
      });
      resultPageIdx = Math.min(resultPageIdx, pages.length);
    } else if (op === 'move_block') {
      const targetId = String(body.block_id || '');
      const delta = body.direction === 'down' ? 1 : -1;
      for (let pi = 0; pi < pages.length; pi++) {
        const blks = [...(pages[pi].blocks || [])];
        const bi = blks.findIndex((b) => b.id === targetId);
        if (bi !== -1) {
          const np = Math.max(0, Math.min(blks.length - 1, bi + delta));
          if (np !== bi) {
            [blks[bi], blks[np]] = [blks[np], blks[bi]];
            pages[pi].blocks = blks;
          }
          resultBlock = blks[np];
          resultPageIdx = pi + 1;
          break;
        }
      }
    }

    targetLec.board_pages = pages;
    course.last_lecture_id = lid;
    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();
    return { ok: true, course: norm, page_index: resultPageIdx, block: resultBlock } as T;
  }

  const quizSubmitMatch = path.match(/^\/api\/courses\/([^/]+)\/lectures\/([^/]+)\/quiz-submit$/);
  if (quizSubmitMatch && method === 'POST') {
    const cid = decodeURIComponent(quizSubmitMatch[1]);
    const lid = decodeURIComponent(quizSubmitMatch[2]);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) throw new Error('课程不存在');
    let targetLec: Record<string, unknown> | null = null;
    for (const u of (course.units as { lectures: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (l.id === lid) targetLec = l;
      }
    }
    if (!targetLec) throw new Error('讲次不存在');

    const qItems = (targetLec.quiz_items as Record<string, unknown>[]) || [];
    if (!qItems.length) throw new Error('当前讲次暂无随堂检验题');

    const ansMap = (body.answers as Record<string, string>) || {};
    let correctCount = 0;
    const graded = qItems.map((q) => {
      const qid = String(q.id || '');
      const expected = String(q.answer || 'A').trim().slice(0, 1).toUpperCase();
      const selected = String(ansMap[qid] || '').trim().slice(0, 1).toUpperCase();
      const correct = Boolean(selected && selected === expected);
      if (correct) correctCount += 1;
      return {
        id: qid,
        selected,
        expected,
        correct,
        explanation: String(q.explanation || ''),
        related_block_id: String(q.related_block_id || ''),
      };
    });

    const totalCount = qItems.length;
    const scorePct = Math.round((correctCount / totalCount) * 100);
    const targetMastery = scorePct >= 85 ? 'mastered' : scorePct >= 60 ? 'proficient' : correctCount > 0 ? 'familiar' : 'attempted';
    const order: Record<string, number> = { unstarted: 0, attempted: 1, familiar: 2, proficient: 3, mastered: 4 };
    const curM = String(targetLec.mastery || 'unstarted');
    if ((order[targetMastery] || 0) > (order[curM] || 0)) {
      targetLec.mastery = targetMastery;
    }

    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ws = (course.weekly_sessions as Record<string, number>) || {};
    ws[iso] = (ws[iso] || 0) + 1;
    course.weekly_sessions = ws;
    course.last_lecture_id = lid;
    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();
    return {
      ok: true,
      score_pct: scorePct,
      correct_count: correctCount,
      total_count: totalCount,
      items: graded,
      mastery: targetLec.mastery,
      course: norm,
    } as T;
  }

  const expandMatch = path.match(/^\/api\/courses\/([^/]+)\/expand$/);
  if (expandMatch && method === 'POST') {
    const cid = decodeURIComponent(expandMatch[1]);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) throw new Error('课程不存在');
    const note = String(body.note || '拓展讲义专题').trim();
    const units = (course.units as Record<string, unknown>[]) || [];
    const nextIdx = units.length + 1;
    const newLid = `lec_${cid}_${nextIdx}_1`;
    units.push({
      unit_index: nextIdx,
      title: `拓展讲义：${note.slice(0, 18)}`,
      summary: '根据新增资料拓展的单元脉络。',
      lectures: [
        {
          id: newLid,
          title: note.slice(0, 22),
          summary: '聚焦新增章节重点与反例辨析',
          kind: 'lecture',
          mastery: 'unstarted',
          duration_min: 18,
          visualizer_preset: 'cubic',
          board_pages: [
            {
              page_index: 1,
              roadmap_title: '拓展专题板书',
              blocks: [{ id: makeId('blk'), heading: `一、${note.slice(0, 14)}要点`, lines: ['提炼新增资料核心框架', '核对前后单元衔接条件'], highlight_note: '已并入课程路线' }],
            },
          ],
          messages: [{ id: makeId('wmsg'), role: 'assistant', content: `已将《${note}》扩充至第 ${nextIdx} 单元，可随时开始学习。`, created_at: Date.now() / 1000 }],
          quiz_items: [],
        },
      ],
    });
    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();
    return { ok: true, course: norm } as T;
  }

  const companionMatch = path.match(/^\/api\/courses\/([^/]+)\/generate-companion$/);
  if (companionMatch && method === 'POST') {
    const cid = decodeURIComponent(companionMatch[1]);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) throw new Error('课程不存在');
    const kind = String(body.kind || 'lesson');
    const linked = { ...((course.linked_ids as Record<string, string>) || {}) };
    let linkedItem: Record<string, unknown> = {};
    if (kind === 'lesson') {
      const target = state.lessons[0] || { id: 'les_demo_01', title: `${course.title} · 教学设计` };
      linked.lesson_id = String(target.id);
      linkedItem = { kind: 'lesson', id: target.id, title: `${course.title} · 教学设计`, subtitle: '已关联演示教案' };
    } else if (kind === 'ppt') {
      const target = state.ppt_decks[0] || { id: 'deck_demo_01', title: `${course.title} · 演示课件` };
      linked.deck_id = String(target.id);
      linkedItem = { kind: 'ppt', id: target.id, title: `${course.title} · 演示课件`, subtitle: '已关联示范课件' };
    } else {
      const target = state.exams[0] || { id: 'exam_demo_01', title: `${course.title} · 随堂卷` };
      linked.exam_id = String(target.id);
      linkedItem = { kind: 'exam', id: target.id, title: `${course.title} · 随堂测验卷`, subtitle: '已关联在线测验' };
    }
    course.linked_ids = linked;
    persistState();
    return { ok: true, kind, linked_item: linkedItem, course: recomputeCourseProgress(course) } as T;
  }

  const csMatch = path.match(/^\/api\/courses\/([^/]+)\/cheatsheet$/);
  if (csMatch && method === 'POST') {
    const cid = decodeURIComponent(csMatch[1]);
    const course = state.courses.find((c) => c.id === cid);
    return { ok: true, cheatsheet: course?.cheatsheet || state.courses[0]?.cheatsheet } as T;
  }

  if (path === '/api/courses/cheatsheet-custom' && method === 'POST') {
    const topic = String(body.topic || '核心专题复习');
    return {
      ok: true,
      cheatsheet: {
        title: `${topic} · 重点速查表`,
        subtitle: `${body.subject || '高中数学'} · ${body.grade_level || '高二年级'}（在线演示版）`,
        sections: [
          {
            title: '核心定义与公式程序',
            badge: '基础框架',
            items: [
              { term: topic, formula_or_rule: '① 标明定义域与约束前提 → ② 列关系化简或求导 → ③ 临界端点单独核对', highlight_color: 'blue', trap_note: '多段单调区间避免误用并集符号' },
            ],
          },
          {
            title: '易错反例清单',
            badge: '避坑提示',
            items: [
              { term: '特例回代验证', formula_or_rule: '取边界点或典型特值代入关系式，快速排查符号反转风险', highlight_color: 'yellow', trap_note: '分母与偶次根号先验零' },
            ],
          },
        ],
      },
    } as T;
  }

  // ---- Agent Memory & Threads ----
  if (path === '/api/agent/memory' && method === 'GET') {
    return { ok: true, ...cloneJson(state.memory) } as T;
  }
  if (path === '/api/agent/memory/preferences' && method === 'PUT') {
    const updates = (body.preferences as Record<string, string>) || {};
    state.memory.preferences = { ...state.memory.preferences, ...updates };
    persistState();
    return { ok: true, preferences: state.memory.preferences } as T;
  }
  if (path === '/api/agent/memory/remediation-quiz' && method === 'POST') {
    const baseExam = cloneJson(state.exams[0] || {});
    if (baseExam?.id) return { ok: true, exam_record: baseExam, target_topics: (body.topics as string[]) || [] } as T;
  }
  if (path === '/api/agent/threads' && method === 'GET') {
    return { ok: true, threads: cloneJson(state.threads) } as T;
  }
  const threadMatch = path.match(/^\/api\/agent\/threads\/([^/]+)$/);
  if (threadMatch) {
    const tid = decodeURIComponent(threadMatch[1]);
    if (method === 'GET') {
      const det = state.thread_details[tid] || state.threads.find((t) => t.id === tid);
      if (!det) throw new Error('会话不存在');
      return { ok: true, thread: cloneJson(det) } as T;
    }
    if (method === 'DELETE') {
      state.threads = state.threads.filter((t) => t.id !== tid);
      delete state.thread_details[tid];
      persistState();
      return { ok: true } as T;
    }
  }

  // ---- Calendar Tasks & Study Plans & Tutor ----
  if (path === '/api/tutor/calendar-tasks' && method === 'GET') {
    return { ok: true, tasks: cloneJson(state.calendar_tasks) } as T;
  }
  if (path === '/api/tutor/calendar-tasks' && method === 'POST') {
    const task = {
      id: makeId('ctsk'),
      date_str: String(body.date_str || '2026-11-23'),
      title: String(body.title || '学习待办'),
      course_title: String(body.course_title || ''),
      subject: String(body.subject || ''),
      minutes: Number(body.minutes || 30),
      completed: false,
      plan_id: String(body.plan_id || ''),
      created_at: Date.now() / 1000,
    };
    state.calendar_tasks.push(task);
    persistState();
    return { ok: true, task } as T;
  }
  const calPatchMatch = path.match(/^\/api\/tutor\/calendar-tasks\/([^/]+)$/);
  if (calPatchMatch) {
    const tid = decodeURIComponent(calPatchMatch[1]);
    if (method === 'PATCH') {
      const tk = state.calendar_tasks.find((x) => x.id === tid);
      if (!tk) throw new Error('待办不存在');
      if (body.completed !== undefined) tk.completed = Boolean(body.completed);
      if (body.title !== undefined) tk.title = String(body.title);
      persistState();
      return { ok: true, task: tk } as T;
    }
    if (method === 'DELETE') {
      state.calendar_tasks = state.calendar_tasks.filter((x) => x.id !== tid);
      persistState();
      return { ok: true, task_id: tid } as T;
    }
  }

  if (path === '/api/tutor/study-plans' && method === 'GET') {
    return { ok: true, plans: cloneJson(state.study_plans) } as T;
  }
  if (path === '/api/tutor/study-plans' && method === 'POST') {
    const pid = makeId('pln');
    const topics = (body.weak_topics as string[]) || [String(body.title || '专项突破')];
    const mins = Number(body.daily_minutes || 35);
    const phases = [
      '概念溯源与边界梳理',
      '核心例题脱稿复演',
      '同型变式专项巩固',
      '跨知识点结构串联',
      '错题二次闭卷复测',
      '限时微测综合检验',
      '学转教微格讲授复盘',
    ];
    const days = phases.map((ph, idx) => ({
      day: `第 ${idx + 1} 天`,
      focus: `${topics[idx % topics.length]} · ${ph}`,
      task: '先默写核心前提再完成对应巩固任务',
      minutes: mins,
      checkpoint: '步骤无跳步且特例检验通过',
    }));
    const plan = { id: pid, title: String(body.title || '7日学习计划'), goal: String(body.goal || ''), days };
    state.study_plans.unshift(plan);
    const today = new Date();
    days.forEach((d, idx) => {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + idx);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      state.calendar_tasks.push({
        id: makeId('ctsk'),
        date_str: iso,
        title: d.focus,
        course_title: plan.title,
        subject: topics[0] || '',
        minutes: mins,
        completed: false,
        plan_id: pid,
        created_at: Date.now() / 1000 + idx * 0.001,
      });
    });
    persistState();
    return { ok: true, plan } as T;
  }

  if (path === '/api/tutor/error-book' && method === 'GET') return { ok: true, items: cloneJson(state.error_book) } as T;
  if (path === '/api/tutor/error-book' && method === 'POST') {
    const item = { id: makeId('err'), ...body, mastery_level: 1, created_at: Date.now() / 1000 };
    state.error_book.unshift(item);
    persistState();
    return { ok: true, id: item.id } as T;
  }
  const errPatchMatch = path.match(/^\/api\/tutor\/error-book\/([^/]+)$/);
  if (errPatchMatch && method === 'PATCH') {
    const eid = decodeURIComponent(errPatchMatch[1]);
    const item = state.error_book.find((x) => x.id === eid);
    if (item) item.mastery_level = Number(body.mastery_level || 2);
    persistState();
    return { ok: true, mastery_level: item?.mastery_level || 2 } as T;
  }

  if (path === '/api/tutor/plot-function' && method === 'POST') {
    const expr = String(body.expression || 'x^3 - 3*x^2 + 2').trim();
    const cached = snap.plots_2d[expr];
    if (cached && body.x_min === undefined) return cloneJson(cached) as T;
    return sampleFunctionInBrowser(expr, Number(body.x_min ?? -2), Number(body.x_max ?? 3.5)) as T;
  }
  if (path === '/api/tutor/plot-surface-3d' && method === 'POST') {
    if (snap.surface_3d && snap.surface_3d.ok) return cloneJson(snap.surface_3d) as T;
    return { ok: false, detail: '演示模式展示预置三维曲面模型' } as T;
  }
  if (path === '/api/tutor/verify-expression' && method === 'POST') {
    const expr = String(body.expression || '');
    return { ok: true, status: 'verified', badge: '算式核对完成', detail: `演示环境已接收表达式：\`${expr}\`；连接后端服务可执行完整符号求解。` } as T;
  }
  const fuMatch = path.match(/^\/api\/tutor\/sessions\/([^/]+)\/followups$/);
  if (fuMatch) return { ok: true, messages: [] } as T;
  if (path === '/api/tutor/followup' && method === 'POST') {
    return {
      ok: true,
      session_id: String(body.session_id || makeId('tut')),
      reply: {
        role: 'assistant',
        content: `针对追问「${String(body.followup_question || '')}」：建议先标定定义域，再将关键关系式两端作差检查符号；如需在线调用大模型深度展开，可在「设置 → 服务连接」填写后端服务地址。`,
      },
    } as T;
  }

  // ---- Sources / KB ----
  if (path === '/api/sources/list' && method === 'GET') return { ok: true, documents: cloneJson(state.sources) } as T;
  if (path === '/api/sources/search' && method === 'GET') {
    const q = (qp.get('q') || '').trim().toLowerCase();
    const docFilter = qp.get('doc_id') || '';
    const allChunks = Object.values(state.source_chunks).flat();
    const hits = allChunks.filter((ch) => {
      if (docFilter && ch.doc_id !== docFilter) return false;
      if (!q) return true;
      return `${ch.doc_title} ${ch.chapter_title} ${ch.content}`.toLowerCase().includes(q);
    });
    return { ok: true, results: hits.slice(0, 8), total: hits.length } as T;
  }
  const srcChunkMatch = path.match(/^\/api\/sources\/([^/]+)\/chunks$/);
  if (srcChunkMatch && method === 'GET') {
    const did = decodeURIComponent(srcChunkMatch[1]);
    return { ok: true, chunks: cloneJson(state.source_chunks[did] || []) } as T;
  }
  const srcDelMatch = path.match(/^\/api\/sources\/([^/]+)$/);
  if (srcDelMatch && method === 'DELETE') {
    const did = decodeURIComponent(srcDelMatch[1]);
    state.sources = state.sources.filter((d) => d.id !== did);
    delete state.source_chunks[did];
    persistState();
    return { ok: true, doc_id: did } as T;
  }

  // ---- Pedagogy ----
  if (path === '/api/pedagogy/topics') {
    let list = snap.pedagogy_topics.topics || [];
    const sub = qp.get('subject');
    const dom = qp.get('domain');
    const br = qp.get('branch');
    const q = (qp.get('q') || '').trim().toLowerCase();
    if (sub) list = list.filter((t) => t.subject === sub);
    if (dom) list = list.filter((t) => t.domain_id === dom);
    if (br) list = list.filter((t) => t.branch === br);
    if (q) list = list.filter((t) => `${t.title} ${t.subject} ${t.board_punchline}`.toLowerCase().includes(q));
    return { ...snap.pedagogy_topics, topics: list, total: list.length } as T;
  }
  if (path === '/api/pedagogy/taxonomy') return cloneJson(snap.pedagogy_taxonomy) as T;
  if (path === '/api/pedagogy/search') {
    const q = (qp.get('q') || '').trim().toLowerCase();
    const list = (snap.pedagogy_topics.topics || []).filter((t) => !q || `${t.title} ${t.subject}`.toLowerCase().includes(q));
    return { ok: true, results: list.slice(0, 4) } as T;
  }

  // ---- Artifacts ----
  if (path === '/api/artifacts' && method === 'GET') return { ok: true, artifacts: cloneJson(state.artifacts) } as T;
  const artDelMatch = path.match(/^\/api\/artifacts\/([^/]+)$/);
  if (artDelMatch && method === 'DELETE') {
    const aid = decodeURIComponent(artDelMatch[1]);
    state.artifacts = state.artifacts.filter((a) => a.id !== aid);
    persistState();
    return { ok: true, deleted_id: aid } as T;
  }

  // ---- Specialist Studio Read/Write Routes ----
  if (path === '/api/lesson/list') return { ok: true, lessons: cloneJson(state.lessons) } as T;
  const lesMatch = path.match(/^\/api\/lesson\/([^/]+)$/);
  if (lesMatch && method === 'PUT') {
    const lid = decodeURIComponent(lesMatch[1]);
    const les = state.lessons.find((l) => l.id === lid);
    if (les) {
      les.content = body.content;
      les.edit_count = Number(les.edit_count || 0) + 1;
      persistState();
      return { ok: true, lesson: les } as T;
    }
  }
  const lesRewriteMatch = path.match(/^\/api\/lesson\/([^/]+)\/rewrite-section$/);
  if (lesRewriteMatch && method === 'POST') {
    const lid = decodeURIComponent(lesRewriteMatch[1]);
    const les = state.lessons.find((l) => l.id === lid);
    return { ok: true, lesson: les } as T;
  }

  if (path === '/api/ppt/themes') return cloneJson(snap.ppt_themes) as T;
  if (path === '/api/ppt/decks') return { ok: true, decks: cloneJson(state.ppt_decks) } as T;
  const deckGetMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)$/);
  if (deckGetMatch) {
    const did = decodeURIComponent(deckGetMatch[1]);
    const deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0];
    return { ok: true, deck: cloneJson(deck) } as T;
  }
  const deckThemeMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/theme$/);
  if (deckThemeMatch && method === 'POST') {
    const did = decodeURIComponent(deckThemeMatch[1]);
    const deck = state.ppt_decks.find((d) => d.id === did);
    if (deck) {
      deck.theme_id = String(body.theme_id || deck.theme_id);
      persistState();
    }
    return { ok: true, deck: cloneJson(deck) } as T;
  }
  const slideEditMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/slides\/(\d+)$/);
  if (slideEditMatch && method === 'PUT') {
    const did = decodeURIComponent(slideEditMatch[1]);
    const sNo = Number(slideEditMatch[2]);
    const deck = state.ppt_decks.find((d) => d.id === did);
    if (deck) {
      const sl = ((deck.slides as Record<string, unknown>[]) || []).find((s) => Number(s.slide_number) === sNo);
      if (sl) {
        if (body.speaker_notes !== undefined) sl.speaker_notes = body.speaker_notes;
        const edits = (body.edits as Record<string, string>) || {};
        if (edits.title) sl.title = edits.title;
        if (edits.subtitle) sl.subtitle = edits.subtitle;
        if (edits.takeaway) sl.takeaway = edits.takeaway;
      }
      persistState();
    }
    return { ok: true, deck: cloneJson(deck) } as T;
  }

  if (path === '/api/exam/bank/catalog') return cloneJson(snap.exam_catalog) as T;
  if (path === '/api/exam/list') return { ok: true, exams: cloneJson(state.exams) } as T;
  if (path === '/api/exam/bank/assemble' && method === 'POST') {
    return { ok: true, records: [cloneJson(state.exams[0])] } as T;
  }
  const examSubmitMatch = path.match(/^\/api\/exam\/([^/]+)\/submit$/);
  if (examSubmitMatch && method === 'POST') {
    const eid = decodeURIComponent(examSubmitMatch[1]);
    const exRec = state.exams.find((e) => e.id === eid) || state.exams[0];
    const exObj = (exRec?.exam as { questions?: Record<string, unknown>[] }) || {};
    const questions = exObj.questions || [];
    const answers = (body.answers as Record<string, string>) || {};
    let score = 0;
    let totalScore = 0;
    const weakTopics: string[] = [];
    const itemResults = questions.map((q, idx) => {
      const qid = String(q.id || `q${idx + 1}`);
      const maxPts = Number(q.score || 5);
      totalScore += maxPts;
      const uVal = String(answers[qid] || '').trim().toUpperCase();
      const rVal = String(q.answer || '').trim().toUpperCase();
      const ok = Boolean(uVal) && (uVal === rVal || uVal.charAt(0) === rVal.charAt(0));
      const earned = ok ? maxPts : 0;
      score += earned;
      const kp = String(q.knowledge_point || '综合要点');
      if (!ok && !weakTopics.includes(kp)) weakTopics.push(kp);
      return { question_id: qid, index: idx + 1, knowledge_point: kp, earned, max_score: maxPts, correct: ok, feedback: ok ? '答案核对一致' : `参考答案：${q.answer}`, correct_answer: String(q.answer || '') };
    });
    return {
      ok: true,
      submission: {
        id: makeId('sub'),
        exam_id: eid,
        exam_title: String(exRec?.title || '在线测验'),
        score,
        total_score: totalScore,
        duration_sec: Number(body.duration_sec || 0),
        logged_error_count: weakTopics.length,
        analytics_report_id: String(state.analytics_reports[0]?.id || ''),
        weak_topics: weakTopics,
        item_results: itemResults,
      },
    } as T;
  }

  if (path === '/api/analytics/sample-csv') return cloneJson(snap.sample_csv) as T;
  if (path === '/api/analytics/reports') return { ok: true, reports: cloneJson(state.analytics_reports) } as T;
  if (path === '/api/analytics/desensitize-preview' && method === 'POST') {
    return desensitizeCsvInBrowser(String(body.csv_text || '')) as T;
  }
  const anaRevMatch = path.match(/^\/api\/analytics\/([^/]+)\/review$/);
  if (anaRevMatch && method === 'PUT') {
    const rid = decodeURIComponent(anaRevMatch[1]);
    const rep = state.analytics_reports.find((r) => r.id === rid);
    if (rep) {
      rep.teacher_reviewed = Boolean(body.teacher_reviewed);
      rep.teacher_note = String(body.teacher_note || '');
      persistState();
    }
    return { ok: true } as T;
  }

  if (path === '/api/mindmap/list') return { ok: true, mindmaps: cloneJson(state.mindmaps) } as T;
  if (path === '/api/mindmap/from-topic' && method === 'POST') {
    const mm = cloneJson(state.mindmaps[0]);
    if (body.custom_title) mm.title = body.custom_title;
    return { ok: true, mindmap: mm } as T;
  }
  const mmPutMatch = path.match(/^\/api\/mindmap\/([^/]+)$/);
  if (mmPutMatch && method === 'PUT') {
    const mid = decodeURIComponent(mmPutMatch[1]);
    const mm = state.mindmaps.find((m) => m.id === mid);
    if (mm && body.graph) mm.graph = body.graph;
    persistState();
    return { ok: true, mindmap: cloneJson(mm) } as T;
  }

  throw new Error(`静态演示暂不支持该即时请求（${path}），可在「设置 → 服务连接」填入后端地址开启完整在线运算`);
}

export async function demoEventStream(
  url: string,
  body: Record<string, unknown>,
  onEvent: EventCallback
): Promise<void> {
  const { state } = await ensureDemoLoaded();
  const parsedUrl = new URL(url, 'http://demo.local');
  const path = parsedUrl.pathname;

  // 1. Course craft stream
  if (path === '/api/courses/craft') {
    const prompt = String(body.prompt || '学科专题课程').trim();
    const mode = body.mode === 'teaching' ? 'teaching' : 'self_study';
    onEvent('stage', { stage: 'analyze', message: '正在解析课程目标与讲义结构…' });
    await pause(180);
    onEvent('stage', { stage: 'outline', message: '正在编排单元大纲、白板路线与速查表…' });
    await pause(220);
    const created = buildCourseFromTemplate({ title: prompt.slice(0, 20), subject: '学科专题', grade_level: '高二年级', description: `围绕「${prompt}」构建的体系化课程。` }, mode);
    state.courses.unshift(created);
    persistState();
    onEvent('result', { course: created, duration_ms: 400 });
    return;
  }

  // 2. Whiteboard lecture chat-stream & teach-step
  const teachStepMatch = path.match(/^\/api\/courses\/([^/]+)\/lectures\/([^/]+)\/teach-step$/);
  if (teachStepMatch) {
    const cid = decodeURIComponent(teachStepMatch[1]);
    const lid = decodeURIComponent(teachStepMatch[2]);
    const action = String(body.action || 'next_segment');
    const blockId = String(body.block_id || '');
    const pageIndexReq = Number(body.page_index || 1);
    const course = state.courses.find((c) => c.id === cid);
    if (!course) {
      onEvent('error', { message: '课程不存在' });
      return;
    }
    let targetLec: Record<string, unknown> | null = null;
    for (const u of (course.units as { lectures: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (l.id === lid) targetLec = l;
      }
    }
    if (!targetLec) {
      onEvent('error', { message: '讲次不存在' });
      return;
    }

    type DemoPage = { page_index: number; roadmap_title: string; blocks: Record<string, unknown>[] };
    const pages = (targetLec.board_pages as DemoPage[]) || [{ page_index: 1, roadmap_title: '本节课路线图', blocks: [] }];
    let focusBlk: Record<string, unknown> | null = null;
    for (const pg of pages) {
      for (const b of pg.blocks || []) {
        if (b.id === blockId) focusBlk = b;
      }
    }
    if (!focusBlk && pages.length) {
      const clampedPg = pages[Math.max(0, Math.min(pages.length - 1, pageIndexReq - 1))];
      if (clampedPg?.blocks?.length) focusBlk = clampedPg.blocks[clampedPg.blocks.length - 1];
    }

    const shortFocus = String(focusBlk?.heading || targetLec.title || '本讲核心')
      .replace(/^[一二三四五六七八九十]+、\s*/, '')
      .slice(0, 14);
    onEvent('stage', { stage: 'thinking', message: '正在构思交互讲解并同步左侧白板…' });
    await pause(160);

    const now = Date.now() / 1000;
    const msgs = (targetLec.messages as Record<string, unknown>[]) || [];

    if (action === 'socratic_check') {
      const qItem: Record<string, unknown> = {
        id: makeId('q'),
        question: `结合板书「${shortFocus}」，下列在判断或演算时最必须优先检验的环节是（ ）`,
        options: [
          'A. 先明确函数或结论成立的定义域及前提约束，再做符号与临界点分析',
          'B. 直接代入单个特值后推广到全区间',
          'C. 跳过驻点两侧符号检验直接判极值',
          'D. 将不连续单调区间直接用并集 $\\cup$ 连接',
        ],
        answer: 'A',
        explanation: `针对「${shortFocus}」，优先界定前提与定义域并用典型特例复核临界边界，是严谨解题的核心保证。`,
        related_block_id: String(focusBlk?.id || ''),
      };
      const qList = (targetLec.quiz_items as Record<string, unknown>[]) || [];
      qList.push(qItem);
      targetLec.quiz_items = qList;
      const replyText = `我结合「${shortFocus}」为你出了一道即时诊断检验题，已同步至「随堂检验」面板。`;
      for (let i = 0; i < replyText.length; i += 12) {
        onEvent('delta', { text: replyText.slice(i, i + 12) });
        await pause(30);
      }
      const aMsg = { id: makeId('wmsg'), role: 'assistant', content: replyText, board_anchor_id: String(focusBlk?.id || ''), created_at: now };
      msgs.push(aMsg);
      targetLec.messages = msgs;
      if (targetLec.mastery === 'unstarted') targetLec.mastery = 'attempted';
      const norm = recomputeCourseProgress(course);
      Object.assign(course, norm);
      persistState();
      onEvent('quiz_item', { quiz_item: qItem });
      onEvent('result', { ok: true, action, reply: aMsg, new_quiz_item: qItem, course: norm });
      return;
    }

    let replyText = '';
    let newBlk: Record<string, unknown>;
    if (action === 'reexplain_analogy') {
      replyText = `换个生活画面理解「${shortFocus}」：就像开车爬坡看仪表盘瞬时坡度，中途短暂轻踩一次刹车只是瞬时水平点（如 $f(x)=x^3$ 原点），整条山路高度仍稳步抬升。`;
      newBlk = {
        id: makeId('blk'),
        block_type: 'concept',
        heading: `直观类比：${shortFocus}`,
        lines: ['开车爬坡图景：切线斜率对应瞬时爬坡倾角', '短暂停顿（$f\'(x_0)=0$）不改整体严格递增趋势'],
        highlight_note: '先看整体走势方向，再检验离散零点',
        narration: latexToSpokenZh(`换个更容易记住的比喻来理解${shortFocus}：就像开车上坡看坡度表，中途轻微松一脚油门只是某个瞬间斜率为零，前后都在上升就依然是严格单调递增。`),
        teaching_tip: '课堂停顿：配合手势比划爬坡趋势，再引回导数符号检验。',
      };
    } else if (action === 'worked_example') {
      replyText = `围绕「${shortFocus}」补充规范典例 $f(x)=x^3-3x$：定义域为全体实数，求导得 $f'(x)=3(x-1)(x+1)$，列表判号可知极值 $f(-1)=2$、$f(1)=-2$。`;
      newBlk = {
        id: makeId('blk'),
        block_type: 'example',
        heading: `典例拆解：${shortFocus}`,
        lines: [
          '例题：分析 $f(x)=x^3-3x$ 的单调区间与极值',
          'Step 1 求导因式分解：$f\'(x)=3(x-1)(x+1)=0 \\Rightarrow x=\\pm 1$',
          'Step 2 列表判号：$(-\\infty,-1)$ 和 $(1,+\\infty)$ 递增；$(-1,1)$ 递减',
        ],
        highlight_note: '严谨书写：两段增区间之间用“和”连接',
        verified_badge: '导数与驻点已校核 · 已验算',
        narration: latexToSpokenZh('看这道典例：f of x 等于 x 的立方减 3x，求导因式分解后找到正负 1 两个驻点，分段列表即可锁定极大值 2 与极小值负 2。'),
        teaching_tip: '请学生口答三个分段区间内的导数正负符号。',
        visual_expr: 'x^3 - 3*x',
      };
    } else if (action === 'counterexample') {
      replyText = `针对「${shortFocus}」补充两条必避反例：$f(x)=1/x$ 禁止跨断点写并集 $\\cup$；$f(x)=|x|$ 在尖点不可导仍为极小值。`;
      newBlk = {
        id: makeId('blk'),
        block_type: 'trap',
        heading: `易错反例：${shortFocus}`,
        lines: [
          '反例 1：$f(x)=\\frac{1}{x}$ 跨间断点不能用并集 $\\cup$ 连接递减区间',
          '反例 2：$f(x)=|x|$ 不可导但取极小值；$f(x)=x^3$ 可导且 $f\'(0)=0$ 却无极值',
        ],
        highlight_note: '遇分母先标间断点，判极值须检左右变号',
        narration: latexToSpokenZh('注意这两条高频反例：x 分之一跨越原点不能用并集连接；绝对值 x 在原点不可导却是极小值。'),
        teaching_tip: '红笔标出并集禁忌与尖点极值对比。',
      };
    } else if (action === 'teacher_script') {
      replyText = `已生成围绕「${shortFocus}」的 3 分钟微格试讲导入、板书衔接与设问逐字稿，并写入左侧白板卡片。`;
      newBlk = {
        id: makeId('blk'),
        block_type: 'concept',
        heading: `试讲口播稿：${shortFocus}`,
        lines: [
          '设问导入：“各位同学先观察切线方向，何时上升何时水平？”',
          '板书推进：主栏写定义域与求导分解，副栏保留反例对比',
          '即时收束：引导完成 1 道随堂检验确认符号判据过关',
        ],
        highlight_note: '试讲节奏：设问留白 3 秒 + 关键词高亮对齐',
        narration: latexToSpokenZh('试讲导入示范：各位同学请先关注图像中的水平切线，为什么这一瞬斜率为零却没有阻断曲线继续升高？'),
        teaching_tip: '面向听众停顿 2 秒后再展开右侧四步推导。',
      };
    } else {
      replyText = `已提炼「${shortFocus}」的核心知识骨架与口诀：定域优先、求导分解、找驻点、列表判变号，要点已追加至白板。`;
      newBlk = {
        id: makeId('blk'),
        block_type: action === 'summarize' ? 'summary' : 'derivation',
        heading: action === 'summarize' ? `核心小结：${shortFocus}` : `进阶延伸：${shortFocus}`,
        lines: ['1. 定域为先：锁定自然定义域与参数前提', '2. 列表为据：检查临界点左右导数符号变化', '3. 书写闭环：区间分隔用“和”，端点单独检验'],
        highlight_note: '定域 -> 求导 -> 列表 -> 验边界',
        narration: latexToSpokenZh(`归纳核心四步口诀：一标定义域，二求导分解，三定驻点，四列表检验左右变号。`),
        teaching_tip: '结课停顿，提示切换「随堂检验」自测。',
      };
    }

    for (let i = 0; i < replyText.length; i += 12) {
      onEvent('delta', { text: replyText.slice(i, i + 12) });
      await pause(30);
    }

    if (!pages.length || pages[pages.length - 1].blocks.length >= 4) {
      pages.push({ page_index: pages.length + 1, roadmap_title: `课堂互动板书 · 第 ${pages.length + 1} 页`, blocks: [newBlk] });
    } else {
      pages[pages.length - 1].blocks.push(newBlk);
    }
    targetLec.board_pages = pages;

    const aMsg = { id: makeId('wmsg'), role: 'assistant', content: replyText, board_anchor_id: newBlk.id, created_at: now };
    msgs.push(aMsg);
    targetLec.messages = msgs;
    if (targetLec.mastery === 'unstarted') targetLec.mastery = 'attempted';
    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();

    onEvent('board_block', { block: newBlk, page_index: pages.length });
    onEvent('result', { ok: true, action, reply: aMsg, new_board_block: newBlk, page_index: pages.length, course: norm });
    return;
  }

  const wbMatch = path.match(/^\/api\/courses\/([^/]+)\/lectures\/([^/]+)\/chat-stream$/);
  if (wbMatch) {
    const cid = decodeURIComponent(wbMatch[1]);
    const lid = decodeURIComponent(wbMatch[2]);
    const msg = String(body.message || '').trim();
    const focusBlockId = String(body.focus_block_id || '');
    const course = state.courses.find((c) => c.id === cid);
    if (!course) {
      onEvent('error', { message: '课程不存在' });
      return;
    }
    let targetLec: Record<string, unknown> | null = null;
    for (const u of (course.units as { lectures: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (l.id === lid) targetLec = l;
      }
    }
    if (!targetLec) {
      onEvent('error', { message: '讲次不存在' });
      return;
    }

    onEvent('stage', { stage: 'thinking', message: '正在结合当前白板板书梳理推演过程…' });
    await pause(150);

    const hasEquation = /=|\^|x\b/i.test(msg);
    let replyText = '';
    let blkLines: string[] = [];
    let blkHeading = `追问解析：${msg.slice(0, 12)}`;
    let verifiedBadge = '';

    if (msg.includes('x^2') && msg.includes('1')) {
      blkHeading = '验证方程两根';
      blkLines = ['因式分解：$x^2 - 1 = (x - 1)(x + 1) = 0$', '求得实根：$x_1 = 1,\\; x_2 = -1$', '代入检验：$1^2 - 1 = 0$，$(-1)^2 - 1 = 0$'];
      replyText = '方程 $x^2 - 1 = 0$ 可因式分解为 $(x - 1)(x + 1) = 0$，解得 $x = 1$ 与 $x = -1$。将两根代入原方程验证均成立，它们恰好将定义域分成三段进行符号判定。';
      verifiedBadge = '方程求解完成 · 已验算';
    } else if (hasEquation) {
      blkLines = [`核心条件提炼：针对「${msg.slice(0, 26)}」先限定定义域`, '化简关键关系式并定位临界点/零点', '分区间检号后以特值回代确认结论'];
      replyText = `围绕“${msg.slice(0, 32)}”，建议先写明前提条件并拆解关系式中的临界点，分区间检号验证单调性或解集范围。要点已同步添加到左侧白板。`;
      verifiedBadge = '算式核对完成 · 已验算';
    } else {
      blkLines = ['先写明概念成立的前提范围', '通过正反特例对照检查推导步进是否闭合'];
      replyText = `关于“${msg.slice(0, 32)}”，核心在于把握概念的前提边界并用反例验证边界情形，已将要点补充到左侧白板，你可以点击「板书」标签快速锚定。`;
    }

    for (let i = 0; i < replyText.length; i += 12) {
      onEvent('delta', { text: replyText.slice(i, i + 12) });
      await pause(35);
    }

    const blkId = makeId('blk');
    const newBlk: Record<string, unknown> = {
      id: blkId,
      block_type: hasEquation ? 'derivation' : 'concept',
      heading: blkHeading,
      lines: blkLines,
      highlight_note: '核对前提 -> 分步推演 -> 特例验算',
      narration: latexToSpokenZh(replyText),
      teaching_tip: '板书同步：高亮验证前提条件与边界根值。',
      ...(verifiedBadge ? { verified_badge: verifiedBadge } : {}),
    };
    const vExpr = extractPlottableFromBlock(newBlk as unknown as BoardBlock);
    if (vExpr) newBlk.visual_expr = vExpr;

    const pages = (targetLec.board_pages as { page_index: number; roadmap_title: string; blocks: Record<string, unknown>[] }[]) || [];
    if (!pages.length || pages[pages.length - 1].blocks.length >= 4) {
      pages.push({ page_index: pages.length + 1, roadmap_title: `课堂互动板书 · 第 ${pages.length + 1} 页`, blocks: [newBlk] });
    } else {
      pages[pages.length - 1].blocks.push(newBlk);
    }
    targetLec.board_pages = pages;

    const now = Date.now() / 1000;
    const uMsg = { id: makeId('wmsg'), role: 'user', content: msg, board_anchor_id: focusBlockId, created_at: now };
    const aMsg = { id: makeId('wmsg'), role: 'assistant', content: replyText, board_anchor_id: blkId, created_at: now + 0.01 };
    const msgs = (targetLec.messages as Record<string, unknown>[]) || [];
    msgs.push(uMsg, aMsg);
    targetLec.messages = msgs;
    if (targetLec.mastery === 'unstarted') targetLec.mastery = 'attempted';

    const norm = recomputeCourseProgress(course);
    Object.assign(course, norm);
    persistState();

    onEvent('board_block', { block: newBlk, page_index: pages.length });
    onEvent('result', { ok: true, reply: aMsg, new_board_block: newBlk, page_index: pages.length, course: norm });
    return;
  }

  // 3. Agent chat & plan execution in demo mode
  if (path === '/api/agent/chat' || path.endsWith('/execute-plan')) {
    const tid = path.endsWith('/execute-plan')
      ? decodeURIComponent(path.split('/')[4])
      : String(body.thread_id || makeId('thr'));
    const goal = String(body.message || state.thread_details[tid]?.pending_goal || '智能协同备课演示');
    const isFast = body.speed_mode === 'fast';
    const requireConf = Boolean(body.require_confirmation) && !isFast && !path.endsWith('/execute-plan');

    const steps = isFast
      ? [{ tool: 'generate_cheatsheet', step_label: `梳理「${goal.slice(0, 12)}」核心速查卡`, args: { topic: goal } }]
      : [
          { tool: 'search_topics', step_label: '检索全学科教学法与易错反例', args: { query: goal } },
          { tool: 'generate_cheatsheet', step_label: '生成重点速查表', args: { topic: goal } },
          { tool: 'build_remediation_quiz', step_label: '匹配薄弱点巩固测验卷', args: {} },
        ];

    let th = state.thread_details[tid];
    if (!th) {
      th = { id: tid, title: goal.slice(0, 20), status: 'idle', plan: [], pending_goal: '', artifacts: {}, messages: [], created_at: Date.now() / 1000, updated_at: Date.now() / 1000 };
      state.thread_details[tid] = th;
      state.threads.unshift({ id: tid, title: th.title, status: 'idle', created_at: th.created_at, updated_at: th.updated_at });
    }
    const msgs = (th.messages as Record<string, unknown>[]) || [];
    if (!path.endsWith('/execute-plan')) {
      msgs.push({ id: makeId('amsg'), role: 'user', content: goal, created_at: Date.now() / 1000 });
    }

    onEvent('stage', { stage: 'planning', message: '正在分析目标并编排协同步骤…' });
    await pause(180);

    if (requireConf) {
      th.status = 'awaiting_confirmation';
      th.plan = steps;
      th.pending_goal = goal;
      msgs.push({
        id: makeId('amsg'),
        role: 'assistant',
        content: '已为您规划以下协同步骤，确认后立即执行：',
        plan: steps,
        needs_confirmation: true,
        created_at: Date.now() / 1000,
      });
      th.messages = msgs;
      persistState();
      onEvent('plan_confirmation', { thread: cloneJson(th), summary: '确认后自动完成：', steps });
      return;
    }

    onEvent('plan', { thread_id: tid, summary: '按以下计划协同处理：', steps });
    const traces: Record<string, unknown>[] = [];
    for (let i = 0; i < steps.length; i++) {
      onEvent('step_start', { index: i + 1, total: steps.length, tool: steps[i].tool, label: steps[i].step_label });
      await pause(160);
      const tr = { index: i + 1, tool: steps[i].tool, label: steps[i].step_label, ok: true, summary: '已完成演示输出' };
      traces.push(tr);
      onEvent('step_done', tr);
    }

    const sampleExam = state.exams[0];
    const linkedItems: Record<string, unknown>[] = [
      {
        kind: 'cheatsheet',
        id: makeId('cs'),
        title: `${goal.slice(0, 14)} · 重点速查表`,
        subtitle: '重点与反例一页览（演示输出）',
        cheatsheet_data: (await demoApiJson<{ cheatsheet: unknown }>('/api/courses/cheatsheet-custom', { method: 'POST', body: JSON.stringify({ topic: goal.slice(0, 18) }) })).cheatsheet,
      },
      ...(sampleExam
        ? [{ kind: 'exam', id: sampleExam.id, title: sampleExam.title, subtitle: '可直接进入在线作答与自动判分' }]
        : []),
    ];

    const assistantMsg = {
      id: makeId('amsg'),
      role: 'assistant',
      content: `已完成「${goal.slice(0, 24)}」协同整理（当前运行在内置静态演示模式；若在「设置 → 服务连接」中填写后端地址，将实时生成定制 Word/PPTX 与大模型深度推理结果）。`,
      plan: steps,
      tool_traces: traces,
      linked_items: linkedItems,
      needs_confirmation: false,
      created_at: Date.now() / 1000,
    };
    th.status = 'completed';
    msgs.push(assistantMsg);
    th.messages = msgs;
    persistState();
    onEvent('result', { thread: cloneJson(th), message: assistantMsg, linked_items: linkedItems, duration_ms: 480 });
  }
}

export async function demoSseStream(
  url: string,
  body: Record<string, unknown>,
  callbacks: StreamHandlers
): Promise<void> {
  const { state } = await ensureDemoLoaded();
  callbacks.onStage?.('demo', '正在基于本地静态引擎快速梳理结果…');
  await pause(220);

  if (url === '/api/tutor/solve') {
    const q = String(body.question || '');
    callbacks.onText?.('分步推演已就绪');
    await pause(160);
    callbacks.onResult({
      session_id: makeId('tut'),
      question: q,
      subject: String(body.subject || '高中数学'),
      grade_level: String(body.grade_level || '高二年级'),
      solution: {
        topic_tag: '示范分步推导（演示模式）',
        known_conditions: [`原问题：${q.slice(0, 80)}`],
        missing_condition_check: { has_ambiguity: false, prompt: '已按常见定义域边界梳理；连接后端服务可执行完整符号自动检验与定制解答。' },
        hints: [
          { level: 1, title: '先写定义域', content: '优先关注对数真数、分母与偶次根号限制。' },
          { level: 2, title: '求导找临界', content: '对可导函数求导并分解因式，标出全部驻点。' },
          { level: 3, title: '特例复核', content: '代入区间内简单测试点确认正负号。' },
        ],
        steps: [
          { step: 1, title: '明确前提范围', derivation: '优先划定表达式成立的自变量区间。', theorem_basis: '定义域优先原则' },
          { step: 2, title: '分步推导与检验', derivation: '依关系式完成变形、求解并与边界比对。', theorem_basis: '等价变形与分类讨论' },
        ],
        final_answer: '演示模式下已完成解题框架整理；配置自建后端地址即可获取实时 AI 符号验算全解。',
        knowledge_graph: { prerequisites: ['基础代数恒等变形'], core_concept: '先定范围，再分步推演', common_traps: ['忽略隐含定义域'], extensions: ['含参分类讨论'], interdisciplinary_bridges: [] },
        variants: [],
      },
      verification: { status: 'verified', badge: '演示模式 · 框架已核对', checks: [], auto_repaired: false, repair_rounds: 0, repair_notes: [] },
      duration_ms: 350,
    });
    return;
  }

  if (url === '/api/lesson/generate' && state.lessons[0]) {
    callbacks.onResult({ lesson: cloneJson(state.lessons[0]), duration_ms: 300 });
    return;
  }
  if (url === '/api/ppt/generate' && state.ppt_decks[0]) {
    callbacks.onResult({ deck: cloneJson(state.ppt_decks[0]), duration_ms: 300 });
    return;
  }
  if (url === '/api/exam/generate' && state.exams[0]) {
    callbacks.onResult({ exam_record: cloneJson(state.exams[0]), duration_ms: 300 });
    return;
  }
  if (url === '/api/analytics/analyze' && state.analytics_reports[0]) {
    callbacks.onResult({ report: cloneJson(state.analytics_reports[0]), duration_ms: 300 });
    return;
  }
  if (url === '/api/mindmap/generate' && state.mindmaps[0]) {
    callbacks.onResult({ mindmap: cloneJson(state.mindmaps[0]), duration_ms: 300 });
    return;
  }

  callbacks.onError?.('当前为静态演示模式，该生成操作需连接在线后端服务（可在「设置 → 服务连接」填写地址）。');
}

export async function demoUploadFile(file: File): Promise<{
  source_id: string;
  filename: string;
  converter: string;
  char_count: number;
  chunk_count?: number;
  quality_note?: string;
  chapters_preview?: string[];
  markdown_preview: string;
  markdown_full: string;
}> {
  const { state } = await ensureDemoLoaded();
  const sid = makeId('src');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const readableText = ['md', 'txt', 'csv', 'tex', 'html'].includes(ext)
    ? await file.text()
    : `# ${file.name}\n\n演示模式下已在浏览器收录文件《${file.name}》（${Math.round(file.size / 1024)} KB）。连接本地/云端后端可解锁 PDF/Office 二进制全量解析。`;
  const doc = {
    id: sid,
    filename: file.name,
    title: file.name.replace(/\.[^.]+$/, ''),
    file_path: '',
    char_count: readableText.length,
    chunk_count: 1,
    quality_note: '浏览器本地演示解析完成',
    created_at: Date.now() / 1000,
  };
  state.sources.unshift(doc);
  state.source_chunks[sid] = [
    { id: makeId('chk'), doc_id: sid, doc_title: doc.title, chapter_title: '导入正文摘录', chunk_index: 0, content: readableText.slice(0, 1200) },
  ];
  persistState();
  return {
    source_id: sid,
    filename: file.name,
    converter: 'browser_demo_reader',
    char_count: readableText.length,
    chunk_count: 1,
    quality_note: doc.quality_note,
    chapters_preview: ['导入正文摘录'],
    markdown_preview: readableText.slice(0, 1200),
    markdown_full: readableText.slice(0, 4000),
  };
}

export async function downloadStaticDemoFile(url: string, fallbackName = 'eduforge_demo_export.md'): Promise<void> {
  const { state } = await ensureDemoLoaded();
  let content = `# 知学工作台演示导出\n\n请求路径：${url}\n\n提示：完整二进制 .docx / .pptx / .zip 打包导出需连接 FastAPI 后端服务（本地运行时访问 127.0.0.1:5173 或在设置中填入后端地址）。\n`;
  let filename = fallbackName;

  const zipMatch = url.match(/\/api\/courses\/([^/]+)\/export-zip/);
  if (zipMatch) {
    const cid = decodeURIComponent(zipMatch[1]);
    const c = state.courses.find((x) => x.id === cid) as { title?: string; description?: string; units?: { unit_index: number; title: string; lectures: { title: string; board_pages?: { blocks?: { heading: string; lines: string[] }[] }[] }[] }[] } | undefined;
    if (c) {
      filename = `${c.title || '课程大纲'}_演示大纲与板书.md`;
      const lines = [`# ${c.title}`, '', c.description || '', ''];
      for (const u of c.units || []) {
        lines.push(`## 第 ${u.unit_index} 单元：${u.title}`);
        for (const l of u.lectures || []) {
          lines.push(`### ${l.title}`);
          for (const pg of l.board_pages || []) {
            for (const blk of pg.blocks || []) {
              lines.push(`- **${blk.heading}**：${(blk.lines || []).join('；')}`);
            }
          }
        }
      }
      content = lines.join('\n');
    }
  } else if (url.includes('/api/artifacts/')) {
    const aid = url.split('/')[3];
    const art = state.artifacts.find((a) => a.id === aid) as { title?: string; filename?: string; category?: string } | undefined;
    if (art) {
      filename = `${String(art.filename || art.title || 'demo_export').replace(/\.[^.]+$/, '')}_演示版.md`;
      content = `# ${art.title || '导出内容'}\n\n类别：${art.category || 'artifact'}\n\n在在线静态演示模式下，系统已为您导出结构化 Markdown 文本版；连接本地/云端后端可下载完整 Word / PPTX / Draw.io 文件。\n`;
    }
  }

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
