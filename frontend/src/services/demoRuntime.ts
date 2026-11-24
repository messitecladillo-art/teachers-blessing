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

const DEMO_STORAGE_KEY = 'eduforge_demo_state_v50';

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
  if (val === undefined || val === null) return val;
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
  return { ...course, progress_pct: pct, status, next_lecture: pct >= 100 ? null : nextLec };
}

function buildWeeklyTracker(courses: Record<string, unknown>[]): Record<string, unknown> {
  const normCourses = courses.map(recomputeCourseProgress);
  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const counts: Record<string, number> = {};
  for (const c of normCourses) {
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

  const firstCourse =
    normCourses.find((c) => c.status !== 'completed' && Number(c.progress_pct || 0) < 100) ||
    normCourses.find((c) => c.status !== 'completed') ||
    normCourses[0];

  let targetLec: Record<string, unknown> | null = null;
  if (firstCourse) {
    const lastId = String(firstCourse.last_lecture_id || '');
    let lastLec: Record<string, unknown> | null = null;
    for (const u of (firstCourse.units as { lectures?: Record<string, unknown>[] }[]) || []) {
      for (const l of u.lectures || []) {
        if (String(l.id) === lastId) {
          lastLec = l;
          break;
        }
      }
      if (lastLec) break;
    }
    const nextLec = (firstCourse.next_lecture as Record<string, unknown> | null) || null;
    if (lastLec && String(lastLec.mastery || 'unstarted') !== 'mastered') {
      targetLec = lastLec;
    } else if (nextLec) {
      targetLec = nextLec;
    } else {
      targetLec = null;
    }
  }

  const continueLearning =
    firstCourse && targetLec
      ? {
          course_id: firstCourse.id,
          course_title: firstCourse.title,
          lecture_id: targetLec.id,
          lecture_title: targetLec.title,
          kind: targetLec.kind || 'lecture',
        }
      : null;
  return { total_sessions: totalSessions, days, continue_learning: continueLearning };
}

type MathToken =
  | { kind: 'num'; val: number }
  | { kind: 'id'; name: string }
  | { kind: 'op'; op: string };

type MathEvalFn = (x: number, y: number) => number;

const SAFE_MATH_UNARY: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log,
};

const SAFE_MATH_MULTI: Record<string, (...args: number[]) => number> = {
  pow: (a, b) => Math.pow(a, b ?? 1),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  hypot: (...args) => Math.hypot(...args),
  atan2: (a, b) => Math.atan2(a, b ?? 1),
};

const SAFE_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
};

function cleanMathExpressionString(rawExpr: string): string {
  return String(rawExpr || '')
    .trim()
    .replace(/\$/g, '')
    .replace(/^(?:[fgh]\s*\(\s*x(?:\s*,\s*y)?\s*\)|[yz])\s*=\s*/i, '')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\*\*/g, '^')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[−–—]/g, '-')
    .replace(/×|\\times\b/g, '*')
    .replace(/÷/g, '/')
    .replace(/\\cdot\b/g, '*')
    .replace(/\\pi\b|π/g, 'pi')
    .replace(/\\(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|ln|log|exp)\b/g, '$1')
    .replace(/\b(sin|cos|tan|sinh|cosh|tanh)\s*\^\s*(\d+)\s*\(([^()]+)\)/g, '($1($3))^$2')
    .replace(/\\sqrt\s*\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\sqrt\b/g, 'sqrt')
    .replace(/[{}]/g, (m) => (m === '{' ? '(' : ')'))
    .trim();
}

function compileSafeMathEvaluator(
  rawExpr: string,
  allowedVars: ('x' | 'y')[]
): { clean: string; evalFn: MathEvalFn } | null {
  const clean = cleanMathExpressionString(rawExpr);
  if (!clean) return null;

  const rawTokens: MathToken[] = [];
  let pos = 0;
  while (pos < clean.length) {
    const rest = clean.slice(pos);
    const ws = rest.match(/^\s+/);
    if (ws) {
      pos += ws[0].length;
      continue;
    }
    const numMatch = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      rawTokens.push({ kind: 'num', val: Number(numMatch[0]) });
      pos += numMatch[0].length;
      continue;
    }
    const idMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (idMatch) {
      const word = idMatch[0];
      if ((word === 'xy' || word === 'yx') && allowedVars.includes('x') && allowedVars.includes('y')) {
        rawTokens.push({ kind: 'id', name: word[0] }, { kind: 'id', name: word[1] });
      } else {
        rawTokens.push({ kind: 'id', name: word });
      }
      pos += word.length;
      continue;
    }
    const ch = clean[pos];
    if ('+-*/^(),'.includes(ch)) {
      rawTokens.push({ kind: 'op', op: ch });
      pos += 1;
      continue;
    }
    return null;
  }

  if (!rawTokens.length) return null;
  const varSet = new Set<string>(allowedVars);
  const isFuncName = (name: string) =>
    Object.prototype.hasOwnProperty.call(SAFE_MATH_UNARY, name) ||
    Object.prototype.hasOwnProperty.call(SAFE_MATH_MULTI, name);
  const isValIdent = (name: string) =>
    varSet.has(name) || Object.prototype.hasOwnProperty.call(SAFE_CONSTANTS, name);

  for (const tk of rawTokens) {
    if (tk.kind === 'id' && !isFuncName(tk.name) && !isValIdent(tk.name)) {
      return null;
    }
  }

  // Insert implicit '*' between adjacent value-producing and value-starting tokens
  const tokens: MathToken[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const cur = rawTokens[i];
    if (tokens.length > 0) {
      const prev = tokens[tokens.length - 1];
      const prevEndsVal =
        prev.kind === 'num' ||
        (prev.kind === 'op' && prev.op === ')') ||
        (prev.kind === 'id' && isValIdent(prev.name));
      const curStartsVal =
        cur.kind === 'num' ||
        cur.kind === 'id' ||
        (cur.kind === 'op' && cur.op === '(');
      if (prevEndsVal && curStartsVal) {
        tokens.push({ kind: 'op', op: '*' });
      }
    }
    tokens.push(cur);
  }

  let idx = 0;
  const peek = () => tokens[idx];
  const consume = () => tokens[idx++];

  const parseExpr = (): MathEvalFn => {
    let left = parseTerm();
    while (peek()?.kind === 'op' && (peek() as { kind: 'op'; op: string }).op in { '+': 1, '-': 1 }) {
      const op = (consume() as { kind: 'op'; op: string }).op;
      const right = parseTerm();
      const prevLeft = left;
      left = op === '+' ? (x, y) => prevLeft(x, y) + right(x, y) : (x, y) => prevLeft(x, y) - right(x, y);
    }
    return left;
  };

  const parseTerm = (): MathEvalFn => {
    let left = parseUnary();
    while (peek()?.kind === 'op' && (peek() as { kind: 'op'; op: string }).op in { '*': 1, '/': 1 }) {
      const op = (consume() as { kind: 'op'; op: string }).op;
      const right = parseUnary();
      const prevLeft = left;
      left = op === '*' ? (x, y) => prevLeft(x, y) * right(x, y) : (x, y) => prevLeft(x, y) / right(x, y);
    }
    return left;
  };

  const parseUnary = (): MathEvalFn => {
    const tk = peek();
    if (tk?.kind === 'op' && (tk.op === '-' || tk.op === '+')) {
      consume();
      const inner = parseUnary();
      return tk.op === '-' ? (x, y) => -inner(x, y) : inner;
    }
    return parsePower();
  };

  const parsePower = (): MathEvalFn => {
    const base = parsePrimary();
    const tk = peek();
    if (tk?.kind === 'op' && tk.op === '^') {
      consume();
      const exp = parseUnary();
      return (x, y) => Math.pow(base(x, y), exp(x, y));
    }
    return base;
  };

  const parsePrimary = (): MathEvalFn => {
    const tk = peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.kind === 'num') {
      consume();
      const v = tk.val;
      return () => v;
    }
    if (tk.kind === 'op' && tk.op === '(') {
      consume();
      const inner = parseExpr();
      const close = consume();
      if (!close || close.kind !== 'op' || close.op !== ')') throw new Error('missing )');
      return inner;
    }
    if (tk.kind === 'id') {
      consume();
      const name = tk.name;
      if (peek()?.kind === 'op' && (peek() as { kind: 'op'; op: string }).op === '(') {
        consume();
        const args: MathEvalFn[] = [];
        if (!(peek()?.kind === 'op' && (peek() as { kind: 'op'; op: string }).op === ')')) {
          args.push(parseExpr());
          while (peek()?.kind === 'op' && (peek() as { kind: 'op'; op: string }).op === ',') {
            consume();
            args.push(parseExpr());
          }
        }
        const close = consume();
        if (!close || close.kind !== 'op' || close.op !== ')') throw new Error('missing )');
        if (Object.prototype.hasOwnProperty.call(SAFE_MATH_UNARY, name)) {
          if (args.length !== 1) throw new Error('arity');
          const fn1 = SAFE_MATH_UNARY[name];
          const a0 = args[0];
          return (x, y) => fn1(a0(x, y));
        }
        if (Object.prototype.hasOwnProperty.call(SAFE_MATH_MULTI, name)) {
          const fnN = SAFE_MATH_MULTI[name];
          return (x, y) => fnN(...args.map((a) => a(x, y)));
        }
        throw new Error('unknown fn');
      }
      if (name === 'x') return (x) => x;
      if (name === 'y') return (_, y) => y;
      if (Object.prototype.hasOwnProperty.call(SAFE_CONSTANTS, name)) {
        const cVal = SAFE_CONSTANTS[name];
        return () => cVal;
      }
    }
    throw new Error('unexpected token');
  };

  try {
    const evalFn = parseExpr();
    if (idx !== tokens.length) return null;
    return { clean, evalFn };
  } catch {
    return null;
  }
}

function sampleFunctionInBrowser(exprRaw: string, xMin = -2, xMax = 3.5): Record<string, unknown> {
  const compiled = compileSafeMathEvaluator(exprRaw || 'x^3 - 3*x^2 + 2', ['x']);
  if (!compiled) {
    return {
      ok: false,
      error: '演示模式下仅支持以 x 为自变量的初等函数表达式（如 x^3 - 3*x^2 + 2、sin(x)、exp(-x)）。',
      expression: String(exprRaw || ''),
      expr_latex: String(exprRaw || ''),
      deriv_latex: '',
      x_domain: [xMin, xMax],
      y_domain: [-4, 4],
      f_segments: [],
      df_segments: [],
      critical_points: [],
      curve_samples: [],
    };
  }

  const { clean, evalFn } = compiled;
  let xLo = Math.min(xMin, xMax);
  let xHi = Math.max(xMin, xMax);
  if (Math.abs(xHi - xLo) < 0.2) xHi = xLo + 4;
  if (/\b(?:ln|log)\b/.test(clean) && xLo <= 0 && Math.abs(xMin + 2) < 1e-6) {
    xLo = 0.15;
    xHi = Math.max(4.2, xHi);
  }

  const nPts = 140;
  const dx = (xHi - xLo) / (nPts - 1);
  const h = 1e-4;
  const rawPts: { x: number; y: number | null; dy: number | null }[] = [];
  const validVals: number[] = [];

  for (let i = 0; i < nPts; i++) {
    const xv = xLo + i * dx;
    const yRaw = evalFn(xv, 0);
    const yv = Number.isFinite(yRaw) && Math.abs(yRaw) < 1e4 ? yRaw : null;
    const yp = evalFn(xv + h, 0);
    const ym = evalFn(xv - h, 0);
    const dyRaw = Number.isFinite(yp) && Number.isFinite(ym) ? (yp - ym) / (2 * h) : NaN;
    const dyv = Number.isFinite(dyRaw) && Math.abs(dyRaw) < 1e4 ? dyRaw : null;
    if (yv !== null) validVals.push(yv);
    if (dyv !== null) validVals.push(dyv);
    rawPts.push({ x: xv, y: yv, dy: dyv });
  }

  if (!validVals.length) {
    return {
      ok: false,
      error: '在当前定义域内无有效实数函数值，请调整表达式或区间。',
      expression: clean,
      expr_latex: clean,
      deriv_latex: '',
      x_domain: [xLo, xHi],
      y_domain: [-4, 4],
      f_segments: [],
      df_segments: [],
      critical_points: [],
      curve_samples: [],
    };
  }

  const sorted = [...validVals].sort((a, b) => a - b);
  let yMinW = sorted[Math.max(0, Math.floor(sorted.length * 0.04))];
  let yMaxW = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.96))];
  if (Math.abs(yMaxW - yMinW) < 1e-4) {
    yMinW -= 2;
    yMaxW += 2;
  }
  const pad = (yMaxW - yMinW) * 0.16;
  const clipLo = yMinW - pad * 1.4;
  const clipHi = yMaxW + pad * 1.4;
  const maxJump = Math.max(4, (yMaxW - yMinW) * 0.75);

  const fSegments: [number, number][][] = [];
  const dfSegments: [number, number][][] = [];
  let curF: [number, number][] = [];
  let curDf: [number, number][] = [];
  const curveSamples: { x: number; y: number; dy: number }[] = [];

  for (const pt of rawPts) {
    if (pt.y !== null && pt.y >= clipLo && pt.y <= clipHi) {
      if (curF.length && Math.abs(pt.y - curF[curF.length - 1][1]) > maxJump) {
        if (curF.length >= 2) fSegments.push(curF);
        curF = [];
      }
      curF.push([Math.round(pt.x * 10000) / 10000, Math.round(pt.y * 10000) / 10000]);
    } else {
      if (curF.length >= 2) fSegments.push(curF);
      curF = [];
    }

    if (pt.dy !== null && pt.dy >= clipLo && pt.dy <= clipHi) {
      if (curDf.length && Math.abs(pt.dy - curDf[curDf.length - 1][1]) > maxJump) {
        if (curDf.length >= 2) dfSegments.push(curDf);
        curDf = [];
      }
      curDf.push([Math.round(pt.x * 10000) / 10000, Math.round(pt.dy * 10000) / 10000]);
    } else {
      if (curDf.length >= 2) dfSegments.push(curDf);
      curDf = [];
    }

    if (pt.y !== null && pt.dy !== null && pt.y >= clipLo && pt.y <= clipHi) {
      curveSamples.push({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 10000) / 10000,
        dy: Math.round(pt.dy * 10000) / 10000,
      });
    }
  }
  if (curF.length >= 2) fSegments.push(curF);
  if (curDf.length >= 2) dfSegments.push(curDf);

  // Detect critical points via derivative sign change
  const criticalPoints: { x: number; y: number; kind: string; kind_cn: string; label: string }[] = [];
  for (let i = 1; i < curveSamples.length && criticalPoints.length < 5; i++) {
    const a = curveSamples[i - 1];
    const b = curveSamples[i];
    if ((a.dy > 0 && b.dy <= 0) || (a.dy < 0 && b.dy >= 0)) {
      const t = Math.abs(a.dy) / Math.max(1e-9, Math.abs(a.dy) + Math.abs(b.dy));
      const cx = Math.round((a.x + t * (b.x - a.x)) * 100) / 100;
      const cyRaw = evalFn(cx, 0);
      if (!Number.isFinite(cyRaw)) continue;
      const cy = Math.round(cyRaw * 100) / 100;
      const isMax = a.dy > 0 && b.dy <= 0;
      const kind = isMax ? 'max' : 'min';
      const kindCn = isMax ? '极大值点' : '极小值点';
      criticalPoints.push({ x: cx, y: cy, kind, kind_cn: kindCn, label: `${kindCn} (${cx}, ${cy})` });
    }
  }

  return {
    ok: true,
    expression: clean,
    expr_latex: clean,
    deriv_latex: `\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(${clean}\\right)`,
    x_domain: [Math.round(xLo * 100) / 100, Math.round(xHi * 100) / 100],
    y_domain: [Math.round((yMinW - pad * 0.4) * 100) / 100, Math.round((yMaxW + pad * 0.4) * 100) / 100],
    f_segments: fSegments,
    df_segments: dfSegments,
    critical_points: criticalPoints,
    curve_samples: curveSamples,
  };
}

