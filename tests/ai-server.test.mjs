import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, loadConfig } from '../server.mjs';

const FAKE_KEY = 'unit-test-only-not-a-real-provider-key';
const baseConfig = { apiKey: FAKE_KEY, model: 'test-model', allowedModels: ['test-model', 'alternate-model'], timeoutMs: 1000 };
const completion = (content = '教学草稿') => Response.json({ id: 'test-receipt', model: 'test-model', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { total_tokens: 12 }, private_upstream_field: 'must-not-forward' });

async function start(t, options = {}) {
  const server = createServer({ config: baseConfig, fetch: async () => completion(), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, origin, post: (body = { messages: [{ role: 'user', content: '设计一项课堂活动' }] }, headers = {}) => fetch(`${origin}/api/ai/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}

function rawRequest(origin, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: pathname, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

test('metadata contains only public fields and no key', async t => {
  const { origin } = await start(t);
  const response = await fetch(`${origin}/api/ai/config`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ['allowedModels', 'configured', 'model']);
  assert.equal(data.configured, true);
  assert.equal(JSON.stringify(data).includes(FAKE_KEY), false);
});

test('without a key the API returns 503 and never calls upstream', async t => {
  let calls = 0;
  const { post } = await start(t, { config: { ...baseConfig, apiKey: '' }, fetch: async () => { calls++; return completion(); } });
  const response = await post();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'model_not_configured');
  assert.equal(calls, 0);
});

test('validated same-origin chat uses the fixed upstream and server key', async t => {
  let seen;
  const { post } = await start(t, { fetch: async (url, options) => { seen = { url, options }; return completion(); } });
  const response = await post({ messages: [{ role: 'system', content: '帮助教师' }, { role: 'user', content: '例题' }], model: 'alternate-model', temperature: 0.3 });
  assert.equal(response.status, 200);
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen.options.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(seen.options.redirect, 'error');
  assert.equal(JSON.parse(seen.options.body).model, 'alternate-model');
  assert.equal(JSON.parse(seen.options.body).max_tokens, 4096);
  const result = await response.json();
  assert.equal(result.choices[0].message.content, '教学草稿');
  assert.equal(result.private_upstream_field, undefined);
});

test('caller cannot override URL, key, headers, model policy or temperature', async t => {
  let calls = 0;
  const { post } = await start(t, { fetch: async () => { calls++; return completion(); } });
  const messages = [{ role: 'user', content: '课堂' }];
  for (const extra of [{ apiUrl: 'https://outside.invalid/chat/completions' }, { apiKey: 'caller-secret' }, { headers: {} }, { model: 'unapproved-model' }, { temperature: 3 }, { temperature: '0.5' }]) {
    assert.equal((await post({ messages, ...extra })).status, 400);
  }
  assert.equal(calls, 0);
});

test('missing, foreign and null origins and a rebinding host are rejected', async t => {
  const { post, origin } = await start(t);
  for (const Origin of ['https://foreign.invalid', 'null', '']) assert.equal((await post(undefined, { Origin })).status, 403);
  const result = await rawRequest(origin, '/api/ai/config', { Host: 'attacker.invalid' });
  assert.equal(result.status, 403);
  assert.equal((await fetch(`${origin}/api/ai/config`, { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await post(undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('JSON, message and byte limits reject before external work', async t => {
  let calls = 0;
  const { post, origin } = await start(t, { config: { ...baseConfig, maxBodyBytes: 1024 }, fetch: async () => { calls++; return completion(); } });
  assert.equal((await post({ messages: [{ role: 'user', content: 'x'.repeat(2000) }] })).status, 413);
  assert.equal((await post({ messages: [{ role: 'tool', content: 'not allowed' }] })).status, 400);
  assert.equal((await post({ messages: [{ role: 'assistant', content: 'no user question' }] })).status, 400);
  assert.equal((await fetch(`${origin}/api/ai/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${origin}/api/ai/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal(calls, 0);
});

test('chunked bodies without Content-Length still obey the byte bound', async t => {
  let calls = 0;
  const { origin } = await start(t, { config: { ...baseConfig, maxBodyBytes: 512 }, fetch: async () => { calls++; return completion(); } });
  const result = await new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, method: 'POST', path: '/api/ai/chat', headers: { Origin: origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.write('{"messages":[{"role":"user","content":"'); req.write('x'.repeat(900)); req.end('"}]}');
  });
  assert.equal(result.status, 413); assert.equal(result.data.error.code, 'body_too_large'); assert.equal(calls, 0);
});

test('message count, per-message and aggregate text limits are enforced', async t => {
  let calls = 0;
  const { post } = await start(t, { fetch: async () => { calls++; return completion(); } });
  for (const messages of [Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })), [{ role: 'user', content: 'x'.repeat(24001) }], Array.from({ length: 3 }, () => ({ role: 'user', content: 'x'.repeat(22000) }))]) {
    assert.equal((await post({ messages })).status, 400);
  }
  assert.equal(calls, 0);
});

