/* Bounded Markdown + math rendering. Only DOMPurify-clean HTML and own text nodes enter the reader. */
(() => {
  'use strict';
  const MAX_SOURCE = 60000, MAX_FORMULAS = 500, MAX_FORMULA = 8000;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const plain = (source, message) => `<p class="small muted study-render-notice">${escapeHtml(message)}</p><pre>${escapeHtml(source)}</pre>`;
  const notice = '公式超过 500 处或单式 8000 字符预算，已保留 Markdown 原文，请核对。';

  function markerFor(source) {
    if (!window.crypto?.getRandomValues) return null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      const marker = 'STUDYMATH' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') + 'X';
      if (!source.includes(marker)) return marker;
    }
    return null;
  }
  function tagEnd(source, start) {
    let quote = '';
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') return index + 1;
    }
    return source.length;
  }
  function fenceAt(line) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    return match ? { char: match[1][0], length: match[1].length, rest: line.slice(match[0].length) } : null;
  }
  function fencedEnd(source, start, opener) {
    let index = source.indexOf('\n', start);
    if (index < 0) return source.length;
    index++;
    while (index < source.length) {
      const next = source.indexOf('\n', index), end = next < 0 ? source.length : next;
      const fence = fenceAt(source.slice(index, end));
      if (fence?.char === opener.char && fence.length >= opener.length && !fence.rest.trim()) return next < 0 ? end : end + 1;
      index = end + 1;
    }
    return source.length;
  }
  function codeSpanEnd(source, index) {
    let count = 1; while (source[index + count] === '`') count++;
    const delimiter = '`'.repeat(count);
    let closing = source.indexOf(delimiter, index + count);
    while (closing >= 0 && (source[closing - 1] === '`' || source[closing + count] === '`')) closing = source.indexOf(delimiter, closing + count);
    return closing < 0 ? index + count : closing + count;
  }
  function escapedAt(source, index) { let count = 0; while (index > 0 && source[--index] === '\\') count++; return count % 2 === 1; }

  function protect(source, marker) {
    const tokens = [], parts = []; let cursor = 0, unmatched = false;
    const lower = source.toLowerCase();
    for (let index = 0; index < source.length; index++) {
      if (index === 0 || source[index - 1] === '\n') {
        const lineEnd = source.indexOf('\n', index), line = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
        const fence = fenceAt(line);
        if (fence) { index = fencedEnd(source, index, fence) - 1; continue; }
      }
      if (source[index] === '`') { index = codeSpanEnd(source, index) - 1; continue; }
      if (source[index] === '<') {
        const code = source.slice(index, index + 12).match(/^<(pre|code)(?=[\s>])/i);
        if (code) {
          const end = lower.indexOf('</' + code[1].toLowerCase(), tagEnd(source, index));
          index = (end < 0 ? source.length : tagEnd(source, end)) - 1; continue;
        }
        if (/^<\/?[a-z!]/i.test(source.slice(index, index + 4))) { index = tagEnd(source, index) - 1; continue; }
      }
      // A Markdown link destination is data, including any dollar signs inside its URL.
      if (source[index] === '(' && source[index - 1] === ']') {
        let depth = 1, end = index + 1;
        for (; end < source.length && depth; end++) {
          if (source[end] === '\\') { end++; continue; }
          if (source[end] === '(') depth++;
          if (source[end] === ')') depth--;
        }
        index = end - 1; continue;
      }
      if (source[index] === '\\' && (source[index + 1] === '\\' || source[index + 1] === '$')) { index++; continue; }
      let open = '', close = '';
      if (source.startsWith('$$', index)) { open = '$$'; close = '$$'; }
      else if (source[index] === '$') { open = '$'; close = '$'; }
      else if (source.startsWith('\\[', index)) { open = '\\['; close = '\\]'; }
      else if (source.startsWith('\\(', index)) { open = '\\('; close = '\\)'; }
      if (!open) continue;
      let end = source.indexOf(close, index + open.length);
      while (end >= 0 && escapedAt(source, end)) end = source.indexOf(close, end + close.length);
      const valid = end >= 0;
      end = valid ? end + close.length : index + open.length;
      if (end - index > MAX_FORMULA || tokens.length >= MAX_FORMULAS) return { budget: true };
      parts.push(source.slice(cursor, index), marker + tokens.length + 'END');
      tokens.push({ text: source.slice(index, end), math: valid });
      if (!valid) unmatched = true;
      cursor = end; index = end - 1;
    }
    parts.push(source.slice(cursor));
    return { text: parts.join(''), tokens, unmatched };
  }

  function markdown(value) {
    const source = String(value ?? '');
    if (source.length > MAX_SOURCE) return plain(source, '文本超过 60000 字符数学排版预算，已完整保留 Markdown 原文。');
    if (!window.marked?.parse || !window.DOMPurify?.sanitize || !window.TeachingAI?.renderMarkdown) return plain(source, '安全排版资源不可用，已保留 Markdown 原文。');
    const marker = markerFor(source);
    if (!marker) return plain(source, '无法安全隔离数学片段，已保留 Markdown 原文。');
    try {
      const protectedSource = protect(source, marker);
      if (protectedSource.budget) return plain(source, notice);
      const container = document.createElement('div');
      container.innerHTML = window.TeachingAI.renderMarkdown(protectedSource.text);
      // Never accept a source-supplied rendering capability, even if sanitizer policy changes.
      container.querySelectorAll('[data-study-render],[data-study-render-notice]').forEach(node => { node.removeAttribute('data-study-render'); node.removeAttribute('data-study-render-notice'); });
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const pattern = new RegExp(marker + '(\\d+)END', 'g');
      for (const node of nodes) {
        const value = node.textContent; pattern.lastIndex = 0; let match, offset = 0;
        const fragment = document.createDocumentFragment();
        while ((match = pattern.exec(value))) {
          fragment.append(document.createTextNode(value.slice(offset, match.index)));
          const token = protectedSource.tokens[Number(match[1])];
          if (token?.math && !node.parentElement.closest('pre,code')) {
            const span = document.createElement('span'); span.dataset.studyRender = 'math-v1'; span.textContent = token.text; fragment.append(span);
          } else fragment.append(document.createTextNode(token?.text ?? match[0]));
          offset = pattern.lastIndex;
        }
        if (offset) { fragment.append(document.createTextNode(value.slice(offset))); node.replaceWith(fragment); }
      }
      if (protectedSource.unmatched) {
        const warning = document.createElement('p'); warning.className = 'small muted study-render-notice';
        warning.textContent = '部分公式分隔符未闭合，已保留字面量，请核对。'; container.append(warning);
      }
      return container.innerHTML;
    } catch { return plain(source, '排版失败，已安全保留 Markdown 原文。'); }
  }

  function paint(scope) {
    if (!scope?.querySelectorAll || typeof window.renderMathInElement !== 'function') return;
    const sources = [...(scope.matches?.('.prose') ? [scope] : []), ...scope.querySelectorAll('.prose')];
    let remaining = MAX_FORMULAS;
    for (const source of sources) {
      if (source.textContent.length > MAX_SOURCE) continue;
      const formulas = [...source.querySelectorAll('span[data-study-render="math-v1"]')];
      let limited = false;
      for (const node of formulas) {
        if (node.closest('pre,code') || node.childElementCount || node.textContent.length > MAX_FORMULA) continue;
        if (remaining <= 0) { limited = true; break; }
        remaining--;
        try {
          window.renderMathInElement(node, {
            delimiters: [{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],
            trust: false, strict: 'error', throwOnError: false, maxExpand: 200, maxSize: 20, macros: {}, errorCallback: () => {},
          });
          node.dataset.studyRender = 'painted-v1';
        } catch { node.dataset.studyRender = 'failed-v1'; }
      }
      if (limited && !source.querySelector('[data-study-render-notice]')) {
        const warning = document.createElement('p'); warning.className = 'small muted study-render-notice'; warning.dataset.studyRenderNotice = 'limit';
        warning.textContent = '本次排版达到 500 处公式上限，余下公式保留原文，请核对。'; source.append(warning);
      }
      if (!limited && !source.querySelector('span[data-study-render="math-v1"]')) source.querySelectorAll('[data-study-render-notice]').forEach(node => node.remove());
    }
  }
  window.StudyRender = Object.freeze({ markdown, paint });
})();
