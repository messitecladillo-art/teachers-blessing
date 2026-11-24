import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  className?: string;
  inline?: boolean;
}

function formatPlainSegment(raw: string): string {
  const escaped = raw
    .replace(/\\\$/g, '$')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

/**
 * Splits text into math tokens ($$...$$, \[...\], \(...\), and unescaped $...$) and plain text tokens
 * so HTML line breaks and bold rules never corrupt KaTeX inline <svg><path d="..."/></svg> geometry.
 */
export const MathText: React.FC<MathTextProps> = ({ text, className = '', inline = false }) => {
  const html = useMemo(() => {
    if (!text) return '';
    const input = String(text);
    const tokenRe =
      /((?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?:\\.|[^\\\n$])+?(?<!\\)\$)/g;
    const out: string[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = tokenRe.exec(input)) !== null) {
      if (m.index > lastIdx) {
        out.push(formatPlainSegment(input.slice(lastIdx, m.index)));
      }
      const rawTok = m[0];
      const isDisplay = rawTok.startsWith('$$') || rawTok.startsWith('\\[');
      const isParenOrBracket =
        rawTok.startsWith('$$') || rawTok.startsWith('\\[') || rawTok.startsWith('\\(');
      const tex = isParenOrBracket ? rawTok.slice(2, -2) : rawTok.slice(1, -1);
      try {
        const rendered = katex.renderToString(tex, {
          displayMode: isDisplay && !inline,
          throwOnError: false,
        });
        out.push(
          isDisplay && !inline
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
  }, [text, inline]);

  const Tag = inline ? 'span' : 'div';
  return (
    <Tag
      className={`math-text ${className}`.trim()}
      style={inline ? { color: 'inherit' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