test('upstream failures never expose body, key or exception details', async t => {
  const marker = 'private-vendor-debug-information';
  const { post } = await start(t, { fetch: async () => new Response(`${marker} ${FAKE_KEY}`, { status: 401 }) });
  const response = await post();
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes(marker), false);
  assert.equal(text.includes(FAKE_KEY), false);
  assert.equal(JSON.parse(text).error.code, 'upstream_error');
});

test('network exception details and successful secret echoes are blocked', async t => {
  let attempt = 0;
  const { post } = await start(t, { fetch: async () => { if (++attempt === 1) throw new Error(`private ${FAKE_KEY}`); return completion(`echo ${FAKE_KEY}`); } });
  for (let index = 0; index < 2; index++) {
    const response = await post(); assert.equal(response.status, 502);
    assert.equal((await response.text()).includes(FAKE_KEY), false);
  }
});

test('provider rate limit has a generic 429 without automatic retries', async t => {
  let calls = 0;
  const { post } = await start(t, { fetch: async () => { calls++; return new Response('private rate-limit detail', { status: 429 }); } });
  const response = await post();
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'upstream_rate_limited');
  assert.equal(calls, 1);
});

test('upstream timeout aborts the call and returns 504', async t => {
  let aborted = false;
  const { post } = await start(t, { config: { ...baseConfig, timeoutMs: 25 }, fetch: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('mock abort')); }, { once: true })) });
  const response = await post();
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'upstream_timeout');
  assert.equal(aborted, true);
});

test('overall deadline also bounds a stalled response body', async t => {
  const { post } = await start(t, { config: { ...baseConfig, timeoutMs: 25 }, fetch: async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }) });
  const response = await post();
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'upstream_timeout');
});

test('response size and response shape are bounded', async t => {
  let attempt = 0;
  const { post } = await start(t, { config: { ...baseConfig, maxResponseBytes: 256 }, fetch: async () => ++attempt === 1 ? completion('x'.repeat(1000)) : Response.json({ choices: [] }) });
  assert.equal((await post()).status, 502);
  assert.equal((await post()).status, 502);
});

test('concurrent request limit does not dispatch extra model work', async t => {
  let release, started;
  const gate = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const { post } = await start(t, { config: { ...baseConfig, maxConcurrent: 1 }, fetch: async () => { calls++; started(); return new Promise(resolve => { release = () => resolve(completion()); }); } });
  const first = post(); await gate;
  const second = await post(); assert.equal(second.status, 429); assert.equal(calls, 1);
  release(); assert.equal((await first).status, 200);
});

test('static whitelist denies secrets, source, traversal and symlinks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'teaching-proxy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets')); await mkdir(path.join(root, 'data')); await mkdir(path.join(root, 'platform'));
  await writeFile(path.join(root, 'index.html'), '<p>public page</p>');
  await writeFile(path.join(root, 'assets', 'public.css'), 'body{}');
  await writeFile(path.join(root, 'data', 'content.json'), '{}');
  await writeFile(path.join(root, '.env'), 'private fixture, no credential');
  await writeFile(path.join(root, 'server.mjs'), 'server source fixture');
  await writeFile(path.join(root, 'platform', 'app.js'), 'private source fixture');
  const { origin } = await start(t, { root });
  for (const file of ['/', '/assets/public.css', '/data/content.json']) assert.equal((await fetch(origin + file)).status, 200);
  for (const file of ['/.env', '/.git/config', '/server.mjs', '/platform/app.js', '/tests/ai-server.test.mjs', '/assets/', '/assets/.env']) assert.equal((await rawRequest(origin, file)).status, 404);
  for (const file of ['/assets/../server.mjs', '/%2e%2e/.env', '/assets%5c..%5c.env', '/%252e%252e/.env']) assert.equal((await rawRequest(origin, file)).status, 400);
  assert.equal((await fetch(`${origin}/`, { method: 'HEAD' })).status, 200);
  try {
    await symlink(path.join(root, 'server.mjs'), path.join(root, 'assets', 'linked.js'));
    assert.equal((await fetch(`${origin}/assets/linked.js`)).status, 404);
  } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; t.diagnostic('Symlink creation unavailable on this Windows session; other path boundaries executed.'); }
});

test('operator URL and model config are checked without exposing values', () => {
  assert.throws(() => loadConfig({ EDU_AIGC_API_URL: 'http://outside.invalid/chat/completions' }));
  assert.throws(() => loadConfig({ EDU_AIGC_API_URL: 'https://user:password@outside.invalid/chat/completions' }));
  assert.throws(() => loadConfig({ EDU_AIGC_API_URL: 'https://outside.invalid/anything' }));
  assert.throws(() => loadConfig({ EDU_AIGC_MODEL: 'model-a', EDU_AIGC_ALLOWED_MODELS: 'model-b' }));
  assert.equal(loadConfig({}).apiKey, '');
  assert.equal(loadConfig({ EDU_AIGC_API_URL: 'http://127.0.0.1:9000/chat/completions' }).apiUrl, 'http://127.0.0.1:9000/chat/completions');
});