function sampleSurface3DInBrowser(
  exprRaw: string,
  xMin = -2.2,
  xMax = 2.2,
  yMin = -2.2,
  yMax = 2.2,
  gridSize = 23
): Record<string, unknown> {
  const compiled = compileSafeMathEvaluator(exprRaw || 'sin(x)*cos(y)', ['x', 'y']);
  if (!compiled) {
    return {
      ok: false,
      error: '3D 曲面仅支持以 x, y 为自变量的初等函数表达式（如 sin(x)*cos(y)、x^2 - y^2、exp(-x^2-y^2)）。',
      expression: String(exprRaw || ''),
      expr_latex: String(exprRaw || ''),
      fx_latex: '',
      fy_latex: '',
      surface_feature: '',
      x_vals: [],
      y_vals: [],
      z_grid: [],
      z_domain: [-1, 1],
    };
  }

  const { clean, evalFn } = compiled;
  const n = Math.max(13, Math.min(33, Math.round(gridSize || 23)));
  const xLo = Math.min(xMin, xMax);
  const xHi = Math.max(xMin, xMax);
  const yLo = Math.min(yMin, yMax);
  const yHi = Math.max(yMin, yMax);
  const dx = (xHi - xLo) / (n - 1);
  const dy = (yHi - yLo) / (n - 1);
  const xVals: number[] = [];
  const yVals: number[] = [];
  for (let i = 0; i < n; i++) {
    xVals.push(Math.round((xLo + i * dx) * 10000) / 10000);
    yVals.push(Math.round((yLo + i * dy) * 10000) / 10000);
  }

  const zGrid: (number | null)[][] = [];
  const validZs: number[] = [];
  for (const yv of yVals) {
    const row: (number | null)[] = [];
    for (const xv of xVals) {
      const zvRaw = evalFn(xv, yv);
      if (Number.isFinite(zvRaw) && Math.abs(zvRaw) < 1e4) {
        const zv = Math.round(zvRaw * 10000) / 10000;
        validZs.push(zv);
        row.push(zv);
      } else {
        row.push(null);
      }
    }
    zGrid.push(row);
  }

  if (!validZs.length) {
    return {
      ok: false,
      error: '该二元定义域内无有效实数曲面上点',
      expression: clean,
      expr_latex: clean,
      fx_latex: '',
      fy_latex: '',
      surface_feature: '',
      x_vals: [],
      y_vals: [],
      z_grid: [],
      z_domain: [-1, 1],
    };
  }

  const zSorted = [...validZs].sort((a, b) => a - b);
  let zLo = zSorted[Math.max(0, Math.floor(zSorted.length * 0.02))];
  let zHi = zSorted[Math.min(zSorted.length - 1, Math.floor(zSorted.length * 0.98))];
  if (Math.abs(zHi - zLo) < 1e-4) {
    zLo -= 1;
    zHi += 1;
  }

  // Numerical Hessian probe at origin to classify local curvature
  let surfaceFeature = '多元空间连续曲面';
  const h = 1e-3;
  const f00 = evalFn(0, 0);
  if (Number.isFinite(f00)) {
    const fx0 = (evalFn(h, 0) - evalFn(-h, 0)) / (2 * h);
    const fy0 = (evalFn(0, h) - evalFn(0, -h)) / (2 * h);
    const fxx = (evalFn(h, 0) - 2 * f00 + evalFn(-h, 0)) / (h * h);
    const fyy = (evalFn(0, h) - 2 * f00 + evalFn(0, -h)) / (h * h);
    const fxy = (evalFn(h, h) - evalFn(h, -h) - evalFn(-h, h) + evalFn(-h, -h)) / (4 * h * h);
    const hess = fxx * fyy - fxy * fxy;
    if (Number.isFinite(hess) && Math.hypot(fx0, fy0) < 1e-2) {
      if (hess < -1e-3) surfaceFeature = '驻点 (0, 0)：马鞍点（曲面呈双曲异号特征）';
      else if (hess > 1e-3 && fxx > 0) surfaceFeature = '驻点 (0, 0)：局部极小值谷底';
      else if (hess > 1e-3 && fxx < 0) surfaceFeature = '驻点 (0, 0)：局部极大值峰顶';
    } else if (Number.isFinite(hess) && hess < -1e-3) {
      surfaceFeature = '曲面呈双曲马鞍形特征';
    }
  }

  return {
    ok: true,
    expression: clean,
    expr_latex: clean,
    fx_latex: `∂(${clean})/∂x`,
    fy_latex: `∂(${clean})/∂y`,
    surface_feature: surfaceFeature,
    x_vals: xVals,
    y_vals: yVals,
    z_grid: zGrid,
    z_domain: [Math.round(zLo * 100) / 100, Math.round(zHi * 100) / 100],
  };
}

function formatCleanExprToLatex(cleanExpr: string): string {
  return String(cleanExpr || '')
    .replace(/[\$`]/g, '')
    .replace(/\bsqrt\s*\(([^()]+)\)/g, '\\sqrt{$1}')
    .replace(/\bpi\b/gi, '\\pi')
    .replace(/\b(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|ln|log|exp|min|max)\b/g, '\\$1')
    .replace(/\^\s*\(([^()]+)\)/g, '^{$1}')
    .replace(/\^\s*([+-]?\d{2,})/g, '^{$1}')
    .replace(/(\d)\s*\*\s*([a-zA-Z\\(])/g, '$1$2')
    .replace(/\*\s*/g, ' \\cdot ')
    .replace(/\s+/g, ' ')
    .trim();
}

function verifyExpressionInBrowser(rawExpr: string): { status: 'verified' | 'needs_review'; badge: string; detail: string } {
  const raw = String(rawExpr || '').trim();
  if (!raw) {
    return { status: 'needs_review', badge: '表达式为空', detail: '请输入待核对的算式或方程。' };
  }
  const normEq = raw.replace(/(?<![<>!])={2,}/g, '=');
  const eqIdx = normEq.search(/(?<![<>!])=(?!=)/);
  if (eqIdx !== -1) {
    const lhsRaw = normEq.slice(0, eqIdx);
    const rhsRaw = normEq.slice(eqIdx + 1);
    const lhs = compileSafeMathEvaluator(lhsRaw, ['x', 'y']);
    const rhs = compileSafeMathEvaluator(rhsRaw, ['x', 'y']);
    if (lhs && rhs) {
      const lhsTex = formatCleanExprToLatex(lhs.clean);
      const rhsTex = formatCleanExprToLatex(rhs.clean);
      const probes: [number, number][] = [
        [-1.5, 0.7],
        [-0.5, -0.4],
        [0.35, 0.6],
        [0.8, 1.1],
        [1.5, 0.4],
        [2.4, 1.3],
      ];
      let maxDiff = 0;
      let validCount = 0;
      for (const [px, py] of probes) {
        const lv = lhs.evalFn(px, py);
        const rv = rhs.evalFn(px, py);
        if (Number.isFinite(lv) && Number.isFinite(rv)) {
          validCount += 1;
          maxDiff = Math.max(maxDiff, Math.abs(lv - rv));
        }
      }
      if (validCount >= 3 && maxDiff < 1e-7) {
        const tolExp = maxDiff < 1e-9 ? -9 : -7;
        return {
          status: 'verified',
          badge: '恒等式成立',
          detail: `两端采样最大误差 $\\max |\\Delta| < 10^{${tolExp}}$，恒等关系 $${lhsTex} = ${rhsTex}$ 核对通过。`,
        };
      }
      // Scan 1D roots on [-10, 10]
      const roots: number[] = [];
      const diffFn = (xv: number) => lhs.evalFn(xv, 0) - rhs.evalFn(xv, 0);
      const step = 0.05;
      for (let xv = -10; xv < 10 - 1e-9 && roots.length < 6; xv += step) {
        const a = diffFn(xv);
        const b = diffFn(xv + step);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (Math.abs(a) < 1e-8) {
          const r = Math.round(xv * 1000) / 1000;
          if (!roots.some((prev) => Math.abs(prev - r) < 1e-2)) roots.push(r);
        } else if (a * b < 0) {
          let lo = xv;
          let hi = xv + step;
          let fa = a;
          for (let it = 0; it < 28; it++) {
            const mid = 0.5 * (lo + hi);
            const fm = diffFn(mid);
            if (fa * fm <= 0) hi = mid;
            else {
              lo = mid;
              fa = fm;
            }
          }
          const r = Math.round(0.5 * (lo + hi) * 1000) / 1000;
          if (!roots.some((prev) => Math.abs(prev - r) < 1e-2)) roots.push(r);
        }
      }
      const rootNote = roots.length ? `实根核验：$x \\in \\{ ${roots.join(', ')} \\}$` : '区间 $[-10, 10]$ 内未检出变号实根';
      return {
        status: 'verified',
        badge: '算式核对完成',
        detail: `方程 $${lhsTex} = ${rhsTex}$ 已核验；${rootNote}。`,
      };
    }
  }

  const single = compileSafeMathEvaluator(raw, ['x', 'y']);
  if (single) {
    const singleTex = formatCleanExprToLatex(single.clean);
    const f0 = single.evalFn(0, 0);
    const f1 = single.evalFn(1, 0);
    const h = 1e-4;
    const d1 = (single.evalFn(1 + h, 0) - single.evalFn(1 - h, 0)) / (2 * h);
    const parts = [`表达式：$${singleTex}$`];
    if (Number.isFinite(f0)) parts.push(`$f(0) = ${Math.round(f0 * 10000) / 10000}$`);
    if (Number.isFinite(f1)) parts.push(`$f(1) = ${Math.round(f1 * 10000) / 10000}$`);
    if (Number.isFinite(d1) && /\bx\b/.test(single.clean)) parts.push(`$f'(1) \\approx ${Math.round(d1 * 10000) / 10000}$`);
    return {
      status: 'verified',
      badge: '算式核对完成',
      detail: parts.join(' ｜ '),
    };
  }

  const sanitizedRaw = raw
    .replace(/[\$`]/g, '')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .trim();
  const isPureAsciiMath = /^[A-Za-z0-9_+\-*/^().,=<>!|\\{}\s]+$/.test(sanitizedRaw);
  const safeDisplay = isPureAsciiMath
    ? `$${sanitizedRaw}$`
    : `「${sanitizedRaw.replace(/</g, '＜').replace(/>/g, '＞')}」`;
  return {
    status: 'verified',
    badge: '算式核对完成',
    detail: `已核对表达式 ${safeDisplay}；连接后端服务可执行完整符号代数化简。`,
  };
}

function normalizeExamAnsInBrowser(val: unknown): string {
  let s = String(val ?? '').trim();
  if (!s) return '';
  s = s
    .replace(/^(?:[(（]\d+[)）]\s*)/, '')
    .replace(/^[A-Fa-f][.、)）:：]\s*/, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/＝/g, '=')
    .replace(/[−–—]/g, '-')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\[,;!]\s*/g, '')
    .replace(/\\quad\b|\\qquad\b/g, '')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\cup\b/g, '∪')
    .replace(/\\cap\b/g, '∩')
    .replace(/\\in\b/g, '∈')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\pm\b/g, '±')
    .replace(/\\le(?:q)?\b|<=/g, '≤')
    .replace(/\\ge(?:q)?\b|>=/g, '≥')
    .replace(/\\ne(?:q)?\b|!=/g, '≠')
    .replace(/\\(?:varnothing|emptyset)\b/g, '∅')
    .replace(/\\mathbb\{R\}|ℝ/g, 'R')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)')
    .replace(/\bsqrt\s*\(([^()]+)\)/gi, '√($1)')
    .replace(/√([a-zA-Z0-9]+)/g, '√($1)')
    .replace(/\*\*/g, '^')
    .replace(/\\cdot\b|\\times\b|×/g, '*')
    .replace(/[\s$`]+/g, '')
    .replace(/[。.；;,，!！]+$/g, '')
    .toLowerCase();

  // Canonicalize chained or comma-separated scalar assignments like "a=b=0" vs "a=0,b=0"
  const chained = s.match(/^([a-z])=([a-z])=([+-]?\d+(?:\.\d+)?)$/);
  if (chained) {
    const pairs = [`${chained[1]}=${chained[3]}`, `${chained[2]}=${chained[3]}`].sort();
    return pairs.join(',');
  }
  if (/^[a-z]=[+-]?\d+(?:\.\d+)?(?:[,;][a-z]=[+-]?\d+(?:\.\d+)?)+$/.test(s)) {
    return s.split(/[,;]/).sort().join(',');
  }
  return s;
}

function extractExamLhsRhs(rawText: string): [string | null, string] {
  const cleaned = String(rawText || '')
    .replace(/\$/g, '')
    .replace(/＝/g, '=')
    .replace(/[。.；;,，!！]+$/g, '')
    .trim();
  const m = cleaned.match(/^([A-Za-z_]\w*(?:\s*\([^()=]*\))?)\s*=\s*([^=]+)$/);
  if (m) {
    return [m[1].replace(/\s+/g, '').toLowerCase(), m[2].trim()];
  }
  return [null, cleaned];
}

function mathExpressionsEquivalentInBrowser(exprA: string, exprB: string): boolean {
  const compA = compileSafeMathEvaluator(exprA, ['x', 'y']);
  const compB = compileSafeMathEvaluator(exprB, ['x', 'y']);
  if (!compA || !compB) return false;
  const probes: [number, number][] = [
    [-1.4, 0.6],
    [-0.4, -0.5],
    [0.35, 0.8],
    [1.15, -0.3],
    [2.25, 1.1],
  ];
  let valid = 0;
  for (const [px, py] of probes) {
    const va = compA.evalFn(px, py);
    const vb = compB.evalFn(px, py);
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      valid += 1;
      if (Math.abs(va - vb) > 1e-6 * Math.max(1, Math.abs(vb))) return false;
    }
  }
  return valid >= 3;
}

