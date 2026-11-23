import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  className?: string;
}

function formatPlainSegment(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

/**
 * Splits text into math tokens ($$...$$ / $...$) and plain text tokens so HTML line breaks
 * and bold rules never corrupt KaTeX inline <svg><path d="..."/></svg> geometry.
 */
export const MathText: React.FC<MathTextProps> = ({ text, className = '' }) => {
  const html = useMemo(() => {
    if (!text) return '';
    const input = String(text);
    const tokenRe = /(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$)/g;
    const out: string[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = tokenRe.exec(input)) !== null) {
      if (m.index > lastIdx) {
        out.push(formatPlainSegment(input.slice(lastIdx, m.index)));
      }
      const rawTok = m[0];
      const isDisplay = rawTok.startsWith('$$');
      const tex = isDisplay ? rawTok.slice(2, -2) : rawTok.slice(1, -1);
      try {
        const rendered = katex.renderToString(tex, {
          displayMode: isDisplay,
          throwOnError: false,
        });
        out.push(
          isDisplay
            ? `<div class="katex-block-wrap" style="margin:6px 0;overflow-x:auto;">${rendered}</div>`
            : rendered
        );
      } catch {
        out.push(`<code>${formatPlainSegment(tex)}</code>`);
      }
      lastIdx = m.index + rawTok.length;
    }

    if (lastIdx < input.length) {
      out.push(formatPlainSegment(input.slice(lastIdx)));
    }
    return out.join('');
  }, [text]);

  return <div className={`math-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
};
