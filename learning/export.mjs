import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_CHARS = 2000000;
const MAX_BYTES = 4000000;
const cache = new Map();
const escapeHtml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const inlineScript = text => text.replace(/<\/script/gi, '<\\/script').replace(/\/\/[#@]\s*sourceMappingURL=[^\r\n]*/g, '');

function failure(code, message, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}

async function fixedFile(root, relative, maximum = 2200000) {
  const filename = path.join(root, 'assets', 'vendor', relative);
  const info = await stat(filename);
  if (!info.isFile() || info.size > maximum) throw new Error('Invalid fixed export asset');
  return readFile(filename);
}

async function loadAssets(root) {
  const names = ['marked.min.js', 'purify.min.js', 'katex/katex.min.js', 'katex/auto-render.min.js', 'katex/katex.min.css', 'Marked-LICENSE', 'DOMPurify-LICENSE', 'katex/LICENSE'];
  const values = await Promise.all(names.map(name => fixedFile(root, name)));
  let css = values[4].toString('utf8');
  const fonts = new Map();
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)];
  if (!faces.length || /@import/i.test(css)) throw new Error('Unsupported export stylesheet');
  for (const [face] of faces) {
    const font = face.match(/url\(["']?fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)["']?\)/)?.[1];
    if (!font) throw new Error('Missing fixed woff2 export font');
    if (!fonts.has(font)) fonts.set(font, await fixedFile(root, `katex/fonts/${font}`, 200000));
    const embedded = face.replace(/src:[^;}]+/, `src:url(data:font/woff2;base64,${fonts.get(font).toString('base64')}) format("woff2")`);
    css = css.replace(face, embedded);
  }
  css = css.replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');
  if ([...css.matchAll(/url\(([^)]*)\)/g)].some(match => !match[1].startsWith('data:font/woff2;base64,')) || /<\/style/i.test(css)) throw new Error('External export stylesheet resource');
  return {
    scripts: values.slice(0, 4).map(value => value.toString('utf8').replace(/\/\/[#@]\s*sourceMappingURL=[^\r\n]*/g, '')), css,
    licenses: values.slice(5).map((value, index) => ({ name: ['Marked 15.0.12 — MIT', 'DOMPurify 3.4.18 — Apache-2.0 OR MPL-2.0', 'KaTeX 0.19.1 — MIT'][index], text: value.toString('utf8') })),
    files: names.map((name, index) => ({ name, sha256: createHash('sha256').update(values[index]).digest('hex') })),
    fontCount: fonts.size,
  };
}

async function assetsAt(root) {
  if (!cache.has(root)) {
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    const loading = loadAssets(root).catch(() => { cache.delete(root); throw failure('EXPORT_ASSETS_UNAVAILABLE', '离线导出资源缺失或不符合固定资源要求，请联系管理员。', 503); });
    cache.set(root, loading);
  }
  return cache.get(root);
}

function offlineRuntime() {
  'use strict';
  const source = JSON.parse(document.getElementById('learning-source').textContent);
  const target = document.getElementById('learning-content');
  const status = document.getElementById('render-status');
  const tokenPrefix = 'OFFLINEMATH' + source.token + 'X';
  const formulas = [];
  let mathNotice = '';
  const escapedAt = (text, index) => { let count = 0; while (index > 0 && text[--index] === '\\') count++; return count % 2 === 1; };
  function protectMath(text) {
    const parts = []; let cursor = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '\\' && (text[index + 1] === '\\' || text[index + 1] === '$')) { index++; continue; }
      let open = ''; let close = '';
      if (text.startsWith('$$', index)) { open = '$$'; close = '$$'; }
      else if (text[index] === '$') { open = '$'; close = '$'; }
      else if (text.startsWith('\\[', index)) { open = '\\['; close = '\\]'; }
      else if (text.startsWith('\\(', index)) { open = '\\('; close = '\\)'; }
      if (!open) continue;
      let end = text.indexOf(close, index + open.length);
      while (end >= 0 && escapedAt(text, end)) end = text.indexOf(close, end + close.length);
      if (end < 0 || end - index > 8000 || formulas.length >= 500) {
        mathNotice = '部分公式未闭合，或超过 500 处 / 单式 8000 字符限制；本页公式保留为文本，请核对。';
        formulas.length = 0; return text;
      }
      end += close.length;
      const raw = text.slice(index, end);
      parts.push(text.slice(cursor, index), tokenPrefix + formulas.length + 'END');
      formulas.push(raw); cursor = end; index = end - 1;
    }
    parts.push(text.slice(cursor)); return parts.join('');
  }
  function restoreMath() {
    const pattern = new RegExp(tokenPrefix + '(\\d+)END', 'g');
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const nodes = []; const mathNodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.textContent; pattern.lastIndex = 0;
      let match; let offset = 0; const fragment = document.createDocumentFragment();
      while ((match = pattern.exec(value))) {
        const span = document.createElement('span');
        span.textContent = formulas[Number(match[1])] ?? match[0];
        if (!node.parentElement.closest('pre,code')) mathNodes.push(span);
        fragment.append(document.createTextNode(value.slice(offset, match.index)), span);
        offset = pattern.lastIndex;
      }
      if (offset) { fragment.append(document.createTextNode(value.slice(offset))); node.replaceWith(fragment); }
    }
    return mathNodes;
  }
  try {
    const prepared = protectMath(source.content);
    const html = window.marked.parse(prepared, { async: false, gfm: true, breaks: false });
    const clean = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','pre','code','em','strong','del','s','table','thead','tbody','tfoot','tr','th','td','a','sup','sub','details','summary','span','div'],
      ALLOWED_ATTR: ['href','title','start','colspan','rowspan','align'],
      FORBID_TAGS: ['script','style','iframe','frame','form','input','button','textarea','select','option','svg','math','img','picture','audio','video','source','link','meta','base','object','embed','template'],
      FORBID_ATTR: ['style','src','srcset','id','name'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    target.innerHTML = clean;
    for (const link of target.querySelectorAll('a')) {
      const href = link.getAttribute('href') || '';
      try {
        const url = new URL(href);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported link');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      } catch { link.removeAttribute('href'); }
    }
    const mathNodes = formulas.length ? restoreMath() : [];
    if (!mathNotice) for (const node of mathNodes) window.renderMathInElement(node, {
      delimiters: [{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],
      trust: false, strict: 'error', throwOnError: false, maxExpand: 200, maxSize: 20, macros: {},
      errorCallback: () => { mathNotice = '部分数学表达式无法渲染，已保留文本或错误标记，请核对。'; },
    });
    status.textContent = mathNotice || '离线副本 · 已保存内容 · 未重新调用模型';
    target.dataset.rendered = 'true';
  } catch {
    target.textContent = source.content;
    status.textContent = '排版失败，已安全显示 Markdown 原文。';
    target.dataset.rendered = 'fallback';
  }
  document.getElementById('print-learning').addEventListener('click', () => window.print());
}

/** Render persisted Markdown only. root is trusted operator configuration, never request input. */
export async function renderOfflineLearningHtml(input, { root = DEFAULT_ROOT } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.content !== 'string' || (input.title !== undefined && typeof input.title !== 'string') || typeof root !== 'string') throw failure('EXPORT_INVALID_INPUT', '离线导出需要标题和已保存的 Markdown 文本。');
  const title = input.title?.trim() || '学习产物';
  if (title.length > 240) throw failure('EXPORT_INVALID_INPUT', '导出标题不得超过 240 字符。');
  if (input.content.length > MAX_CHARS || Buffer.byteLength(input.content, 'utf8') > MAX_BYTES) throw failure('EXPORT_TOO_LARGE', '离线正文最多 2000000 字符且不超过 4000000 UTF-8 字节。');
  const assets = await assetsAt(path.resolve(root));
  const nonce = randomBytes(24).toString('base64');
  const token = randomBytes(18).toString('hex');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const licenses = assets.licenses.map(license => `<details><summary>${escapeHtml(license.name)}</summary><pre>${escapeHtml(license.text)}</pre></details>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${assets.css}
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f5ef;color:#26362b;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:35px auto;background:white;padding:42px 50px;border:1px solid #dce1d5;border-radius:12px}header{border-bottom:1px solid #dce1d5;padding-bottom:20px;margin-bottom:25px}h1{font-size:28px;line-height:1.5;overflow-wrap:anywhere}button{font:inherit;background:#365b3b;color:white;border:0;border-radius:6px;padding:9px 16px;cursor:pointer}.meta,footer{font-size:12px;color:#63705e}.prose{overflow-wrap:anywhere}.prose h2{margin-top:32px}.prose pre,footer pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4ef;padding:16px;font:13px/1.7 Consolas,monospace}.prose code{font-family:Consolas,monospace}.prose blockquote{border-left:3px solid #9eb58c;padding-left:18px;margin-left:0}.prose table{width:100%;border-collapse:collapse}.prose td,.prose th{border:1px solid #dce1d5;padding:8px}.prose a{color:#305d9a}.katex-display{overflow:auto;padding:5px 0}footer{margin-top:45px;border-top:1px solid #dce1d5;padding-top:20px}footer pre{max-height:350px;overflow:auto}noscript pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){main{margin:0;padding:25px 20px;border:0;border-radius:0}h1{font-size:24px}}@media print{@page{size:A4;margin:18mm}body{background:white;font-size:11pt}main{max-width:none;border:0;padding:0;margin:0}button,.no-print,footer{display:none!important}header{break-after:avoid}h1,h2,h3{break-after:avoid}pre,blockquote,tr{break-inside:avoid}.katex-display{overflow:visible}}
</style></head><body><main><header><p class="meta">学习产物 · 单文件离线副本</p><h1>${escapeHtml(title)}</h1><p id="render-status" class="meta">正在本机排版；内容来自已保存记录。</p><button type="button" id="print-learning">打印 / 存为 PDF</button><p class="meta no-print">图片、音视频和嵌入页面已禁用。外部链接仅在您点击后打开。PDF 由浏览器打印功能生成，请核对分页。</p></header><article id="learning-content" class="prose"></article><noscript><p>JavaScript 已禁用，以下为安全转义的 Markdown 原文。</p><pre>${escapeHtml(input.content)}</pre></noscript><footer><p>自有学习产物离线模板 v1。包含 Marked 15.0.12、DOMPurify 3.4.18、KaTeX 0.19.1；${assets.fontCount} 个 WOFF2 字体已内嵌。本导出不连接模型或远程资源，不代表内容已经事实审核。</p>${licenses}<details><summary>内嵌资源校验记录</summary><pre>${escapeHtml(JSON.stringify(assets.files, null, 2))}</pre></details></footer></main>
<script type="application/json" id="learning-source" nonce="${nonce}">${jsonForScript({ content: input.content, token })}</script>
<script nonce="${nonce}">(function(){const nonce=document.currentScript.nonce;for(const text of ${jsonForScript(assets.scripts)}){const script=document.createElement('script');script.nonce=nonce;script.textContent=text;document.head.appendChild(script);}(${inlineScript(offlineRuntime.toString())})();})();</script></body></html>`;
}
