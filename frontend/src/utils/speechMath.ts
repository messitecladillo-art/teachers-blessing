import { BoardBlock } from '../types';

const ALLOWED_PLOT_IDS = new Set([
  'x',
  'e',
  'pi',
  'ln',
  'log',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'exp',
  'sqrt',
  'abs',
  'pow',
  'min',
  'max',
]);

/**
 * Convert LaTeX inline/display expressions and markdown tokens into natural spoken Chinese
 * suitable for browser speechSynthesis and live lecture subtitles.
 */
export function latexToSpokenZh(text: string): string {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/^\s*>\s?/gm, ' ');
  s = s.replace(/\$\$?/g, ' ');

  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\(?:text|mathrm|mathbf|operatorname|boldsymbol)\{([^{}]*)\}/g, '$1');
  }

  // Strip sizing/spacing macros BEFORE operator replacements so \left( never matches \le
  s = s.replace(/\\left(?![A-Za-z])|\\right(?![A-Za-z])|\\,|\\;|\\:|\\!|\\quad\b|\\qquad\b/g, ' ');

  s = s
    .replace(/\\mathbb\{R\}/g, ' 全体实数集 ')
    .replace(/\\mathbb\{N\}/g, ' 自然数集 ')
    .replace(/\\mathbb\{Z\}/g, ' 整数集 ')
    .replace(/\\mathbb\{Q\}/g, ' 有理数集 ')
    .replace(/\\mathbb\{C\}/g, ' 复数集 ')
    .replace(/\\mathbb\{([A-Za-z]+)\}/g, ' $1 ');

  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\\(?:[dt])?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, ' $2 分之 $1 ');
    if (next === s) break;
    s = next;
  }

  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, ' $1 次根号下 $2 ');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, ' 根号下 $1 ');
  }

  s = s
    .replace(/\\sum_\{([^{}]+)\}\^\{([^{}]+)\}/g, ' 从 $1 到 $2 求和 ')
    .replace(/\\sum_([A-Za-z0-9]+)\^([A-Za-z0-9]+)/g, ' 从 $1 到 $2 求和 ')
    .replace(/\\int_\{([^{}]+)\}\^\{([^{}]+)\}/g, ' 从 $1 到 $2 积分 ')
    .replace(/\\int_([A-Za-z0-9]+)\^([A-Za-z0-9]+)/g, ' 从 $1 到 $2 积分 ');

  s = s.replace(/-\s*\\infty\b/g, ' 负无穷大 ').replace(/\+\s*\\infty\b/g, ' 正无穷大 ');

  const pairs: [RegExp, string][] = [
    [/\\Rightarrow\b/g, ' 推出 '],
    [/\\Leftarrow\b/g, ' 反推得到 '],
    [/\\iff\b/g, ' 当且仅当 '],
    [/\\leftrightarrow\b/g, ' 等价于 '],
    [/\\rightarrow\b|\\to\b/g, ' 趋近于 '],
    [/\\mapsto\b/g, ' 映射到 '],
    [/\\ge(?:q)?\b/g, ' 大于等于 '],
    [/\\le(?:q)?\b/g, ' 小于等于 '],
    [/\\ne(?:q)?\b/g, ' 不等于 '],
    [/\\approx\b/g, ' 约等于 '],
    [/\\equiv\b|\\cong\b/g, ' 同构于 '],
    [/\\propto\b/g, ' 正比于 '],
    [/\\infty\b/g, ' 无穷大 '],
    [/\\emptyset\b|\\varnothing\b/g, ' 空集 '],
    [/\\sum\b/g, ' 求和 '],
    [/\\int\b/g, ' 积分 '],
    [/\\cup\b/g, ' 并 '],
    [/\\cap\b/g, ' 交 '],
    [/\\in\b/g, ' 属于 '],
    [/\\notin\b/g, ' 不属于 '],
    [/\\subset(?:eq)?\b/g, ' 包含于 '],
    [/\\mid\b/g, ' 整除 '],
    [/\\cdot\b/g, ' 乘 '],
    [/\\times\b/g, ' 乘以 '],
    [/\\div\b/g, ' 除以 '],
    [/\\pm\b/g, ' 加减 '],
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
  ];
  for (const [pat, rep] of pairs) {
    s = s.replace(pat, rep);
  }

  s = s
    .replace(/([A-Za-z])''\s*\(([^)]+)\)/g, '$1 两撇 $2')
    .replace(/([A-Za-z])'\s*\(([^)]+)\)/g, '$1 撇 $2')
    .replace(/([A-Za-z])''/g, '$1 两撇')
    .replace(/([A-Za-z])'/g, '$1 撇');

  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/\^\{2\}|\^2\b/g, ' 的平方 ')
      .replace(/\^\{3\}|\^3\b/g, ' 的立方 ')
      .replace(/\^\{([^{}]+)\}/g, ' 的 $1 次方 ')
      .replace(/\^(-?\d+|[A-Za-z])/g, ' 的 $1 次方 ')
      .replace(/_\{([^{}]+)\}/g, ' 下标 $1 ')
      .replace(/_([A-Za-z0-9]+)/g, ' 下标 $1 ');
  }

  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, ' $1 次根号下 $2 ');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, ' 根号下 $1 ');
  }

  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\\(?:[dt])?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, ' $2 分之 $1 ');
    if (next === s) break;
    s = next;
  }

  const unicodeMap: Record<string, string> = {
    '⇒': ' 推出 ',
    '→': '，下一步 ',
    '≥': ' 大于等于 ',
    '≤': ' 小于等于 ',
    '≠': ' 不等于 ',
    '>': ' 大于 ',
    '<': ' 小于 ',
    '∞': ' 无穷大 ',
    '∈': ' 属于 ',
    '∅': ' 空集 ',
    '∑': ' 求和 ',
    '∫': ' 积分 ',
    '∝': ' 正比于 ',
    '·': ' 乘 ',
    '²': ' 的平方',
    '³': ' 的立方',
  };
  for (const [k, v] of Object.entries(unicodeMap)) {
    s = s.split(k).join(v);
  }

  s = s.replace(/\\[A-Za-z]+/g, ' ');
  s = s.replace(/[{}\\#*`<>~|]/g, ' ');
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

function hasBalancedParens(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
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
    let pre = (candText || '')
      .replace(/\\left(?![A-Za-z])|\\right(?![A-Za-z])/g, '')
      .replace(/\\,|\\;|\\:|\\!|\\quad\b|\\qquad\b/g, ' ');

    // Strip trailing/inline domain clauses such as (x > 0), ($x \in (0, +\infty)$), （x ≥ 1）
    pre = pre.replace(
      /[(\uff08]\s*\$?\s*[xat]\s*(?:[<>≥≤≠∈]|\\[gl]eq?\b|\\neq?\b|\\in\b|\\notin\b)(?:[^()\uff08\uff09]|\([^()]*\))*[)\uff09]\s*\$?/gi,
      ' '
    );
    pre = pre.replace(
      /[,，;；]\s*(?:其中\s*)?\$?\s*x\s*(?:[<>≥≤≠∈]|\\[gl]eq?\b|\\neq?\b|\\in\b|\\notin\b).*$/gi,
      ''
    );

    pre = pre
      .replace(/−/g, '-')
      .replace(/×/g, '*')
      .replace(/·/g, '*')
      .replace(/π/g, '\\pi');

    const m = pre.match(
      /(?:(?<![A-Za-z'])[fgh]\s*\(\s*x\s*\)|(?<![A-Za-z])y)\s*=\s*([A-Za-z0-9_ \t+\-*/^()\\{}\[\].²³]+)/
    );
    if (!m || !m[1]) continue;

    let expr = m[1];
    for (let i = 0; i < 4; i++) {
      const next = expr
        .replace(/\^\{([A-Za-z0-9]+)\}/g, '^$1')
        .replace(/\^\{([^{}]+)\}/g, '^($1)')
        .replace(/\\(?:[dt])?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
        .replace(/([0-9A-Za-z)])\s*(?=\\sqrt\b)/g, '$1*')
        .replace(/\\sqrt\[([^\]]+)\]\s*\{([^{}]+)\}/g, '(($2)^(1/($1)))')
        .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)');
      if (next === expr) break;
      expr = next;
    }

    expr = expr
      .replace(/\\arc(sin|cos|tan)\b/g, '\\a$1')
      .replace(/([0-9A-Za-z)])\s*\\(pi|exp|ln|log|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh)\b/g, '$1*$2')
      .replace(/\\cdot\b|\\times\b/g, '*')
      .replace(/\\div\b/g, '/')
      .replace(/\\pi\b/g, 'pi')
      .replace(/\\exp\b/g, 'exp')
      .replace(/\\ln\b/g, 'ln')
      .replace(/\\log\b/g, 'log')
      .replace(/\\(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan)\b/g, '$1')
      .replace(/\b(ln|log|asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|exp)\s+([A-Za-z0-9]+)\b/g, '$1($2)')
      .replace(/(\d|\))\s*pi\b/g, '$1*pi')
      .replace(/\bpi\s*(?=[A-Za-z(])/g, 'pi*')
      .replace(/\)\s*(?=[A-Za-z(])/g, ')*')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/[${}\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const eqIdx = expr.indexOf('=');
    if (eqIdx > 0) expr = expr.slice(0, eqIdx).trim();
    expr = expr.replace(/[.,;，。；\s]+$/, '');

    const wordTokens: string[] = expr.match(/[A-Za-z_]+/g) || [];
    const hasValidUnivariateIds =
      wordTokens.length > 0 &&
      wordTokens.includes('x') &&
      wordTokens.every((tok) => ALLOWED_PLOT_IDS.has(tok));

    if (
      expr &&
      expr.length <= 96 &&
      hasBalancedParens(expr) &&
      !/[+\-*/^]$/.test(expr) &&
      hasValidUnivariateIds &&
      !/[\u4e00-\u9fa5]/.test(expr)
    ) {
      return expr;
    }
  }
  return '';
}