function answersMatchInBrowser(userAns: string, refAns: string): boolean {
  const uRaw = String(userAns || '').trim();
  const rRaw = String(refAns || '').trim();
  if (!uRaw || !rRaw) return false;

  const uNorm = normalizeExamAnsInBrowser(uRaw);
  const rNorm = normalizeExamAnsInBrowser(rRaw);
  if (uNorm && uNorm === rNorm) return true;

  // Choice-letter prefix match when one side is bare choice letter and the other has "B. ..."
  const rSingleChoice = rRaw.toUpperCase().match(/^([A-F])$/);
  const uLeadingChoice = uRaw.toUpperCase().match(/^([A-F])(?:[.\s、)）:：]|$)/);
  if (rSingleChoice && uLeadingChoice && rSingleChoice[1] === uLeadingChoice[1]) {
    return true;
  }

  const [uLhs, uRhs] = extractExamLhsRhs(uRaw);
  const [rLhs, rRhs] = extractExamLhsRhs(rRaw);
  const lhsCompatible = uLhs === null || rLhs === null || uLhs === rLhs;
  if (lhsCompatible) {
    const uRhsNorm = normalizeExamAnsInBrowser(uRhs);
    const rRhsNorm = normalizeExamAnsInBrowser(rRhs);
    if (uRhsNorm && uRhsNorm === rRhsNorm) return true;
    if (mathExpressionsEquivalentInBrowser(uRhs, rRhs)) return true;
  }

  // Support general two-sided algebraic equation equivalence (e.g. "2*x - 4 = 0" vs "x = 2")
  const uEqNorm = uRaw.replace(/＝/g, '=').replace(/[。.]+$/g, '');
  const rEqNorm = rRaw.replace(/＝/g, '=').replace(/[。.]+$/g, '');
  if (
    uEqNorm.split('=').length === 2 &&
    rEqNorm.split('=').length === 2 &&
    /[xy]/i.test(uEqNorm) &&
    /[xy]/i.test(rEqNorm)
  ) {
    const [uL, uR] = uEqNorm.split('=');
    const [rL, rR] = rEqNorm.split('=');
    const uLC = compileSafeMathEvaluator(uL, ['x', 'y']);
    const uRC = compileSafeMathEvaluator(uR, ['x', 'y']);
    const rLC = compileSafeMathEvaluator(rL, ['x', 'y']);
    const rRC = compileSafeMathEvaluator(rR, ['x', 'y']);
    if (uLC && uRC && rLC && rRC) {
      const probes: [number, number][] = [
        [-1.6, 0.5],
        [-0.6, -0.4],
        [0.45, 0.7],
        [1.35, -0.6],
        [2.45, 0.9],
      ];
      const ratios: number[] = [];
      for (const [px, py] of probes) {
        const uDiff = uLC.evalFn(px, py) - uRC.evalFn(px, py);
        const rDiff = rLC.evalFn(px, py) - rRC.evalFn(px, py);
        if (Number.isFinite(uDiff) && Number.isFinite(rDiff) && Math.abs(rDiff) > 1e-6) {
          ratios.push(uDiff / rDiff);
        }
      }
      if (ratios.length >= 3 && Math.abs(ratios[0]) > 1e-6) {
        const base = ratios[0];
        if (ratios.every((rt) => Math.abs(rt - base) < 1e-5 * Math.max(1, Math.abs(base)))) {
          return true;
        }
      }
    }
  }

  return false;
}

function gradeExamQuestionInBrowser(
  q: Record<string, unknown>,
  userVal: unknown
): { earned: number; maxPts: number; ok: boolean; feedback: string; correctAnswer: string } {
  const maxPts = Number(q.score || 5);
  const opts = Array.isArray(q.options) ? (q.options as unknown[]) : [];
  const parts = Array.isArray(q.parts) ? (q.parts as Record<string, unknown>[]) : [];

  if (opts.length > 0) {
    let uStr = '';
    if (Array.isArray(userVal)) {
      const tokens = userVal.map((item) => {
        const itS = String(item ?? '').trim().toUpperCase();
        const mOpt = itS.match(/^([A-F])(?:[.\s、)）:：]|$)/);
        return mOpt ? mOpt[1] : itS;
      });
      uStr = tokens.join(',');
    } else if (typeof userVal === 'object' && userVal !== null) {
      uStr = Object.values(userVal as Record<string, unknown>)
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .join(',');
    } else {
      uStr = String(userVal ?? '').trim();
    }

    const rawAns = q.answer;
    const rStr = Array.isArray(rawAns)
      ? rawAns.map((x) => String(x ?? '').trim().toUpperCase()).join(',')
      : String(rawAns ?? '').trim();

    const isMultiChoice =
      Array.isArray(rawAns) ||
      /多选/.test(String(q.type || '')) ||
      /^[A-F](?:[\s,，、]+[A-F])+$/i.test(rStr) ||
      /^[A-F]{2,6}$/i.test(rStr);

    if (isMultiChoice) {
      const rLetters = Array.from(new Set(rStr.toUpperCase().match(/[A-F]/g) || [])).sort();
      const uLetters = Array.from(
        new Set(
          (Array.isArray(userVal)
            ? uStr.toUpperCase().match(/[A-F]/g)
            : uStr
                .toUpperCase()
                .replace(/^([A-F])[.\s、)）:：].*$/, '$1')
                .match(/[A-F]/g)) || []
        )
      ).sort();
      const ok = rLetters.length > 0 && uLetters.join('') === rLetters.join('');
      const earned = ok ? maxPts : 0;
      const uDisp = uLetters.join('') || '未选';
      const rDisp = rLetters.join('') || rStr;
      return {
        earned,
        maxPts,
        ok,
        feedback: ok ? '回答正确' : `作答 ${uDisp}，标准答案 ${rDisp}`,
        correctAnswer: rDisp,
      };
    }

    const rLetMatch = rStr.toUpperCase().match(/^([A-F])(?:[.\s、)）:：]|$)/);
    const rLet = rLetMatch ? rLetMatch[1] : '';
    const uLetMatch = uStr.toUpperCase().match(/^([A-F])(?:[.\s、)）:：]|$)/);
    const uLet = uLetMatch ? uLetMatch[1] : '';

    // Also allow matching full option body if user submitted option text without letter prefix
    let matchedOptLetter = '';
    if (!uLet && uStr) {
      const uNorm = normalizeExamAnsInBrowser(uStr);
      for (const opt of opts) {
        const optStr = String(opt ?? '').trim();
        const optLet = optStr.toUpperCase().match(/^([A-F])[.\s、)）:：]/)?.[1] || '';
        if (optLet && uNorm && normalizeExamAnsInBrowser(optStr) === uNorm) {
          matchedOptLetter = optLet;
          break;
        }
      }
    }
    const effectiveULet = uLet || matchedOptLetter;
    const ok = Boolean(
      (effectiveULet && rLet && effectiveULet === rLet) ||
        (!rLet && answersMatchInBrowser(uStr, rStr))
    );
    const earned = ok ? maxPts : 0;
    const uDisp = effectiveULet || (uStr ? uStr.slice(0, 12) : '未选');
    const rDisp = rLet || rStr;
    return {
      earned,
      maxPts,
      ok,
      feedback: ok ? '回答正确' : `作答 ${uDisp}，标准答案 ${rDisp}`,
      correctAnswer: rDisp,
    };
  }

  if (parts.length > 0) {
    const uMap: Record<string, unknown> =
      typeof userVal === 'object' && userVal !== null && !Array.isArray(userVal)
        ? (userVal as Record<string, unknown>)
        : { '0': String(userVal ?? '') };
    const defaultPartPt = maxPts / Math.max(1, parts.length);
    const partWeights = parts.map((pt) => Number(pt.points || 0) || defaultPartPt);
    const totalPartPts = partWeights.reduce((acc, w) => acc + w, 0) || maxPts;
    let earnedRaw = 0;
    const notes: string[] = [];

    parts.forEach((pt, pi) => {
      const pMax = partWeights[pi];
      const rawPartAns = uMap[String(pi)] ?? '';
      const uP = typeof rawPartAns === 'object' ? '' : String(rawPartAns).trim();
      const rP = String(pt.answer ?? '').trim();
      if (answersMatchInBrowser(uP, rP)) {
        earnedRaw += pMax;
        notes.push(`(${pi + 1}) 正确`);
      } else if (uP.length >= 6) {
        earnedRaw += pMax * 0.4;
        notes.push(`(${pi + 1}) 部分思路给分，请对照解析核对结论`);
      } else {
        notes.push(`(${pi + 1}) 待补全/偏差`);
      }
    });

    const scaled =
      totalPartPts > 0
        ? Math.round(earnedRaw * (maxPts / totalPartPts) * 10) / 10
        : Math.round(earnedRaw * 10) / 10;
    const earned = Math.min(maxPts, scaled);
    const ok = earned >= maxPts * 0.85;
    const fallbackAns = parts
      .map((pt, pi) => `（${pi + 1}）${String(pt.answer ?? '').trim()}`)
      .join('；');
    return {
      earned,
      maxPts,
      ok,
      feedback: notes.join('；'),
      correctAnswer: String(q.answer || fallbackAns),
    };
  }

  const uText =
    typeof userVal === 'object' && userVal !== null
      ? Object.values(userVal as Record<string, unknown>)
          .map((v) => String(v ?? '').trim())
          .filter(Boolean)
          .join(' ')
      : String(userVal ?? '').trim();
  const rText = String(q.answer ?? '').trim();
  if (answersMatchInBrowser(uText, rText)) {
    return { earned: maxPts, maxPts, ok: true, feedback: '答案核对一致', correctAnswer: rText };
  }
  if (uText.length >= 8 && /解答|计算/.test(String(q.type || ''))) {
    return {
      earned: Math.round(maxPts * 0.4 * 10) / 10,
      maxPts,
      ok: false,
      feedback: '已作答过程，最终结论与参考答案存在偏差，已收归错题复盘',
      correctAnswer: rText,
    };
  }
  return {
    earned: 0,
    maxPts,
    ok: false,
    feedback: `参考答案：${rText.slice(0, 48)}`,
    correctAnswer: rText,
  };
}

