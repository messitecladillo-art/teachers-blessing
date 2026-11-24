import { BoardBlock } from '../types';

/**
 * Convert LaTeX inline/display expressions and markdown tokens into natural spoken Chinese
 * suitable for browser speechSynthesis and live lecture subtitles.
 */
export function latexToSpokenZh(text: string): string {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\$\$?/g, ' ');

  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\(?:text|mathrm|mathbf|operatorname|boldsymbol)\{([^{}]*)\}/g, '$1');
  }

  s = s
    .replace(/\\mathbb\{R\}/g, ' 全体实数集 ')
    .replace(/\\mathbb\{N\}/g, ' 自然数集 ')
    .replace(/\\mathbb\{Z\}/g, ' 整数集 ')
    .replace(/\\mathbb\{Q\}/g, ' 有理数集 ')
    .replace(/\\mathbb\{C\}/g, ' 复数集 ')
    .replace(/\\mathbb\{([A-Za-z]+)\}/g, ' $1 ');

  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $2 分之 $1 ');
    if (next === s) break;
    s = next;
  }

  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, ' $1 次根号下 $2 ');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, ' 根号下 $1 ');
  }

  s = s.replace(/-\s*\\infty/g, ' 负无穷大 ').replace(/\+\s*\\infty/g, ' 正无穷大 ');

  const pairs: [RegExp, string][] = [
    [/\\Rightarrow/g, ' 推出 '],
    [/\\Leftarrow/g, ' 反推得到 '],
    [/\\iff/g, ' 当且仅当 '],
    [/\\leftrightarrow/g, ' 等价于 '],
    [/\\rightarrow|\\to/g, ' 趋近于 '],
    [/\\mapsto/g, ' 映射到 '],
    [/\\ge(?:q)?/g, ' 大于等于 '],
    [/\\le(?:q)?/g, ' 小于等于 '],
    [/\\ne(?:q)?/g, ' 不等于 '],
    [/\\approx/g, ' 约等于 '],
    [/\\equiv|\\cong/g, ' 同构于 '],
    [/\\propto/g, ' 正比于 '],
    [/\\infty/g, ' 无穷大 '],
    [/\\cup/g, ' 并 '],
    [/\\cap/g, ' 交 '],
    [/\\in\b/g, ' 属于 '],
    [/\\notin\b/g, ' 不属于 '],
    [/\\subset(?:eq)?\b/g, ' 包含于 '],
    [/\\mid\b/g, ' 整除 '],
    [/\\cdot/g, ' 乘 '],
    [/\\times/g, ' 乘以 '],
    [/\\div/g, ' 除以 '],
    [/\\pm/g, ' 加减 '],
    [/\\ln\b/g, ' 自然对数 '],
    [/\\log\b/g, ' 对数 '],
    [/\\sin\b/g, ' 正弦 '],
    [/\\cos\b/g, ' 余弦 '],
    [/\\tan\b/g, ' 正切 '],
    [/\\lim\b/g, ' 极限 '],
    [/\\max\b/g, ' 最大值 '],
    [/\\min\b/g, ' 最小值 '],
    [/\\alpha\b/g, ' 阿尔法 '],
    [/\\beta\b/g, ' 贝塔 '],
    [/\\gamma\b/g, ' 伽马 '],
    [/\\Delta\b/g, ' 判别式德尔塔 '],
    [/\\delta\b/g, ' 德尔塔 '],
    [/\\theta\b/g, ' 西塔 '],
    [/\\varphi\b|\\phi\b/g, ' 斐 '],
    [/\\lambda\b/g, ' 拉姆达 '],
    [/\\pi\b/g, ' 派 '],
    [/\\sigma\b/g, ' 西格玛 '],
    [/\\omega\b/g, ' 欧米伽 '],
    [/\\partial\b/g, ' 偏 '],
    [/\\forall\b/g, ' 对任意 '],
    [/\\exists\b/g, ' 存在 '],
    [/\\left|\\right|\\,|\\;|\\:|\\!/g, ' '],
  ];
  for (const [pat, rep] of pairs) {
    s = s.replace(pat, rep);
  }

  s = s
    .replace(/([A-Za-z])''\s*\(([^)]+)\)/g, '$1 两撇 $2')
    .replace(/([A-Za-z])'\s*\(([^)]+)\)/g, '$1 撇 $2')
    .replace(/([A-Za-z])''/g, '$1 两撇')
    .replace(/([A-Za-z])'/g, '$1 撇');

  s = s
    .replace(/\^\{2\}|\^2\b/g, ' 的平方 ')
    .replace(/\^\{3\}|\^3\b/g, ' 的立方 ')
    .replace(/\^\{([^{}]+)\}/g, ' 的 $1 次方 ')
    .replace(/\^(-?\d+|[A-Za-z])/g, ' 的 $1 次方 ')
    .replace(/_\{([^{}]+)\}/g, ' 下标 $1 ');

  const unicodeMap: Record<string, string> = {
    '⇒': ' 推出 ',
    '→': '，下一步 ',
    '≥': ' 大于等于 ',
    '≤': ' 小于等于 ',
    '≠': ' 不等于 ',
    '∞': ' 无穷大 ',
    '∈': ' 属于 ',
    '∝': ' 正比于 ',
    '·': ' 乘 ',
    '²': ' 的平方',
    '³': ' 的立方',
  };
  for (const [k, v] of Object.entries(unicodeMap)) {
    s = s.split(k).join(v);
  }

  s = s.replace(/\\[A-Za-z]+/g, ' ');
  s = s.replace(/[{}\\#*`>~|]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Produce clean spoken lecture narration for a single board block.
 */
export function buildBlockNarration(block: BoardBlock, lectureTitle: string): string {
  if (block.narration && block.narration.trim()) {
    return latexToSpokenZh(block.narration);
  }
  const parts: string[] = [block.heading || lectureTitle, ...(block.lines || [])];
  if (block.highlight_note) {
    parts.push(`重点注意：${block.highlight_note}`);
  }
  return latexToSpokenZh(parts.join('。'));
}

/**
 * Extract a plottable single-variable f(x) expression from a board block if present.
 */
export function extractPlottableFromBlock(block: BoardBlock): string {
  if (block.visual_expr && block.visual_expr.trim()) {
    return block.visual_expr.trim();
  }
  const candidates = [...(block.lines || []), block.heading];
  for (const candText of candidates) {
    const m = (candText || '').match(/(?:[fgh]\s*\(\s*x\s*\)|y)\s*=\s*([A-Za-z0-9 \t+\-*/^()\\{}.²³]+)/);
    if (!m || !m[1]) continue;
    let expr = m[1]
      .replace(/\\ln/g, 'ln')
      .replace(/\\sin/g, 'sin')
      .replace(/\\cos/g, 'cos')
      .replace(/\\tan/g, 'tan')
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/[${}\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const eqIdx = expr.indexOf('=');
    if (eqIdx > 0) expr = expr.slice(0, eqIdx).trim();
    expr = expr.replace(/[.,;，。；\s]+$/, '');

    if (expr && expr.length <= 42 && /x/i.test(expr) && !/[\u4e00-\u9fa5]/.test(expr)) {
      return expr;
    }
  }
  return '';
}
