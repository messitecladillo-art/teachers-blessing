import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ai-client.js', import.meta.url), 'utf8');
function client(overrides = {}) {
  const context = vm.createContext({ fetch: async () => Response.json({ choices: [{ message: { content: 'draft' } }] }), ...overrides });
  vm.runInContext(source, context, { filename: 'ai-client.js' });
  return context.TeachingAI;
}

test('chat uses the same-origin proxy and does not serialize signal or key', async () => {
  let seen;
  const controller = new AbortController();
  const ai = client({ fetch: async (url, options) => { seen = { url, options }; return Response.json({ choices: [{ message: { content: 'draft' } }] }); } });
  const result = await ai.chat({ messages: [{ role: 'user', content: 'lesson' }], model: 'allowed-model', temperature: 0.4, signal: controller.signal, apiKey: 'ignored-caller-key', apiUrl: 'https://ignored.invalid' });
  assert.equal(result.choices[0].message.content, 'draft');
  assert.equal(seen.url, '/api/ai/chat');
  assert.equal(seen.options.signal, controller.signal);
  assert.equal(seen.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(seen.options.body), { messages: [{ role: 'user', content: 'lesson' }], model: 'allowed-model', temperature: 0.4 });
  assert.equal(seen.options.headers.Authorization, undefined);
});

test('model is omitted by default instead of silently hardcoding a provider model', async () => {
  let sent;
  const ai = client({ fetch: async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ choices: [] }); } });
  await ai.chat({ messages: [{ role: 'user', content: 'lesson' }] });
  assert.equal(Object.hasOwn(sent, 'model'), false);
});

test('getConfig returns only the public configuration contract', async () => {
  let seen;
  const ai = client({ fetch: async (url, options) => { seen = { url, options }; return Response.json({ configured: false, model: '', allowedModels: [], extra: 'not part of client contract' }); } });
  const result = await ai.getConfig();
  assert.equal(seen.url, '/api/ai/config');
  assert.equal(seen.options.cache, 'no-store');
  assert.deepEqual(Object.keys(result).sort(), ['allowedModels', 'configured', 'model']);
  assert.equal(result.extra, undefined);
});

test('proxy error retains its safe message, code and HTTP status', async () => {
  const ai = client({ fetch: async () => Response.json({ error: { code: 'model_not_configured', message: '服务端未配置模型' } }, { status: 503 }) });
  await assert.rejects(ai.chat({ messages: [] }), error => error.status === 503 && error.code === 'model_not_configured' && error.message === '服务端未配置模型');
});

test('static host or non-JSON responses give an explicit local-server error', async () => {
  const ai = client({ fetch: async () => new Response('<html>static hosting 404</html>', { status: 404 }) });
  await assert.rejects(ai.getConfig(), error => error.code === 'invalid_proxy_response' && /npm start/.test(error.message));
});

test('HTML rendering fails closed when marked or sanitizer is absent', () => {
  const unsafe = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  for (const overrides of [{}, { marked: { parse: () => unsafe } }, { DOMPurify: { sanitize: () => '<p>clean</p>' } }]) {
    const ai = client(overrides);
    assert.equal(ai.renderMarkdown(unsafe), '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  }
  assert.equal(client().sanitizeHtml(unsafe), '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
});

test('Markdown is parsed then sanitized with HTML-only profile and forbidden active elements', () => {
  let received, policy;
  const ai = client({ marked: { parse: text => `<p>${text}</p><script>bad()</script>` }, DOMPurify: { sanitize: (html, options) => { received = html; policy = options; return '<p>clean</p>'; } } });
  assert.equal(ai.renderMarkdown('lesson'), '<p>clean</p>');
  assert.equal(received, '<p>lesson</p><script>bad()</script>');
  assert.equal(policy.USE_PROFILES.html, true);
  assert.equal(policy.ALLOW_UNKNOWN_PROTOCOLS, false);
  assert.ok(policy.FORBID_TAGS.includes('iframe'));
  assert.ok(policy.FORBID_TAGS.includes('svg'));
  assert.ok(policy.FORBID_ATTR.includes('style'));
});

test('parser and sanitizer exceptions fall back to escaped text', () => {
  const ai = client({ marked: { parse: () => { throw new Error('bad markdown'); } }, DOMPurify: { sanitize: () => { throw new Error('bad sanitizer'); } } });
  assert.equal(ai.renderMarkdown('<b>lesson</b>'), '&lt;b&gt;lesson&lt;/b&gt;');
  assert.equal(ai.sanitizeHtml('<b>lesson</b>'), '&lt;b&gt;lesson&lt;/b&gt;');
});

test('escaping handles quotes, ampersands and missing values', () => {
  const ai = client();
  assert.equal(ai.escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(ai.escapeHtml(null), '');
});