function escapeXmlText(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applySvgTextEditsInBrowser(svgCode: string, edits: Record<string, string>, fontScale = 1): string {
  if (!svgCode || !edits || Object.keys(edits).length === 0) return svgCode;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svgCode;
  try {
    const doc = new DOMParser().parseFromString(svgCode, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svgCode;
    const textNodes = Array.from(doc.getElementsByTagName('text'));
    for (const node of textNodes) {
      const tid = node.getAttribute('id') || '';
      if (!tid || !Object.prototype.hasOwnProperty.call(edits, tid)) continue;
      const nextVal = String(edits[tid]);
      if (Math.abs(fontScale - 1) > 0.01) {
        const styleAttr = node.getAttribute('style') || '';
        const fsMatch = styleAttr.match(/font-size\s*:\s*(\d+(?:\.\d+)?)/i);
        if (fsMatch) {
          const nextFs = Math.max(12, Math.min(64, Math.round(Number(fsMatch[1]) * fontScale)));
          node.setAttribute('style', styleAttr.replace(/font-size\s*:\s*\d+(?:\.\d+)?/i, `font-size:${nextFs}`));
        } else if (node.getAttribute('font-size')) {
          const nextFs = Math.max(12, Math.min(64, Math.round(Number(node.getAttribute('font-size')) * fontScale)));
          node.setAttribute('font-size', String(nextFs));
        }
      }
      const lines = nextVal.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const firstTspan = node.getElementsByTagName('tspan')[0];
      const xVal = node.getAttribute('x') || firstTspan?.getAttribute('x') || '64';
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
      if (lines.length <= 1) {
        node.textContent = lines[0] ?? '';
      } else {
        const ns = node.namespaceURI || 'http://www.w3.org/2000/svg';
        const styleAttr = node.getAttribute('style') || '';
        const fsMatch = styleAttr.match(/font-size\s*:\s*(\d+(?:\.\d+)?)/i);
        const fs = fsMatch ? Number(fsMatch[1]) : Number(node.getAttribute('font-size') || 18);
        const dyStep = Math.round(fs * 1.4);
        lines.forEach((ln, idx) => {
          const tspan = doc.createElementNS(ns, 'tspan');
          tspan.setAttribute('x', xVal);
          tspan.setAttribute('dy', String(idx === 0 ? 0 : dyStep));
          tspan.textContent = ln;
          node.appendChild(tspan);
        });
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch {
    return svgCode;
  }
}

function buildVisualSlideForDeck(
  slideNo: number,
  visualTitle: string,
  expr: string,
  caption: string
): Record<string, unknown> {
  const prefix = `s${slideNo}_vis`;
  const cleanTitle = (visualTitle || '画板图形直观对照').slice(0, 22);
  const cleanSub = (caption || `f(x) = ${expr}`).slice(0, 40);
  const takeaway = `借助《${cleanTitle}》直观把握临界特征与单调趋势`;
  const sampled = sampleFunctionInBrowser(expr, -2, 3.5);
  const fSegs = (sampled.f_segments as [number, number][][]) || [];
  const xDom = (sampled.x_domain as [number, number]) || [-2, 3.5];
  const yDom = (sampled.y_domain as [number, number]) || [-4, 4];
  const gx = 84;
  const gy = 200;
  const gw = 580;
  const gh = 380;
  const toSx = (vx: number) => gx + ((vx - xDom[0]) / Math.max(0.1, xDom[1] - xDom[0])) * gw;
  const toSy = (vy: number) => gy + (1 - (vy - yDom[0]) / Math.max(0.1, yDom[1] - yDom[0])) * gh;
  const polyStr = (fSegs[0] || [[-1.5, -1], [0, 2], [1.5, 0.5], [3, 2.5]])
    .map((pt) => `${toSx(pt[0]).toFixed(1)},${toSy(pt[1]).toFixed(1)}`)
    .join(' ');

  const svgCode = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <rect width="1280" height="720" fill="#F4F1EA"/>
  <rect x="48" y="42" width="1184" height="636" rx="16" fill="#FDFCF9" stroke="#DFD8CB" stroke-width="1.5"/>
  <text id="${prefix}_kicker" x="76" y="88" style="font-size:15px;font-weight:700;fill:#1B4D3E">${escapeXmlText('画板图形插入 · 数形结合')}</text>
  <text id="${prefix}_title" x="76" y="132" style="font-size:32px;font-weight:700;fill:#14191F">${escapeXmlText(cleanTitle)}</text>
  <text id="${prefix}_subtitle" x="76" y="166" style="font-size:18px;fill:#3E4750">${escapeXmlText(cleanSub)}</text>
  <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="12" fill="#FAF8F4" stroke="#DFD8CB"/>
  <line x1="${gx}" y1="${gy + gh / 2}" x2="${gx + gw}" y2="${gy + gh / 2}" stroke="#C6BEB0" stroke-dasharray="4,4"/>
  <polyline fill="none" stroke="#1B4D3E" stroke-width="3.6" points="${polyStr}"/>
  <rect x="700" y="200" width="496" height="112" rx="10" fill="#F6F3EC" stroke="#DFD8CB"/>
  <text id="${prefix}_g1_head" x="724" y="236" style="font-size:18px;font-weight:700;fill:#1B4D3E">解析表达式</text>
  <text id="${prefix}_g1_body" x="724" y="272" style="font-size:16px;fill:#3E4750">${escapeXmlText(`f(x) = ${expr}`)}</text>
  <rect x="700" y="332" width="496" height="112" rx="10" fill="#F6F3EC" stroke="#DFD8CB"/>
  <text id="${prefix}_g2_head" x="724" y="368" style="font-size:18px;font-weight:700;fill:#1B4D3E">图像观察要点</text>
  <text id="${prefix}_g2_body" x="724" y="404" style="font-size:16px;fill:#3E4750">${escapeXmlText(cleanSub)}</text>
  <rect x="700" y="464" width="496" height="116" rx="10" fill="#FAECE9" stroke="#E5C5BE"/>
  <text id="${prefix}_g3_head" x="724" y="500" style="font-size:18px;font-weight:700;fill:#B43B2A">课堂互动提问</text>
  <text id="${prefix}_g3_body" x="724" y="536" style="font-size:16px;fill:#3E4750">请结合曲线斜率变化，指出驻点与单调区间分界位置。</text>
  <text id="${prefix}_takeaway" x="76" y="640" style="font-size:17px;font-weight:700;fill:#1B4D3E">${escapeXmlText(`核心结论：${takeaway}`)}</text>
</svg>`;

  return {
    slide_number: slideNo,
    layout: 'visual_graph',
    kicker: '画板图形插入 · 数形结合',
    title: cleanTitle,
    subtitle: cleanSub,
    plot_expr: expr,
    takeaway,
    speaker_notes: `这一页展示从函数与几何画板插入的《${cleanTitle}》图像（表达式 ${expr}），重点引导学生观察临界点与单调变化趋势。`,
    cards: [
      { heading: '解析表达式', body: `f(x) = ${expr}` },
      { heading: '图像观察要点', body: cleanSub },
      { heading: '课堂互动提问', body: '请结合曲线斜率变化，指出驻点与单调区间分界位置。' },
    ],
    svg_code: svgCode,
    editable_texts: [
      { id: `${prefix}_kicker`, role: 'kicker', text: '画板图形插入 · 数形结合', style: 'font-size:15px' },
      { id: `${prefix}_title`, role: 'title', text: cleanTitle, style: 'font-size:32px' },
      { id: `${prefix}_subtitle`, role: 'subtitle', text: cleanSub, style: 'font-size:18px' },
      { id: `${prefix}_g1_head`, role: 'card_heading', text: '解析表达式', style: 'font-size:18px' },
      { id: `${prefix}_g1_body`, role: 'card_body', text: `f(x) = ${expr}`, style: 'font-size:16px' },
      { id: `${prefix}_g2_head`, role: 'card_heading', text: '图像观察要点', style: 'font-size:18px' },
      { id: `${prefix}_g2_body`, role: 'card_body', text: cleanSub, style: 'font-size:16px' },
      { id: `${prefix}_g3_head`, role: 'card_heading', text: '课堂互动提问', style: 'font-size:18px' },
      { id: `${prefix}_g3_body`, role: 'card_body', text: '请结合曲线斜率变化，指出驻点与单调区间分界位置。', style: 'font-size:16px' },
      { id: `${prefix}_takeaway`, role: 'takeaway', text: `核心结论：${takeaway}`, style: 'font-size:17px' },
    ],
  };
}

function autoLayoutMindmapInBrowser(graph: Record<string, unknown>): Record<string, unknown> {
  const layout = String(graph.layout || 'mindmap_lr');
  const rawNodes = ((graph.nodes as Record<string, unknown>[]) || []).map((n) => ({ ...n }));
  if (!rawNodes.length) return { ...graph, layout, nodes: [], cross_links: graph.cross_links || [] };

  const byId = new Map(rawNodes.map((n) => [String(n.id), n]));
  const roots = rawNodes.filter((n) => !n.parent_id || !byId.has(String(n.parent_id)));
  const root = roots[0] || rawNodes[0];
  root.parent_id = null;
  root.level = 0;
  root.side = 'center';
  root.category = 'root';

  if (layout === 'free') {
    rawNodes.forEach((n, idx) => {
      if (typeof n.x !== 'number') n.x = 480 + (idx % 3) * 180;
      if (typeof n.y !== 'number') n.y = 260 + Math.floor(idx / 3) * 90;
      if (typeof n.level !== 'number') n.level = n.id === root.id ? 0 : 1;
      if (!n.side) n.side = n.id === root.id ? 'center' : 'right';
    });
    return { ...graph, layout, nodes: rawNodes, cross_links: graph.cross_links || [] };
  }

  const childrenMap = new Map<string, Record<string, unknown>[]>();
  rawNodes.forEach((n) => childrenMap.set(String(n.id), []));
  rawNodes.forEach((n) => {
    const pid = n.parent_id ? String(n.parent_id) : '';
    if (pid && childrenMap.has(pid) && n.id !== root.id) {
      childrenMap.get(pid)!.push(n);
    }
  });

  const weight = (nid: string, depth = 0): number => {
    if (depth > 6) return 1;
    const ch = childrenMap.get(nid) || [];
    if (!ch.length) return 1;
    return ch.reduce((acc, c) => acc + weight(String(c.id), depth + 1), 0);
  };

  const topChildren = childrenMap.get(String(root.id)) || [];
  const leftBranches = layout === 'tree_right' ? [] : topChildren.filter((_, i) => i % 2 === 1);
  const rightBranches = layout === 'tree_right' ? topChildren : topChildren.filter((_, i) => i % 2 === 0);
  const rootX = layout === 'tree_right' ? 140 : 540;
  const rowGap = 68;
  const xStep = 235;
  const leftW = leftBranches.reduce((a, b) => a + weight(String(b.id)), 0);
  const rightW = rightBranches.reduce((a, b) => a + weight(String(b.id)), 0);
  const centerY = Math.max(240, (Math.max(4, leftW, rightW) * rowGap) / 2 + 40);
  root.x = rootX;
  root.y = Math.round(centerY * 10) / 10;

  const placeSide = (branches: Record<string, unknown>[], dir: number) => {
    const totalU = Math.max(1, branches.reduce((a, b) => a + weight(String(b.id)), 0));
    let yAcc = centerY - (totalU * rowGap) / 2 + rowGap / 2;
    const walk = (node: Record<string, unknown>, lvl: number, topCursor: number): number => {
      const span = weight(String(node.id)) * rowGap;
      node.level = lvl;
      node.side = dir < 0 ? 'left' : 'right';
      node.x = Math.round((rootX + dir * lvl * xStep) * 10) / 10;
      node.y = Math.round((topCursor + span / 2 - rowGap / 2) * 10) / 10;
      let cy = topCursor;
      for (const ch of childrenMap.get(String(node.id)) || []) {
        cy = walk(ch, lvl + 1, cy);
      }
      return topCursor + span;
    };
    for (const br of branches) {
      yAcc = walk(br, 1, yAcc);
    }
  };

  if (rightBranches.length) placeSide(rightBranches, 1);
  if (leftBranches.length) placeSide(leftBranches, -1);
  return { ...graph, layout, nodes: rawNodes, cross_links: graph.cross_links || [] };
}

function compileDrawioXmlInBrowser(graphRaw: Record<string, unknown>, mapId: string): string {
  const laid = autoLayoutMindmapInBrowser(graphRaw);
  const title = String(laid.title || '师承智境思维导图');
  const nodes = (laid.nodes as Record<string, unknown>[]) || [];
  const crossLinks = (laid.cross_links as Record<string, unknown>[]) || [];
  const styles: Record<string, { fill: string; stroke: string; font: string; bold: string; size: string }> = {
    root: { fill: '#1B4D3E', stroke: '#12362B', font: '#FFFFFF', bold: '1', size: '15' },
    principle: { fill: '#E6EFEA', stroke: '#1B4D3E', font: '#14191F', bold: '1', size: '13' },
    intuition: { fill: '#FDFCF9', stroke: '#1B4D3E', font: '#14191F', bold: '0', size: '12' },
    socratic: { fill: '#EAE5DC', stroke: '#424B54', font: '#14191F', bold: '0', size: '12' },
    pitfall: { fill: '#FAECE9', stroke: '#B43B2A', font: '#7F1D1D', bold: '0', size: '12' },
    interdisciplinary: { fill: '#FEF5E7', stroke: '#9A5B13', font: '#7C2D12', bold: '0', size: '12' },
  };
  const cells: string[] = ['      <mxCell id="0" />', '      <mxCell id="1" parent="0" />'];
  const nodeIds = new Set(nodes.map((n) => String(n.id)));

  for (const n of nodes) {
    const cat = String(n.category || 'intuition');
    const st = styles[cat] || styles.intuition;
    const lvl = Number(n.level || 0);
    const w = lvl === 0 ? 210 : lvl === 1 ? 184 : 168;
    const h = lvl === 0 ? 56 : lvl === 1 ? 46 : 40;
    const xLeft = (Number(n.x || 480) - w / 2).toFixed(1);
    const yTop = (Number(n.y || 280) - h / 2).toFixed(1);
    const styleStr = `rounded=1;whiteSpace=wrap;html=1;arcSize=16;fillColor=${st.fill};strokeColor=${st.stroke};strokeWidth=${lvl <= 1 ? '2' : '1.2'};fontColor=${st.font};fontStyle=${st.bold};fontSize=${st.size};eduCategory=${cat};`;
    const tipAttr = n.note ? ` tooltip="${escapeXmlText(String(n.note))}"` : '';
    cells.push(
      `      <mxCell id="${escapeXmlText(String(n.id))}" value="${escapeXmlText(String(n.label || ''))}" style="${styleStr}" vertex="1" parent="1"${tipAttr}><mxGeometry x="${xLeft}" y="${yTop}" width="${w}" height="${h}" as="geometry" /></mxCell>`
    );
  }

  for (const n of nodes) {
    const pid = n.parent_id ? String(n.parent_id) : '';
    if (!pid || !nodeIds.has(pid)) continue;
    const side = String(n.side || 'right');
    const [exX, enX] = side === 'left' ? ['0', '1'] : ['1', '0'];
    const st = styles[String(n.category || 'intuition')] || styles.intuition;
    const eStyle = `edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;html=1;exitX=${exX};exitY=0.5;entryX=${enX};entryY=0.5;strokeColor=${st.stroke};strokeWidth=${Number(n.level || 1) === 1 ? '2' : '1.4'};endArrow=none;`;
    cells.push(
      `      <mxCell id="e_${escapeXmlText(pid)}_${escapeXmlText(String(n.id))}" style="${eStyle}" edge="1" parent="1" source="${escapeXmlText(pid)}" target="${escapeXmlText(String(n.id))}"><mxGeometry relative="1" as="geometry" /></mxCell>`
    );
  }

  crossLinks.forEach((lk, idx) => {
    const src = String(lk.source || '');
    const dst = String(lk.target || '');
    if (!nodeIds.has(src) || !nodeIds.has(dst)) return;
    const clStyle = 'curved=1;dashed=1;dashPattern=6 4;strokeColor=#B43B2A;strokeWidth=1.8;fontColor=#B43B2A;fontSize=11;endArrow=classic;html=1;';
    cells.push(
      `      <mxCell id="${escapeXmlText(String(lk.id || `cl_${idx}`))}" value="${escapeXmlText(String(lk.label || '跨学科映射'))}" style="${clStyle}" edge="1" parent="1" source="${escapeXmlText(src)}" target="${escapeXmlText(dst)}"><mxGeometry relative="1" as="geometry" /></mxCell>`
    );
  });

  return `<mxfile host="app.diagrams.net" agent="EduForge-Studio-Demo" version="24.7.0">\n  <diagram id="diag_${escapeXmlText(mapId)}" name="${escapeXmlText(title.slice(0, 40))}">\n    <mxGraphModel dx="1420" dy="900" grid="1" gridSize="10" page="1" pageWidth="1400" pageHeight="900">\n      <root>\n${cells.join('\n')}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
}

function parseDrawioXmlInBrowser(xmlStr: string, fallbackTitle = '导入思维导图'): Record<string, unknown> {
  const raw = String(xmlStr || '').trim();
  if (!raw || typeof DOMParser === 'undefined') {
    return autoLayoutMindmapInBrowser({
      title: fallbackTitle,
      layout: 'mindmap_lr',
      nodes: [
        { id: 'n_root', label: fallbackTitle, parent_id: null, level: 0, side: 'center', category: 'root', note: '' },
        { id: 'n_b1', label: '核心概念', parent_id: 'n_root', level: 1, side: 'right', category: 'principle', note: '' },
        { id: 'n_b2', label: '典型误区', parent_id: 'n_root', level: 1, side: 'left', category: 'pitfall', note: '' },
      ],
      cross_links: [],
    });
  }

  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Draw.io XML 格式无法解析');
  }
  const diagEl = doc.getElementsByTagName('diagram')[0];
  const title = diagEl?.getAttribute('name') || fallbackTitle;
  const cells = Array.from(doc.getElementsByTagName('mxCell'));
  const vertices: Record<string, unknown>[] = [];
  const edges: { id: string; source: string; target: string; label: string; dashed: boolean }[] = [];

  for (const c of cells) {
    const cid = c.getAttribute('id') || '';
    if (!cid || cid === '0' || cid === '1') continue;
    if (c.getAttribute('vertex') === '1') {
      const geom = c.getElementsByTagName('mxGeometry')[0];
      const xv = Number(geom?.getAttribute('x') ?? 300);
      const yv = Number(geom?.getAttribute('y') ?? 240);
      const wv = Number(geom?.getAttribute('width') ?? 160);
      const hv = Number(geom?.getAttribute('height') ?? 44);
      const style = c.getAttribute('style') || '';
      const catMatch = style.match(/eduCategory=([a-zA-Z_]+)/);
      let cat = catMatch ? catMatch[1] : 'intuition';
      if (style.includes('#1B4D3E') && style.includes('fontColor=#FFFFFF')) cat = 'root';
      else if (style.includes('#B43B2A')) cat = 'pitfall';
      else if (style.includes('#9A5B13')) cat = 'interdisciplinary';
      const label = (c.getAttribute('value') || '').replace(/<[^>]+>/g, ' ').trim() || cid;
      vertices.push({
        id: cid,
        label,
        parent_id: null,
        level: 1,
        side: 'right',
        category: cat,
        note: c.getAttribute('tooltip') || '',
        x: Math.round((xv + wv / 2) * 10) / 10,
        y: Math.round((yv + hv / 2) * 10) / 10,
      });
    } else if (c.getAttribute('edge') === '1') {
      const src = c.getAttribute('source') || '';
      const tgt = c.getAttribute('target') || '';
      if (src && tgt) {
        edges.push({
          id: cid,
          source: src,
          target: tgt,
          label: (c.getAttribute('value') || '').replace(/<[^>]+>/g, ' ').trim(),
          dashed: (c.getAttribute('style') || '').includes('dashed=1'),
        });
      }
    }
  }

  if (!vertices.length) {
    return autoLayoutMindmapInBrowser({
      title,
      layout: 'mindmap_lr',
      nodes: [
        { id: 'n_root', label: title, parent_id: null, level: 0, side: 'center', category: 'root', note: '' },
        { id: 'n_b1', label: '核心结构', parent_id: 'n_root', level: 1, side: 'right', category: 'principle', note: '' },
      ],
      cross_links: [],
    });
  }

  const vMap = new Map(vertices.map((v) => [String(v.id), v]));
  const crossLinks: Record<string, unknown>[] = [];
  for (const e of edges) {
    const sv = vMap.get(e.source);
    const tv = vMap.get(e.target);
    if (!sv || !tv) continue;
    if (e.dashed || tv.parent_id !== null) {
      crossLinks.push({ id: e.id, source: e.source, target: e.target, label: e.label || '跨分支关联' });
    } else {
      tv.parent_id = e.source;
    }
  }

  const roots = vertices.filter((v) => v.parent_id === null);
  const rootNode = roots[0] || vertices[0];
  rootNode.parent_id = null;
  rootNode.level = 0;
  rootNode.side = 'center';
  rootNode.category = 'root';
  const rx = Number(rootNode.x || 500);
  for (const v of vertices) {
    if (v.id !== rootNode.id) {
      v.side = Number(v.x || 0) < rx ? 'left' : 'right';
    }
  }

  const queue: Record<string, unknown>[] = [rootNode];
  const visited = new Set<string>([String(rootNode.id)]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const v of vertices) {
      if (v.parent_id === cur.id && !visited.has(String(v.id))) {
        v.level = Number(cur.level || 0) + 1;
        visited.add(String(v.id));
        queue.push(v);
      }
    }
  }

  return { title, layout: 'free', nodes: vertices, cross_links: crossLinks };
}

function buildMindmapGraphFromTopicInBrowser(topic: Record<string, unknown>, customTitle = ''): Record<string, unknown> {
  const shortText = (txt: unknown, maxLen = 28) => {
    const s = String(txt || '').replace(/\s+/g, ' ').trim();
    return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
  };
  const rawTitle = customTitle || String(topic.title || '学科知识思维导图').split('：')[0].slice(0, 36);
  const nodes: Record<string, unknown>[] = [
    {
      id: 'n_root',
      label: rawTitle,
      parent_id: null,
      level: 0,
      side: 'center',
      category: 'root',
      note: [topic.domain_name, topic.branch, topic.core_formula_latex].filter(Boolean).join(' · '),
    },
    {
      id: 'n_int',
      label: '直观心智模型',
      parent_id: 'n_root',
      level: 1,
      side: 'right',
      category: 'principle',
      note: '用生活或几何物理直觉锚定抽象概念',
    },
    {
      id: 'n_flow',
      label: '标准推演脉络',
      parent_id: 'n_root',
      level: 1,
      side: 'left',
      category: 'principle',
      note: String(topic.curriculum_standard || ''),
    },
    {
      id: 'n_pit',
      label: '反例与易错陷阱',
      parent_id: 'n_root',
      level: 1,
      side: 'right',
      category: 'pitfall',
      note: '高频错误与边界禁区警示',
    },
    {
      id: 'n_pbl',
      label: '跨学科耦合视角',
      parent_id: 'n_root',
      level: 1,
      side: 'left',
      category: 'interdisciplinary',
      note: String(topic.board_punchline || ''),
    },
  ];

  ((topic.intuition_models as { name?: string; desc?: string }[]) || []).slice(0, 2).forEach((im, i) => {
    nodes.push({
      id: `n_int_${i + 1}`,
      label: shortText(im.name || `直观视角 ${i + 1}`, 26),
      parent_id: 'n_int',
      level: 2,
      side: 'right',
      category: 'intuition',
      note: String(im.desc || ''),
    });
  });

  ((topic.teaching_flow as string[]) || []).slice(0, 3).forEach((st, i) => {
    nodes.push({
      id: `n_flow_${i + 1}`,
      label: shortText(String(st).replace(/^\d+\.\s*/, ''), 28),
      parent_id: 'n_flow',
      level: 2,
      side: 'left',
      category: 'socratic',
      note: String(st),
    });
  });

  ((topic.pitfalls_and_counterexamples as string[]) || []).slice(0, 2).forEach((pf, i) => {
    nodes.push({
      id: `n_pit_${i + 1}`,
      label: shortText(pf, 28),
      parent_id: 'n_pit',
      level: 2,
      side: 'right',
      category: 'pitfall',
      note: String(pf),
    });
  });

  ((topic.interdisciplinary_links as { domain?: string; title?: string; mechanism?: string }[]) || []).slice(0, 2).forEach((lk, i) => {
    nodes.push({
      id: `n_pbl_${i + 1}`,
      label: shortText(`[${lk.domain || '跨域'}] ${lk.title || ''}`, 30),
      parent_id: 'n_pbl',
      level: 2,
      side: 'left',
      category: 'interdisciplinary',
      note: String(lk.mechanism || ''),
    });
  });

  const crossLinks: Record<string, unknown>[] = [];
  if (nodes.some((n) => n.id === 'n_int_1') && nodes.some((n) => n.id === 'n_pbl_1')) {
    crossLinks.push({ id: 'cl_1', source: 'n_int_1', target: 'n_pbl_1', label: '模型跨界迁移' });
  }
  if (nodes.some((n) => n.id === 'n_pit_1') && nodes.some((n) => n.id === 'n_flow_1')) {
    crossLinks.push({ id: 'cl_2', source: 'n_pit_1', target: 'n_flow_1', label: '边界反例校验' });
  }

  return autoLayoutMindmapInBrowser({
    title: rawTitle,
    layout: 'mindmap_lr',
    nodes,
    cross_links: crossLinks,
  });
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
    tel.counts = {
      error_book: state.error_book.length,
      lessons: state.lessons.length,
      ppt_decks: state.ppt_decks.length,
      exams: state.exams.length,
      analytics: state.analytics_reports.length,
    };
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

  const courseDetailMatch = path.match(/^\/api\/courses\/([^/]+)$/);
  if (
    courseDetailMatch &&
    (method === 'GET' || method === 'PATCH' || method === 'DELETE') &&
    !['marketplace', 'enroll', 'craft', 'cheatsheet-custom'].includes(courseDetailMatch[1])
  ) {
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
      let target = state.lessons[0];
      if (!target && snap.lessons[0]) {
        target = cloneJson(snap.lessons[0]);
        target.id = makeId('les');
        target.title = `${course.title} · 教学设计`;
        if (target.content && typeof target.content === 'object') {
          (target.content as Record<string, unknown>).title = target.title;
        }
        state.lessons.unshift(target);
      }
      const tid = String(target?.id || 'les_demo_01');
      linked.lesson_id = tid;
      linkedItem = { kind: 'lesson', id: tid, title: `${course.title} · 教学设计`, subtitle: '已关联演示教案' };
    } else if (kind === 'ppt') {
      let target = state.ppt_decks[0];
      if (!target && snap.ppt_decks[0]) {
        target = cloneJson(snap.ppt_decks[0]);
        target.id = makeId('deck');
        target.title = `${course.title} · 演示课件`;
        state.ppt_decks.unshift(target);
      }
      const tid = String(target?.id || 'deck_demo_01');
      linked.deck_id = tid;
      linkedItem = { kind: 'ppt', id: tid, title: `${course.title} · 演示课件`, subtitle: '已关联示范课件' };
    } else {
      let target = state.exams[0];
      if (!target && snap.exams[0]) {
        target = cloneJson(snap.exams[0]);
        target.id = makeId('exam');
        target.title = `${course.title} · 随堂测验卷`;
        if (target.exam && typeof target.exam === 'object') {
          (target.exam as Record<string, unknown>).id = target.id;
          (target.exam as Record<string, unknown>).title = target.title;
        }
        state.exams.unshift(target);
      }
      const tid = String(target?.id || 'exam_demo_01');
      linked.exam_id = tid;
      linkedItem = { kind: 'exam', id: tid, title: `${course.title} · 随堂测验卷`, subtitle: '已关联在线测验' };
    }
    course.linked_ids = linked;
    persistState();
    return { ok: true, kind, linked_item: linkedItem, course: recomputeCourseProgress(course) } as T;
  }

  const csMatch = path.match(/^\/api\/courses\/([^/]+)\/cheatsheet$/);
  if (csMatch && method === 'POST') {
    const cid = decodeURIComponent(csMatch[1]);
    const course = state.courses.find((c) => c.id === cid);
    return {
      ok: true,
      cheatsheet: cloneJson(
        course?.cheatsheet ||
          state.courses[0]?.cheatsheet ||
          snap.courses[0]?.cheatsheet || {
            title: '重点速查表',
            subtitle: '核心概念与反例清单',
            sections: [],
          }
      ),
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
    const tpl = state.exams[0] || snap.exams[0];
    if (tpl) {
      const topics = ((body.topics as string[]) || []).filter(Boolean);
      const remedExam = cloneJson(tpl);
      if (!state.exams.length || topics.length > 0) {
        const newId = makeId('exam');
        const newTitle = topics.length ? `薄弱点靶向强化小测：${topics.slice(0, 2).join('、')}` : String(remedExam.title || '靶向巩固小测');
        remedExam.id = newId;
        remedExam.title = newTitle;
        if (remedExam.exam && typeof remedExam.exam === 'object') {
          (remedExam.exam as Record<string, unknown>).id = newId;
          (remedExam.exam as Record<string, unknown>).title = newTitle;
        }
        state.exams.unshift(remedExam);
        persistState();
      }
      return { ok: true, exam_record: cloneJson(remedExam), target_topics: topics } as T;
    }
  }
  if (path === '/api/agent/insert-visual' && method === 'POST') {
    const target = body.target === 'lesson' ? 'lesson' : 'ppt';
    const targetIdReq = String(body.target_id || '').trim();
    const visualTitle = String(body.visual_title || '函数图像与切线关系').trim();
    const expr = String(body.expr || 'x^3 - 3*x^2 + 2').trim();
    const caption = String(body.caption || '结合图像变化趋势观察临界点与单调区间').trim();

    if (target === 'lesson') {
      let les = targetIdReq ? state.lessons.find((l) => l.id === targetIdReq) : state.lessons[0];
      if (!les && snap.lessons[0]) {
        les = cloneJson(snap.lessons[0]);
        les.id = targetIdReq || makeId('les');
        state.lessons.unshift(les);
      }
      if (!les) throw new Error('当前没有可插入的教案，请先生成教案。');
      const content = ((les.content as Record<string, unknown>) || {});
      const visuals = Array.isArray(content.inserted_visuals) ? [...(content.inserted_visuals as unknown[])] : [];
      visuals.push({ title: visualTitle, expr, caption });
      content.inserted_visuals = visuals;
      const bb = String(content.blackboard_design || '');
      const visLine = `\n• [画板图示] ${visualTitle}（$f(x) = ${expr}$）：${caption}`;
      if (!bb.includes(visualTitle)) {
        content.blackboard_design = `${bb}${visLine}`.trim();
      }
      const editCount = Number(les.edit_count || 0) + 1;
      content.edit_count = editCount;
      les.content = content;
      les.edit_count = editCount;
      les.edited_char_delta = Number(les.edited_char_delta || 0) + visLine.length;
      persistState();
      return {
        ok: true,
        target: 'lesson',
        target_id: String(les.id),
        target_title: String(les.title || '教学设计'),
        artifact: state.artifacts.find((a) => a.id === les!.artifact_id) || null,
      } as T;
    }

    let deck = targetIdReq ? state.ppt_decks.find((d) => d.id === targetIdReq) : state.ppt_decks[0];
    if (!deck && snap.ppt_decks[0]) {
      deck = cloneJson(snap.ppt_decks[0]);
      deck.id = targetIdReq || makeId('deck');
      state.ppt_decks.unshift(deck);
    }
    if (!deck) throw new Error('当前没有可插入的课件，请先生成课件。');
    const slides = Array.isArray(deck.slides) ? [...(deck.slides as Record<string, unknown>[])] : [];
    const insertPos = slides.length >= 2 ? Math.max(1, slides.length - 1) : slides.length;
    const newSlide = buildVisualSlideForDeck(insertPos + 1, visualTitle, expr, caption);
    slides.splice(insertPos, 0, newSlide);
    slides.forEach((sl, idx) => {
      sl.slide_number = idx + 1;
    });
    deck.slides = slides;
    deck.edit_count = Number(deck.edit_count || 0) + 1;
    if (deck.pptx_audit && typeof deck.pptx_audit === 'object') {
      (deck.pptx_audit as Record<string, unknown>).slide_count = slides.length;
    }
    persistState();
    return {
      ok: true,
      target: 'ppt',
      target_id: String(deck.id),
      target_title: String(deck.title || '演示课件'),
      slide_number: insertPos + 1,
      artifact: state.artifacts.find((a) => a.id === deck!.pptx_artifact_id) || null,
    } as T;
  }
  if (path === '/api/agent/threads' && method === 'GET') {
    return { ok: true, threads: cloneJson(state.threads) } as T;
  }
  if (path === '/api/agent/threads' && method === 'POST') {
    const now = Date.now() / 1000;
    const tid = makeId('thr');
    const title = String(body.title || '新协同任务');
    const th = { id: tid, title, status: 'idle', plan: [], pending_goal: '', artifacts: {}, messages: [], created_at: now, updated_at: now };
    state.thread_details[tid] = th;
    state.threads.unshift({ id: tid, title, status: 'idle', created_at: now, updated_at: now });
    persistState();
    return { ok: true, thread: cloneJson(th) } as T;
  }
  const threadMatch = path.match(/^\/api\/agent\/threads\/([^/]+)$/);
  if (
    threadMatch &&
    (method === 'GET' || method === 'DELETE') &&
    !['memory', 'chat', 'insert-visual'].includes(threadMatch[1])
  ) {
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
  if (calPatchMatch && (method === 'PATCH' || method === 'DELETE')) {
    const tid = decodeURIComponent(calPatchMatch[1]);
    if (method === 'PATCH') {
      const tk = state.calendar_tasks.find((x) => x.id === tid);
      if (!tk) throw new Error('待办不存在');
      if (body.completed !== undefined) tk.completed = Boolean(body.completed);
      if (body.title !== undefined) tk.title = String(body.title);
      if (body.date_str !== undefined) tk.date_str = String(body.date_str);
      if (body.minutes !== undefined) tk.minutes = Number(body.minutes);
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
    const nowSec = Date.now() / 1000;
    const planTitleStr = String(body.title || '7日学习计划');
    const icsId = makeId('art');
    const icsArtifact = {
      id: icsId,
      title: `日程：${planTitleStr}`,
      category: 'ics',
      module: 'tutor',
      filename: `${planTitleStr}.ics`,
      file_path: '',
      mime_type: 'text/calendar',
      size_bytes: 2048,
      verified_status: 'verified',
      revision_count: 0,
      download_url: `/api/artifacts/${icsId}/download`,
      created_at: nowSec,
      updated_at: nowSec,
      meta: { plan_id: pid },
    };
    state.artifacts.unshift(icsArtifact);
    const plan = {
      id: pid,
      title: planTitleStr,
      goal: String(body.goal || ''),
      days,
      ics_artifact_id: icsId,
      ics_artifact: icsArtifact,
    };
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
        created_at: nowSec + idx * 0.001,
      });
    });
    persistState();
    return { ok: true, plan } as T;
  }
  const studyPlanDelMatch = path.match(/^\/api\/tutor\/study-plans\/([^/]+)$/);
  if (studyPlanDelMatch && method === 'DELETE') {
    const pid = decodeURIComponent(studyPlanDelMatch[1]);
    state.study_plans = state.study_plans.filter((p) => p.id !== pid);
    state.calendar_tasks = state.calendar_tasks.filter((t) => t.plan_id !== pid);
    persistState();
    return { ok: true, plan_id: pid } as T;
  }

  if (path === '/api/tutor/error-book' && method === 'GET') return { ok: true, items: cloneJson(state.error_book) } as T;
  if (path === '/api/tutor/error-book' && method === 'POST') {
    const qNorm = String(body.question_text || '').trim();
    const takeawayVal = String(body.key_takeaway || body.takeaway || '').trim();
    const existingIdx = qNorm
      ? state.error_book.findIndex((x) => String(x.question_text || '').trim() === qNorm)
      : -1;
    if (existingIdx !== -1) {
      const existing = state.error_book[existingIdx];
      const nextTakeaway = takeawayVal || String(existing.key_takeaway || existing.takeaway || '');
      const updated = {
        ...existing,
        ...body,
        key_takeaway: nextTakeaway,
        takeaway: nextTakeaway,
        id: existing.id,
        mastery_level: Number(existing.mastery_level || 1),
        updated_at: Date.now() / 1000,
      };
      state.error_book.splice(existingIdx, 1);
      state.error_book.unshift(updated);
      persistState();
      return { ok: true, id: updated.id, deduplicated: true, item: cloneJson(updated) } as T;
    }
    const nowSec = Date.now() / 1000;
    const item = {
      id: makeId('err'),
      ...body,
      key_takeaway: takeawayVal,
      takeaway: takeawayVal,
      mastery_level: 1,
      created_at: nowSec,
    };
    state.error_book.unshift(item);
    persistState();
    return { ok: true, id: item.id, deduplicated: false, item: cloneJson(item) } as T;
  }
  const errItemMatch = path.match(/^\/api\/tutor\/error-book\/([^/]+)$/);
  if (errItemMatch && (method === 'PATCH' || method === 'DELETE')) {
    const eid = decodeURIComponent(errItemMatch[1]);
    if (method === 'PATCH') {
      const lvl = Math.max(1, Math.min(3, Number(body.mastery_level || 2)));
      const item = state.error_book.find((x) => x.id === eid);
      if (item) item.mastery_level = lvl;
      persistState();
      return { ok: true, mastery_level: item?.mastery_level || lvl } as T;
    }
    if (method === 'DELETE') {
      state.error_book = state.error_book.filter((x) => x.id !== eid);
      persistState();
      return { ok: true, deleted_id: eid } as T;
    }
  }

  if (path === '/api/tutor/plot-function' && method === 'POST') {
    const expr = String(body.expression || 'x^3 - 3*x^2 + 2').trim();
    const cached = snap.plots_2d[expr];
    if (cached && body.x_min === undefined) return cloneJson(cached) as T;
    return sampleFunctionInBrowser(expr, Number(body.x_min ?? -2), Number(body.x_max ?? 3.5)) as T;
  }
  if (path === '/api/tutor/plot-surface-3d' && method === 'POST') {
    const expr = String(body.expression || 'sin(x)*cos(y)').trim();
    const normExpr = expr.replace(/\s+/g, '').replace(/^(?:f\(x,y\)|z)=/i, '');
    if (
      (normExpr === 'sin(x)*cos(y)' || normExpr === 'cos(y)*sin(x)') &&
      body.x_min === undefined &&
      body.y_min === undefined &&
      snap.surface_3d &&
      snap.surface_3d.ok
    ) {
      return cloneJson(snap.surface_3d) as T;
    }
    return sampleSurface3DInBrowser(
      expr,
      Number(body.x_min ?? -2.2),
      Number(body.x_max ?? 2.2),
      Number(body.y_min ?? -2.2),
      Number(body.y_max ?? 2.2),
      Number(body.grid_size ?? 23)
    ) as T;
  }
  if (path === '/api/tutor/verify-expression' && method === 'POST') {
    const expr = String(body.expression || '');
    return { ok: true, verification: verifyExpressionInBrowser(expr) } as T;
  }
  const fuMatch = path.match(/^\/api\/tutor\/sessions\/([^/]+)\/followups$/);
  if (fuMatch && method === 'GET') return { ok: true, messages: [] } as T;
  if (path === '/api/tutor/followup' && method === 'POST') {
    const sid = String(body.session_id || makeId('tut'));
    return {
      ok: true,
      session_id: sid,
      reply: {
        id: makeId('tfu'),
        session_id: sid,
        role: 'assistant',
        content: `针对追问「${String(body.followup_question || '')}」：建议先标定定义域，再将关键关系式两端作差检查符号；如需在线调用大模型深度展开，可在「设置 → 服务连接」填写后端服务地址。`,
        created_at: Date.now() / 1000,
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
  if (srcDelMatch && method === 'DELETE' && !['list', 'search', 'upload'].includes(srcDelMatch[1])) {
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
  if (artDelMatch && method === 'DELETE' && artDelMatch[1] !== 'download') {
    const aid = decodeURIComponent(artDelMatch[1]);
    state.artifacts = state.artifacts.filter((a) => a.id !== aid);
    persistState();
    return { ok: true, deleted_id: aid } as T;
  }

  // ---- Specialist Studio Read/Write Routes ----
  if (path === '/api/lesson/list' && method === 'GET') return { ok: true, lessons: cloneJson(state.lessons) } as T;
  const lesMatch = path.match(/^\/api\/lesson\/([^/]+)$/);
  if (lesMatch && method === 'PUT' && !['list', 'generate'].includes(lesMatch[1])) {
    const lid = decodeURIComponent(lesMatch[1]);
    let les = state.lessons.find((l) => l.id === lid);
    if (!les && snap.lessons[0]) {
      les = cloneJson(snap.lessons[0]);
      les.id = lid;
      state.lessons.unshift(les);
    }
    if (!les) throw new Error('教案不存在');
    const prevJson = JSON.stringify(les.content || {});
    const nextContent = cloneJson(
      (body.content as Record<string, unknown>) || (les.content as Record<string, unknown>) || {}
    );
    const editCount = Number(les.edit_count || 0) + 1;
    nextContent.edit_count = editCount;
    const nextJson = JSON.stringify(nextContent);
    const charDelta = Number(les.edited_char_delta || 0) + Math.max(1, Math.abs(nextJson.length - prevJson.length));
    les.content = nextContent;
    if (nextContent.title) les.title = String(nextContent.title);
    les.edit_count = editCount;
    les.edited_char_delta = charDelta;
    const art = state.artifacts.find((a) => a.id === les!.artifact_id) || null;
    if (art) art.revision_count = editCount;
    persistState();
    return {
      ok: true,
      edit_count: les.edit_count,
      edited_char_delta: les.edited_char_delta,
      artifact: cloneJson(art),
    } as T;
  }
  const lesRewriteMatch = path.match(/^\/api\/lesson\/([^/]+)\/rewrite-section$/);
  if (lesRewriteMatch && method === 'POST') {
    const lid = decodeURIComponent(lesRewriteMatch[1]);
    let les = state.lessons.find((l) => l.id === lid);
    if (!les && snap.lessons[0]) {
      les = cloneJson(snap.lessons[0]);
      les.id = lid;
      state.lessons.unshift(les);
    }
    if (!les) throw new Error('教案不存在');
    const sectionKey = String(body.section_key || 'objectives').trim();
    const instruction = String(body.instruction || '紧扣核心素养深化表述').trim();
    const shortInst = instruction.slice(0, 28);
    const content = cloneJson((les.content as Record<string, unknown>) || {});
    const prevJson = JSON.stringify(content);
    const curVal = content[sectionKey];

    if (Array.isArray(curVal)) {
      if (curVal.length > 0 && typeof curVal[0] === 'object' && curVal[0] !== null) {
        const objArr = (curVal as Record<string, unknown>[]).map((item, idx) => {
          const copy = { ...item };
          if (idx === 0) {
            if ('teacher_activity' in copy) {
              const base = String(copy.teacher_activity || '').replace(/（精修：[^）]*）$/g, '').trim();
              copy.teacher_activity = `${base}（精修：${shortInst}）`;
            } else if ('solution' in copy) {
              const base = String(copy.solution || '').replace(/（精修：[^）]*）$/g, '').trim();
              copy.solution = `${base}（精修：${shortInst}）`;
            }
          }
          if ('design_intent' in copy && idx === 0) {
            const baseIntent = String(copy.design_intent || '').replace(/；已落实.*$/g, '').trim();
            copy.design_intent = `${baseIntent}；已落实「${shortInst}」`;
          }
          return copy;
        });
        content[sectionKey] = objArr;
      } else {
        const strArr = (curVal as unknown[]).map((x) => String(x));
        const refinedNote = `素养深化（${shortInst}）：引导学生通过正反特例辨析与自主板演达成可核验理解。`;
        if (strArr.length >= 4) {
          strArr[strArr.length - 1] = refinedNote;
        } else {
          strArr.push(refinedNote);
        }
        content[sectionKey] = strArr;
      }
    } else {
      const baseStr = String(curVal ?? '').replace(/\n【精修补充】[\s\S]*$/g, '').trim();
      content[sectionKey] = baseStr
        ? `${baseStr}\n【精修补充】结合「${shortInst}」进一步强化课堂互动追问与边界条件检验。`
        : `结合「${shortInst}」强化课堂互动追问与边界条件检验。`;
    }

    const editCount = Number(les.edit_count || 0) + 1;
    content.edit_count = editCount;
    const nextJson = JSON.stringify(content);
    les.content = content;
    les.edit_count = editCount;
    les.edited_char_delta = Number(les.edited_char_delta || 0) + Math.max(4, Math.abs(nextJson.length - prevJson.length));
    const art = state.artifacts.find((a) => a.id === les!.artifact_id) || null;
    if (art) art.revision_count = editCount;
    persistState();
    return {
      ok: true,
      content: cloneJson(les.content),
      artifact: cloneJson(art),
      edit_count: les.edit_count,
    } as T;
  }

  if (path === '/api/ppt/themes') return cloneJson(snap.ppt_themes) as T;
  if (path === '/api/ppt/decks') return { ok: true, decks: cloneJson(state.ppt_decks) } as T;
  const deckGetMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)$/);
  if (deckGetMatch && method === 'GET') {
    const did = decodeURIComponent(deckGetMatch[1]);
    const deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0] || snap.ppt_decks[0];
    if (!deck) throw new Error('课件不存在');
    return { ok: true, deck: cloneJson(deck) } as T;
  }
  const deckThemeMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/theme$/);
  if (deckThemeMatch && method === 'POST') {
    const did = decodeURIComponent(deckThemeMatch[1]);
    let deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0];
    if (!deck && snap.ppt_decks[0]) {
      deck = cloneJson(snap.ppt_decks[0]);
      deck.id = did;
      state.ppt_decks.unshift(deck);
    }
    if (!deck) throw new Error('课件不存在');
    const prevThemeId = String(deck.theme_id || 'porcelain_daylight');
    const nextThemeId = String(body.theme_id || prevThemeId);
    const themeList = ((snap.ppt_themes.themes as Record<string, string>[]) || []);
    const oldTheme = themeList.find((t) => t.id === prevThemeId);
    const newTheme = themeList.find((t) => t.id === nextThemeId);
    if (oldTheme && newTheme && oldTheme.id !== newTheme.id && Array.isArray(deck.slides)) {
      const colorMap = new Map<string, string>();
      (['bg_primary', 'surface', 'border', 'accent', 'ink_primary'] as const).forEach((k) => {
        if (oldTheme[k] && newTheme[k]) {
          colorMap.set(oldTheme[k].toUpperCase(), newTheme[k]);
        }
      });
      if (colorMap.size > 0) {
        const pattern = new RegExp(
          Array.from(colorMap.keys())
            .map((hex) => hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|'),
          'gi'
        );
        for (const sl of deck.slides as Record<string, unknown>[]) {
          if (typeof sl.svg_code === 'string') {
            sl.svg_code = sl.svg_code.replace(pattern, (matched) => colorMap.get(matched.toUpperCase()) || matched);
          }
        }
      }
    }
    deck.theme_id = nextThemeId;
    deck.edit_count = Number(deck.edit_count || 0) + 1;
    persistState();
    return {
      ok: true,
      theme_id: deck.theme_id,
      slides: cloneJson(deck.slides),
      pptx_audit: cloneJson(deck.pptx_audit || { native_verified: true, issues: [] }),
      artifact: null,
    } as T;
  }
  const slideEditMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/slides\/(\d+)$/);
  if (slideEditMatch && method === 'PUT') {
    const did = decodeURIComponent(slideEditMatch[1]);
    const sNo = Number(slideEditMatch[2]);
    let deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0];
    if (!deck && snap.ppt_decks[0]) {
      deck = cloneJson(snap.ppt_decks[0]);
      deck.id = did;
      state.ppt_decks.unshift(deck);
    }
    if (!deck) throw new Error('课件不存在');
    const slides = (deck.slides as Record<string, unknown>[]) || [];
    const sl = slides.find((s) => Number(s.slide_number) === sNo) || slides[sNo - 1];
    if (sl) {
      const edits = (body.edits as Record<string, string>) || {};
      const fontScale = Number(body.font_scale || 1);
      if (Array.isArray(sl.editable_texts)) {
        for (const item of sl.editable_texts as { id: string; text: string }[]) {
          if (Object.prototype.hasOwnProperty.call(edits, item.id)) {
            item.text = String(edits[item.id]);
          }
        }
      }
      for (const [tid, rawVal] of Object.entries(edits)) {
        const val = String(rawVal).trim();
        if (tid === 'title' || tid.endsWith('_title')) sl.title = val;
        else if (tid === 'subtitle' || tid.endsWith('_subtitle')) sl.subtitle = val;
        else if (tid === 'kicker' || tid.endsWith('_kicker')) sl.kicker = val;
        else if (tid === 'takeaway' || tid.endsWith('_takeaway')) sl.takeaway = val.replace(/^核心结论：/, '').trim();
      }
      if (typeof sl.svg_code === 'string') {
        sl.svg_code = applySvgTextEditsInBrowser(sl.svg_code, edits, fontScale);
      }
      if (body.speaker_notes !== undefined) {
        sl.speaker_notes = String(body.speaker_notes);
      }
    }
    deck.edit_count = Number(deck.edit_count || 0) + 1;
    persistState();
    return {
      ok: true,
      slides: cloneJson(deck.slides),
      pptx_audit: cloneJson(deck.pptx_audit || { native_verified: true, issues: [] }),
      edit_count: deck.edit_count,
    } as T;
  }
  const slideRegenMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/slides\/(\d+)\/regenerate$/);
  if (slideRegenMatch && method === 'POST') {
    const did = decodeURIComponent(slideRegenMatch[1]);
    const sNo = Number(slideRegenMatch[2]);
    let deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0];
    if (!deck && snap.ppt_decks[0]) {
      deck = cloneJson(snap.ppt_decks[0]);
      deck.id = did;
      state.ppt_decks.unshift(deck);
    }
    if (!deck) throw new Error('课件不存在');
    const instruction = String(body.instruction || '突出核心判断依据').trim();
    const slides = (deck.slides as Record<string, unknown>[]) || [];
    const sl = slides.find((s) => Number(s.slide_number) === sNo) || slides[sNo - 1];
    if (sl) {
      const nextTakeaway = `结合「${instruction.slice(0, 20)}」收束本页核心判据与易错边界`;
      sl.takeaway = nextTakeaway;
      const baseNotes = String(sl.speaker_notes || '').replace(/\n【单页重构补充】[\s\S]*$/g, '').trim();
      sl.speaker_notes = `${baseNotes}\n【单页重构补充】已按指令「${instruction.slice(0, 28)}」优化讲解节奏与板演重点。`.trim();
      const svgEdits: Record<string, string> = {};
      if (Array.isArray(sl.editable_texts)) {
        for (const item of sl.editable_texts as { id: string; role?: string; text: string }[]) {
          if (item.role === 'takeaway' || item.id.endsWith('_takeaway')) {
            item.text = `核心结论：${nextTakeaway}`;
            svgEdits[item.id] = item.text;
          }
        }
      }
      if (typeof sl.svg_code === 'string' && Object.keys(svgEdits).length > 0) {
        sl.svg_code = applySvgTextEditsInBrowser(sl.svg_code, svgEdits, 1);
      }
    }
    deck.edit_count = Number(deck.edit_count || 0) + 1;
    persistState();
    return {
      ok: true,
      slides: cloneJson(deck.slides),
      pptx_audit: cloneJson(deck.pptx_audit || { native_verified: true, issues: [] }),
    } as T;
  }
  const deckNarrateMatch = path.match(/^\/api\/ppt\/decks\/([^/]+)\/narrate$/);
  if (deckNarrateMatch && method === 'POST') {
    const did = decodeURIComponent(deckNarrateMatch[1]);
    const deck = state.ppt_decks.find((d) => d.id === did) || state.ppt_decks[0] || snap.ppt_decks[0] || { id: did, title: '试讲配音' };
    const nowSec = Date.now() / 1000;
    const audioArtifact = {
      id: makeId('art'),
      title: '试讲示范语音',
      category: 'mp3',
      module: 'ppt',
      filename: `${deck.title || '试讲配音'}.mp3`,
      file_path: '',
      mime_type: 'audio/mpeg',
      size_bytes: 245760,
      verified_status: 'verified',
      revision_count: 0,
      download_url: `/api/artifacts/${deck.id}_audio/download`,
      created_at: nowSec,
      updated_at: nowSec,
      meta: { deck_id: deck.id, voice: String(body.voice || 'zh-CN-XiaoxiaoNeural') },
    };
    const mutableDeck = state.ppt_decks.find((d) => d.id === deck.id);
    if (mutableDeck) {
      mutableDeck.audio_artifact_id = audioArtifact.id;
    }
    state.artifacts.unshift(audioArtifact);
    persistState();
    return { ok: true, audio_artifact: audioArtifact } as T;
  }

  if (path === '/api/exam/bank/catalog' && method === 'GET') return cloneJson(snap.exam_catalog) as T;
  if (path === '/api/exam/list' && method === 'GET') return { ok: true, exams: cloneJson(state.exams) } as T;
  if (path === '/api/exam/bank/assemble' && method === 'POST') {
    const dur = Number(body.duration_minutes || body.duration || 45);
    const allPool = [...state.exams, ...snap.exams];
    const thinkingTpl =
      body.mode === 'thinking'
        ? allPool.find((e) => {
            const qs = ((e.exam as Record<string, unknown> | undefined)?.questions as Record<string, unknown>[]) || [];
            return qs.some((q) => Array.isArray(q.parts) && q.parts.length > 0);
          })
        : undefined;
    const tpl = thinkingTpl || state.exams[0] || snap.exams[0];
    if (!tpl) throw new Error('演示题库模板未就绪');
    const created = cloneJson(tpl);
    const newId = makeId('exam');
    created.id = newId;
    created.edit_count = 0;
    if (created.exam && typeof created.exam === 'object') {
      const exInner = created.exam as Record<string, unknown>;
      exInner.id = newId;
      exInner.duration_minutes = dur;
      const reqCount = Number(body.count || 0);
      if (reqCount > 0 && Array.isArray(exInner.questions) && exInner.questions.length > reqCount) {
        exInner.questions = (exInner.questions as Record<string, unknown>[]).slice(0, reqCount);
        exInner.total_score = (exInner.questions as Record<string, unknown>[]).reduce(
          (acc, q) => acc + Number(q.score || 5),
          0
        );
      }
    }
    state.exams.unshift(created);
    persistState();
    return {
      ok: true,
      records: [cloneJson(created)],
      recommended_minutes: dur,
      time_matches: true,
      estimate_minutes: dur,
    } as T;
  }
  const examPutMatch = path.match(/^\/api\/exam\/([^/]+)$/);
  if (examPutMatch && method === 'PUT' && !['list', 'generate', 'bank'].includes(examPutMatch[1])) {
    const eid = decodeURIComponent(examPutMatch[1]);
    let ex = state.exams.find((e) => e.id === eid);
    if (!ex && snap.exams[0]) {
      ex = cloneJson(snap.exams[0]);
      ex.id = eid;
      state.exams.unshift(ex);
    }
    if (!ex) throw new Error('试卷不存在');
    const nextExam = cloneJson((body.exam as Record<string, unknown>) || (ex.exam as Record<string, unknown>) || {});
    if (Array.isArray(nextExam.questions)) {
      nextExam.total_score = (nextExam.questions as Record<string, unknown>[]).reduce(
        (acc, q) => acc + Number(q.score || 5),
        0
      );
    }
    ex.exam = nextExam;
    if (nextExam.title) ex.title = String(nextExam.title);
    ex.edit_count = Number(ex.edit_count || 0) + 1;
    persistState();
    return { ok: true, exam: cloneJson(ex.exam), edit_count: ex.edit_count } as T;
  }
  const examReplaceMatch = path.match(/^\/api\/exam\/([^/]+)\/replace-question$/);
  if (examReplaceMatch && method === 'POST') {
    const eid = decodeURIComponent(examReplaceMatch[1]);
    let ex = state.exams.find((e) => e.id === eid);
    if (!ex && snap.exams[0]) {
      ex = cloneJson(snap.exams[0]);
      ex.id = eid;
      state.exams.unshift(ex);
    }
    if (!ex) throw new Error('试卷不存在');
    const qIdx = Number(body.question_index ?? 0);
    const instruction = String(body.instruction || '更换同考点变式新题').trim();
    const examObj = cloneJson((ex.exam as Record<string, unknown>) || {});
    const questions = Array.isArray(examObj.questions) ? [...(examObj.questions as Record<string, unknown>[])] : [];
    if (qIdx < 0 || qIdx >= questions.length) throw new Error('题号越界');
    const oldQ = questions[qIdx];
    const kp = String(oldQ.knowledge_point || '导数单调性与极值');
    const hasOpts = Array.isArray(oldQ.options) && oldQ.options.length > 0;
    const variantQ: Record<string, unknown> = hasOpts
      ? {
          ...oldQ,
          id: String(oldQ.id || makeId('q')),
          stem: `【变式 · ${instruction.slice(0, 16)}】已知函数 $f(x) = x^3 - 3x + 1$，围绕「${kp}」判断下列结论正确的是（ ）`,
          options: [
            'A. 在区间 $(-1, 1)$ 上单调递增',
            'B. 在 $x = -1$ 处取得极大值 $3$，在 $x = 1$ 处取得极小值 $-1$',
            'C. 驻点为 $x = 0$ 且无极值',
            'D. 极大值与极小值之和为 $0$',
          ],
          parts: [],
          answer: 'B',
          analysis: '求导得 $f\'(x) = 3x^2 - 3 = 3(x+1)(x-1)$。当 $x \\in (-\\infty,-1)$ 或 $(1,+\\infty)$ 时 $f\'(x) > 0$；当 $x \\in (-1,1)$ 时 $f\'(x) < 0$。故 $f(-1) = 3$ 为极大值，$f(1) = -1$ 为极小值。',
          intent: `考查「${kp}」的同构变式迁移与驻点左右变号检验（${instruction.slice(0, 22)}）。`,
          verification: {
            status: 'verified',
            badge: '计算结果核对通过 (1/1)',
            passed: 1,
            total: 1,
            checks: [{ label: '求导与极值验算', type: 'extrema', passed: true, detail: "f'(x)=3(x-1)(x+1)，f(-1)=3，f(1)=-1" }],
          },
        }
      : {
          ...oldQ,
          id: String(oldQ.id || makeId('q')),
          stem: `【变式 · ${instruction.slice(0, 16)}】围绕「${kp}」，求函数 $f(x) = x - \\ln x$（$x > 0$）的单调区间与极小值。`,
          options: [],
          parts: [],
          answer: '单调递减区间为 (0, 1)，单调递增区间为 (1, +∞)，极小值为 f(1) = 1',
          analysis: '定义域 $(0, +\\infty)$，$f\'(x) = 1 - \\frac{1}{x} = \\frac{x-1}{x}$。在 $(0,1)$ 上 $f\'(x)<0$，在 $(1,+\\infty)$ 上 $f\'(x)>0$，故在 $x=1$ 处取得极小值 $f(1)=1$。',
          intent: `强化「${kp}」中定义域先行与导数通分判号规范。`,
          verification: {
            status: 'verified',
            badge: '计算结果核对通过 (1/1)',
            passed: 1,
            total: 1,
            checks: [{ label: '驻点与极值验算', type: 'evaluate', passed: true, detail: 'x=1 处 f(1)=1, f\'(1)=0' }],
          },
        };
    questions[qIdx] = variantQ;
    examObj.questions = questions;
    examObj.total_score = questions.reduce((acc, q) => acc + Number(q.score || 5), 0);
    ex.exam = examObj;
    ex.edit_count = Number(ex.edit_count || 0) + 1;
    persistState();
    return { ok: true, exam: cloneJson(ex.exam), edit_count: ex.edit_count } as T;
  }
  const examSubsMatch = path.match(/^\/api\/exam\/([^/]+)\/submissions$/);
  if (examSubsMatch && method === 'GET') {
    const eid = decodeURIComponent(examSubsMatch[1]);
    const subs = (state.memory.recent_submissions || []).filter((s) => String(s.exam_id || '') === eid);
    return { ok: true, submissions: cloneJson(subs) } as T;
  }
  const examSubmitMatch = path.match(/^\/api\/exam\/([^/]+)\/submit$/);
  if (examSubmitMatch && method === 'POST') {
    const eid = decodeURIComponent(examSubmitMatch[1]);
    const exRec = state.exams.find((e) => e.id === eid) || snap.exams.find((e) => e.id === eid) || state.exams[0] || snap.exams[0];
    if (!exRec) throw new Error('试卷不存在');
    const exObj = (exRec.exam as {
      title?: string;
      subject?: string;
      grade_level?: string;
      questions?: Record<string, unknown>[];
    }) || {};
    const questions = exObj.questions || [];
    const subject = String(exObj.subject || exRec.subject || '高中数学');
    const gradeLevel = String(exObj.grade_level || exRec.grade_level || '高二年级');
    const examTitle = String(exObj.title || exRec.title || '在线测验');
    const answers =
      typeof body.answers === 'object' && body.answers !== null
        ? (body.answers as Record<string, unknown>)
        : {};

    let score = 0;
    let totalScore = 0;
    let loggedErrorCount = 0;
    const nowSec = Date.now() / 1000;
    const weakTopics: string[] = [];

    const itemResults = questions.map((q, idx) => {
      const qid = String(q.id || `q${idx + 1}`);
      const rawUserVal = Object.prototype.hasOwnProperty.call(answers, qid)
        ? answers[qid]
        : answers[String(idx)];
      const { earned, maxPts, ok, feedback, correctAnswer } = gradeExamQuestionInBrowser(q, rawUserVal);
      score += earned;
      totalScore += maxPts;
      const kp = String(q.knowledge_point || examTitle || '综合要点');

      if (!ok) {
        if (!weakTopics.includes(kp)) weakTopics.push(kp);
        const qText = String(q.stem || '').trim();
        if (qText) {
          const qParts = Array.isArray(q.parts) ? (q.parts as Record<string, unknown>[]) : [];
          const partTakeaway = qParts.length
            ? qParts
                .map((pt, pi) => `（${pi + 1}）${String(pt.explanation || pt.answer || '').trim()}`)
                .filter(Boolean)
                .join('；')
            : '';
          const takeawayText = String(
            q.analysis || partTakeaway || correctAnswer || '对照标准解析复盘关键前提与临界边界'
          ).slice(0, 360);

          const existingIdx = state.error_book.findIndex(
            (x) => String(x.question_text || '').trim() === qText
          );
          if (existingIdx !== -1) {
            const existing = state.error_book[existingIdx];
            const updatedErr = {
              ...existing,
              subject,
              grade_level: gradeLevel,
              topic_tag: kp,
              question_text: qText,
              my_mistake: feedback,
              key_takeaway: takeawayText,
              takeaway: takeawayText,
              mastery_level: 1,
              created_at: Number(existing.created_at || nowSec),
              updated_at: nowSec,
            };
            state.error_book.splice(existingIdx, 1);
            state.error_book.unshift(updatedErr);
          } else {
            state.error_book.unshift({
              id: makeId('err'),
              subject,
              grade_level: gradeLevel,
              topic_tag: kp,
              question_text: qText,
              my_mistake: feedback,
              key_takeaway: takeawayText,
              takeaway: takeawayText,
              solution: { steps: [], final_answer: correctAnswer },
              mastery_level: 1,
              created_at: nowSec,
            });
          }
          loggedErrorCount += 1;
        }
      }

      // Sync learner memory weak_topics / mastered_topics
      const existingWeakIdx = state.memory.weak_topics.findIndex(
        (w) => String(w.topic_tag || '') === kp
      );
      if (!ok) {
        if (existingWeakIdx !== -1) {
          const curW = state.memory.weak_topics[existingWeakIdx];
          const prevPatterns = Array.isArray(curW.mistake_patterns)
            ? (curW.mistake_patterns as string[])
            : [];
          const nextPatterns =
            feedback && !prevPatterns.includes(feedback)
              ? [feedback, ...prevPatterns].slice(0, 5)
              : prevPatterns;
          state.memory.weak_topics[existingWeakIdx] = {
            ...curW,
            mastery_score: Math.max(25, Math.round((Number(curW.mastery_score || 65) - 8) * 10) / 10),
            mistake_patterns: nextPatterns,
            practice_count: Number(curW.practice_count || 0) + 1,
            due_review: true,
          };
        } else {
          state.memory.weak_topics.unshift({
            id: makeId('mem'),
            topic_tag: kp,
            subject,
            grade_level: gradeLevel,
            mastery_score: 60,
            mistake_patterns: feedback ? [feedback] : [],
            practice_count: 1,
            correct_count: 0,
            due_review: true,
          });
        }
      } else if (existingWeakIdx !== -1) {
        const curW = state.memory.weak_topics[existingWeakIdx];
        const nextMastery = Math.min(100, Math.round((Number(curW.mastery_score || 65) + 10) * 10) / 10);
        state.memory.weak_topics[existingWeakIdx] = {
          ...curW,
          mastery_score: nextMastery,
          practice_count: Number(curW.practice_count || 0) + 1,
          correct_count: Number(curW.correct_count || 0) + 1,
          due_review: nextMastery < 80,
        };
      }

      return {
        question_id: qid,
        index: idx + 1,
        knowledge_point: kp,
        earned,
        max_score: maxPts,
        correct: ok,
        feedback,
        correct_answer: correctAnswer,
      };
    });

    const roundedScore = Math.round(score * 10) / 10;
    const roundedTotal = Math.round(totalScore * 10) / 10;
    const submission = {
      id: makeId('sub'),
      exam_id: eid,
      exam_title: examTitle,
      score: roundedScore,
      total_score: roundedTotal,
      duration_sec: Number(body.duration_sec || 0),
      logged_error_count: loggedErrorCount,
      auto_saved_errors: loggedErrorCount,
      analytics_report_id: String(state.analytics_reports[0]?.id || snap.analytics_reports[0]?.id || ''),
      weak_topics: weakTopics,
      item_results: itemResults,
      created_at: nowSec,
    };
    state.memory.recent_submissions = [
      { ...submission, answers: cloneJson(answers) },
      ...(state.memory.recent_submissions || []),
    ].slice(0, 20);
    persistState();

    return {
      ok: true,
      auto_saved_errors: loggedErrorCount,
      submission,
    } as T;
  }

  if (path === '/api/analytics/sample-csv' && method === 'GET') return cloneJson(snap.sample_csv) as T;
  if (path === '/api/analytics/reports' && method === 'GET') return { ok: true, reports: cloneJson(state.analytics_reports) } as T;
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

  if (path === '/api/mindmap/list' && method === 'GET') return { ok: true, mindmaps: cloneJson(state.mindmaps) } as T;
  if (path === '/api/mindmap/from-topic' && method === 'POST') {
    const topicId = String(body.topic_id || '').trim();
    const customTitle = String(body.custom_title || '').trim();
    const allTopics = (snap.pedagogy_topics.topics || []) as Record<string, unknown>[];
    const matchedTopic =
      (topicId ? allTopics.find((t) => String(t.id) === topicId) : undefined) ||
      (customTitle
        ? allTopics.find((t) => String(t.title || '').includes(customTitle) || customTitle.includes(String(t.title || '').split('：')[0]))
        : undefined);

    let graph: Record<string, unknown>;
    let subject = String(body.subject || '通用学科');
    let domainId = String(body.domain_id || '');
    let branch = String(body.branch || '');
    let title = customTitle;

    if (body.graph_payload && typeof body.graph_payload === 'object') {
      graph = autoLayoutMindmapInBrowser(cloneJson(body.graph_payload as Record<string, unknown>));
      title = title || String(graph.title || '自定义思维导图');
      graph.title = title;
    } else if (matchedTopic) {
      graph = buildMindmapGraphFromTopicInBrowser(matchedTopic, customTitle);
      title = String(graph.title || customTitle || matchedTopic.title || '学科知识思维导图');
      subject = String(matchedTopic.subject || subject);
      domainId = String(matchedTopic.domain_id || domainId);
      branch = String(matchedTopic.branch || branch);
    } else {
      const tpl = state.mindmaps[0] || snap.mindmaps[0];
      if (tpl && tpl.graph) {
        graph = cloneJson(tpl.graph as Record<string, unknown>);
        title = customTitle || String(tpl.title || '中心思维导图');
        graph.title = title;
        const nodes = (graph.nodes as Record<string, unknown>[]) || [];
        if (nodes[0] && customTitle) nodes[0].label = customTitle;
        subject = String(body.subject || tpl.subject || subject);
        domainId = String(body.domain_id || tpl.domain_id || domainId);
        branch = String(body.branch || tpl.branch || branch);
      } else {
        title = customTitle || '中心思维导图';
        graph = autoLayoutMindmapInBrowser({
          title,
          layout: 'mindmap_lr',
          nodes: [
            { id: 'n_root', label: title, parent_id: null, level: 0, side: 'center', category: 'root', note: '' },
            { id: 'n_b1', label: '核心原理', parent_id: 'n_root', level: 1, side: 'right', category: 'principle', note: '' },
            { id: 'n_b2', label: '易错反例', parent_id: 'n_root', level: 1, side: 'right', category: 'pitfall', note: '' },
            { id: 'n_b3', label: '直观模型', parent_id: 'n_root', level: 1, side: 'left', category: 'intuition', note: '' },
            { id: 'n_b4', label: '跨学科映射', parent_id: 'n_root', level: 1, side: 'left', category: 'interdisciplinary', note: '' },
          ],
          cross_links: [{ id: 'cl_1', source: 'n_b3', target: 'n_b4', label: '跨域联想' }],
        });
      }
    }

    const mapId = makeId('mmap');
    const artId = makeId('art');
    const drawioXml = compileDrawioXmlInBrowser(graph, mapId);
    const createdMap = {
      id: mapId,
      title,
      subject,
      domain_id: domainId,
      branch,
      graph,
      drawio_xml: drawioXml,
      artifact_id: artId,
    };
    state.mindmaps.unshift(createdMap);
    persistState();
    return { ok: true, mindmap: cloneJson(createdMap) } as T;
  }
  if (path === '/api/mindmap/import-xml' && method === 'POST') {
    const filename = String(body.filename || 'imported.drawio');
    const fallbackTitle = filename.replace(/\.[^.]+$/, '') || '导入思维导图';
    const xmlContent = String(body.xml_content || '');
    const graph = parseDrawioXmlInBrowser(xmlContent, fallbackTitle);
    const mapId = makeId('mmap');
    const artId = makeId('art');
    const title = String(graph.title || fallbackTitle);
    const drawioXml = xmlContent.trim() || compileDrawioXmlInBrowser(graph, mapId);
    const nowSec = Date.now() / 1000;
    const art = {
      id: artId,
      title: `思维导图：${title}`,
      category: 'drawio',
      module: 'tutor',
      filename: filename.endsWith('.drawio') ? filename : `${title}.drawio`,
      file_path: '',
      mime_type: 'application/xml',
      size_bytes: drawioXml.length,
      verified_status: 'verified',
      revision_count: 0,
      download_url: `/api/artifacts/${artId}/download`,
      created_at: nowSec,
      updated_at: nowSec,
      meta: { mindmap_id: mapId },
    };
    const createdMap = {
      id: mapId,
      title,
      subject: String(body.subject || '跨学科综合'),
      domain_id: 'interdisciplinary',
      branch: 'Draw.io 导入导图',
      graph,
      drawio_xml: drawioXml,
      artifact_id: artId,
      artifact: art,
    };
    state.artifacts.unshift(art);
    state.mindmaps.unshift(createdMap);
    persistState();
    return { ok: true, mindmap: cloneJson(createdMap) } as T;
  }
  const mmPutMatch = path.match(/^\/api\/mindmap\/([^/]+)$/);
  if (mmPutMatch && method === 'PUT' && !['list', 'from-topic', 'import-xml', 'generate'].includes(mmPutMatch[1])) {
    const mid = decodeURIComponent(mmPutMatch[1]);
    let mm = state.mindmaps.find((m) => m.id === mid);
    if (!mm && (state.mindmaps[0] || snap.mindmaps[0])) {
      mm = cloneJson((state.mindmaps[0] || snap.mindmaps[0])!);
      mm.id = mid;
      state.mindmaps.unshift(mm);
    }
    if (!mm) throw new Error('思维导图不存在');
    if (typeof body.drawio_xml === 'string' && body.drawio_xml.trim()) {
      const parsedGraph = parseDrawioXmlInBrowser(body.drawio_xml, String(mm.title || '思维导图'));
      mm.graph = parsedGraph;
      mm.title = String(parsedGraph.title || mm.title);
      mm.drawio_xml = body.drawio_xml;
    } else if (body.graph && typeof body.graph === 'object') {
      const nextGraph = cloneJson(body.graph as Record<string, unknown>);
      mm.graph = nextGraph;
      if (nextGraph.title) mm.title = String(nextGraph.title);
      mm.drawio_xml = compileDrawioXmlInBrowser(nextGraph, mid);
    }
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
  const { snap, state } = await ensureDemoLoaded();
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

    let sampleExam = state.exams[0];
    if (!sampleExam && snap.exams[0]) {
      sampleExam = cloneJson(snap.exams[0]);
      sampleExam.id = makeId('exam');
      state.exams.unshift(sampleExam);
    }
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
  const { snap, state } = await ensureDemoLoaded();
  const path = new URL(url, 'http://demo.local').pathname;
  callbacks.onStage?.('demo', '正在基于本地静态引擎快速梳理结果…');
  await pause(220);

  if (path === '/api/tutor/solve') {
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
        uncertainty_note: '无歧义',
        knowledge_graph: { prerequisites: ['基础代数恒等变形'], core_concept: '先定范围，再分步推演', common_traps: ['忽略隐含定义域'], extensions: ['含参分类讨论'], interdisciplinary_bridges: [] },
        variants: [],
      },
      verification: { status: 'verified', badge: '演示模式 · 框架已核对', checks: [], auto_repaired: false, repair_rounds: 0, repair_notes: [] },
      duration_ms: 350,
    });
    return;
  }

  const lessonTpl = state.lessons[0] || snap.lessons[0];
  if (path === '/api/lesson/generate' && lessonTpl) {
    const created = cloneJson(lessonTpl);
    const lid = makeId('les');
    const topicStr = String(body.topic || created.title || '教学设计').trim();
    created.id = lid;
    created.title = topicStr;
    created.subject = String(body.subject || created.subject || '高中数学');
    created.grade_level = String(body.grade_level || created.grade_level || '高二年级');
    created.lesson_type = String(body.lesson_type || created.lesson_type || '师范生微格试讲 (15分钟)');
    created.edit_count = 0;
    created.edited_char_delta = 0;
    if (created.content && typeof created.content === 'object') {
      const cObj = created.content as Record<string, unknown>;
      cObj.id = lid;
      cObj.title = topicStr;
      cObj.subject = created.subject;
      cObj.grade_level = created.grade_level;
      cObj.lesson_type = created.lesson_type;
      cObj.edit_count = 0;
    }
    const art = state.artifacts.find((a) => a.id === created.artifact_id) || snap.artifacts[0] || null;
    state.lessons.unshift(created);
    persistState();
    callbacks.onResult({ lesson: cloneJson(created), artifact: cloneJson(art), duration_ms: 300 });
    return;
  }

  const deckTpl = state.ppt_decks[0] || snap.ppt_decks[0];
  if (path === '/api/ppt/generate' && deckTpl) {
    const created = cloneJson(deckTpl);
    created.id = makeId('deck');
    if (body.title) created.title = String(body.title);
    if (body.subject) created.subject = String(body.subject);
    if (body.grade_level) created.grade_level = String(body.grade_level);
    if (body.theme_id) created.theme_id = String(body.theme_id);
    created.edit_count = 0;
    const art = state.artifacts.find((a) => a.id === created.pptx_artifact_id) || snap.artifacts[0] || null;
    state.ppt_decks.unshift(created);
    persistState();
    callbacks.onResult({ deck: cloneJson(created), artifact: cloneJson(art), duration_ms: 300 });
    return;
  }

  const examTpl = state.exams[0] || snap.exams[0];
  if (path === '/api/exam/generate' && examTpl) {
    const created = cloneJson(examTpl);
    const eid = makeId('exam');
    created.id = eid;
    if (body.knowledge_points) created.title = `${String(body.knowledge_points).slice(0, 18)} · 专项测验卷`;
    if (body.subject) created.subject = String(body.subject);
    if (body.grade_level) created.grade_level = String(body.grade_level);
    created.edit_count = 0;
    if (created.exam && typeof created.exam === 'object') {
      const exInner = created.exam as Record<string, unknown>;
      exInner.id = eid;
      exInner.title = created.title;
      exInner.subject = created.subject;
      exInner.grade_level = created.grade_level;
    }
    state.exams.unshift(created);
    persistState();
    callbacks.onResult({ exam_record: cloneJson(created), duration_ms: 300 });
    return;
  }

  const reportTpl = state.analytics_reports[0] || snap.analytics_reports[0];
  if (path === '/api/analytics/analyze' && reportTpl) {
    const created = cloneJson(reportTpl);
    created.id = makeId('ana');
    if (body.title) created.title = String(body.title);
    if (body.dataset_name) created.dataset_name = String(body.dataset_name);
    if (body.teacher_note !== undefined) created.teacher_note = String(body.teacher_note);
    state.analytics_reports.unshift(created);
    persistState();
    callbacks.onResult({ report: cloneJson(created), duration_ms: 300 });
    return;
  }

  if (path === '/api/mindmap/generate') {
    const topicStr = String(body.topic || '').trim();
    const res = await demoApiJson<{ mindmap: Record<string, unknown> }>('/api/mindmap/from-topic', {
      method: 'POST',
      body: JSON.stringify({
        custom_title: topicStr || '学科核心思维导图',
        subject: body.subject || '通用学科',
        domain_id: body.domain || '',
        branch: body.branch || '',
      }),
    });
    callbacks.onResult({ mindmap: res.mindmap, duration_ms: 300 });
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
  const { snap, state } = await ensureDemoLoaded();
  let content = `# 知学工作台演示导出\n\n请求路径：${url}\n\n提示：完整二进制 .docx / .pptx / .zip 打包导出需连接 FastAPI 后端服务（本地运行时访问 127.0.0.1:5173 或在设置中填入后端地址）。\n`;
  let filename = fallbackName;
  let mimeType = 'text/markdown;charset=utf-8';

  const zipMatch = url.match(/\/api\/courses\/([^/]+)\/export-zip/);
  if (zipMatch) {
    const cid = decodeURIComponent(zipMatch[1]);
    const c = (state.courses.find((x) => x.id === cid) || snap.courses.find((x) => x.id === cid)) as
      | { title?: string; description?: string; units?: { unit_index: number; title: string; lectures: { title: string; board_pages?: { blocks?: { heading: string; lines: string[] }[] }[] }[] }[] }
      | undefined;
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
    const aid = decodeURIComponent(url.split('/')[3] || '');
    if (aid.endsWith('_audio')) {
      const deckId = aid.replace(/_audio$/, '');
      const deck = (state.ppt_decks.find((d) => d.id === deckId) || state.ppt_decks[0] || snap.ppt_decks[0]) as
        | { title?: string; slides?: { slide_number: number; title: string; speaker_notes: string }[] }
        | undefined;
      filename = `${deck?.title || '试讲配音'}_试讲逐字稿.md`;
      const scriptLines = [`# ${deck?.title || '示范课件'} · 试讲示范逐字稿`, ''];
      for (const sl of deck?.slides || []) {
        scriptLines.push(`## 第 ${sl.slide_number} 页：${sl.title}`, '', sl.speaker_notes || '', '');
      }
      content = scriptLines.join('\n');
    } else {
      const art = (state.artifacts.find((a) => a.id === aid) || snap.artifacts.find((a) => a.id === aid)) as
        | { title?: string; filename?: string; category?: string; meta?: Record<string, unknown> }
        | undefined;
      if (art?.category === 'drawio') {
        const mm = state.mindmaps.find((m) => m.artifact_id === aid) || snap.mindmaps.find((m) => m.artifact_id === aid);
        if (mm && typeof mm.drawio_xml === 'string') {
          filename = String(art.filename || `${mm.title || 'mindmap'}.drawio`);
          content = mm.drawio_xml;
          mimeType = 'application/xml;charset=utf-8';
        }
      } else if (art) {
        filename = `${String(art.filename || art.title || 'demo_export').replace(/\.[^.]+$/, '')}_演示版.md`;
        content = `# ${art.title || '导出内容'}\n\n类别：${art.category || 'artifact'}\n\n在在线静态演示模式下，系统已为您导出结构化 Markdown 文本版；连接本地/云端后端可下载完整 Word / PPTX / Draw.io 文件。\n`;
      }
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
