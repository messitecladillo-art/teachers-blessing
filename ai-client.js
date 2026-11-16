(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function sanitizeHtml(html) {
    if (!global.DOMPurify || typeof global.DOMPurify.sanitize !== 'function') return escapeHtml(html);
    try {
      return String(global.DOMPurify.sanitize(String(html ?? ''), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math'],
        FORBID_ATTR: ['style', 'srcset'],
        ALLOW_DATA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
      }));
    } catch { return escapeHtml(html); }
  }

  function renderMarkdown(text) {
    const source = String(text ?? '');
    if (!global.marked || typeof global.marked.parse !== 'function' || !global.DOMPurify || typeof global.DOMPurify.sanitize !== 'function') return escapeHtml(source);
    try {
      const html = global.marked.parse(source, { async: false });
      return typeof html === 'string' ? sanitizeHtml(html) : escapeHtml(source);
    } catch { return escapeHtml(source); }
  }

  async function readResponse(response) {
    let data;
    try { data = await response.json(); } catch {
      const error = new Error('本站AI代理未返回有效JSON。请通过npm start启动本地服务。');
      error.code = 'invalid_proxy_response'; error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(typeof data?.error?.message === 'string' ? data.error.message : '模型请求失败，请稍后重试。');
      error.code = typeof data?.error?.code === 'string' ? data.error.code : 'proxy_error';
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function getConfig() {
    const response = await global.fetch('/api/ai/config', { credentials: 'same-origin', cache: 'no-store' });
    const data = await readResponse(response);
    if (!data || typeof data.configured !== 'boolean' || typeof data.model !== 'string' || !Array.isArray(data.allowedModels) || data.allowedModels.some(model => typeof model !== 'string')) throw new Error('本站模型配置格式无效。');
    return { configured: data.configured, model: data.model, allowedModels: data.allowedModels.slice() };
  }

  async function chat(options) {
    if (!options || !Array.isArray(options.messages)) throw new Error('请提供messages对话数组。');
    const body = { messages: options.messages };
    if (options.model !== undefined && options.model !== '') body.model = options.model;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    const response = await global.fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal });
    return readResponse(response);
  }

  global.TeachingAI = Object.freeze({ chat: chat, getConfig: getConfig, escapeHtml: escapeHtml, renderMarkdown: renderMarkdown, sanitizeHtml: sanitizeHtml });
})(typeof window !== 'undefined' ? window : globalThis);
