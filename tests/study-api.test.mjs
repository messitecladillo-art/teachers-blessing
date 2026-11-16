import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudyStore } from '../learning/store.mjs';
import { createStudyHandler } from '../learning/api.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'study-core-test-'));
  const dataDir = path.join(root, 'private');
  const store = createStudyStore({ dataDir });
  const handler = createStudyHandler({ dataDir, store, service: { handle: async () => false }, ...options });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://local.invalid').pathname)) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const request = async (route, { method = 'GET', body, cookie } = {}) => {
    const response = await fetch(origin + '/api/v1' + route, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], setCookie: response.headers.get('set-cookie'), value: await response.json() };
  };
  const signup = async (name = 'a') => { const result = await request('/auth/register', { method: 'POST', body: { email: `${name}@example.test`, nickname: `合成用户${name}`, password: 'test-password-123' } }); assert.equal(result.status, 201); return { cookie: result.cookie, user: result.value.data.user }; };
  return { dataDir, root, store, handler, request, signup, origin };
}

test('store and handler are lazy and unrelated routes do not create storage', async t => {
  const f = await fixture(t);
  assert.equal(await f.handler({ url: '/outside' }, {}, '/outside'), false);
  await assert.rejects(stat(f.dataDir), { code: 'ENOENT' });
  const config = await f.request('/config/public'); assert.equal(config.status, 200);
  assert.equal(config.value.data.smsConfigured, false); assert.equal(config.value.data.paymentConfigured, false);
  await assert.rejects(stat(f.dataDir), { code: 'ENOENT' });
  assert.equal((await f.request('/textbooks')).status, 401);
  await assert.rejects(stat(f.dataDir), { code: 'ENOENT' });
});

test('register/login store salted hashes and hashed random sessions, not secrets', async t => {
  const f = await fixture(t), a = await f.signup('a'), b = await f.signup('b');
  assert.match(a.cookie, /^edu_study_session=[a-f0-9]{64}$/);
  assert.notEqual(a.cookie, b.cookie);
  const login = await f.request('/auth/login-password', { method: 'POST', body: { email: 'a@example.test', password: 'test-password-123' } });
  assert.equal(login.status, 200); assert.match(login.setCookie, /HttpOnly/); assert.match(login.setCookie, /SameSite=Strict/);
  assert.equal((await f.request('/auth/login-password', { method: 'POST', body: { email: 'a@example.test', password: 'wrong-password' } })).status, 401);
  const disk = await readFile(path.join(f.dataDir, 'study.json'), 'utf8');
  assert.equal(disk.includes('test-password-123'), false); assert.equal(disk.includes(a.cookie.split('=')[1]), false);
  const state = JSON.parse(disk); assert.notEqual(state.users[0].passwordHash, state.users[1].passwordHash);
  assert.equal(login.value.data.user.passwordHash, undefined);
});

test('sessions rotate, expire server-side and log out', async t => {
  let time = Date.now();
  const f = await fixture(t, { clock: () => time, sessionTtlMs: 5000 }); const a = await f.signup();
  const refreshed = await f.request('/auth/refresh', { method: 'POST', cookie: a.cookie }); assert.equal(refreshed.status, 200);
  assert.equal((await f.request('/users/me', { cookie: a.cookie })).status, 401);
  assert.equal((await f.request('/users/me', { cookie: refreshed.cookie })).status, 200);
  time += 5001; assert.equal((await f.request('/users/me', { cookie: refreshed.cookie })).status, 401);
  const login = await f.request('/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'test-password-123' } });
  const logout = await f.request('/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.match(logout.setCookie, /Max-Age=0/); assert.equal((await f.request('/users/me', { cookie: login.cookie })).status, 401);
});

test('password replacement revokes all existing sessions', async t => {
  const f = await fixture(t), a = await f.signup();
  const other = await f.request('/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'test-password-123' } });
  const changed = await f.request('/users/me/change-password', { method: 'POST', cookie: a.cookie, body: { currentPassword: 'test-password-123', newPassword: 'replacement-test-password' } });
  assert.equal(changed.status, 200); assert.equal((await f.request('/users/me', { cookie: other.cookie })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'test-password-123' } })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { email: 'a@example.test', password: 'replacement-test-password' } })).status, 200);
});

test('folders and books enforce owners, explicit revision and parent ownership', async t => {
  const f = await fixture(t), a = await f.signup('a'), b = await f.signup('b');
  const folder = (await f.request('/folders', { method: 'POST', cookie: a.cookie, body: { name: '数学' } })).value.data;
  assert.equal((await f.request('/textbooks', { method: 'POST', cookie: b.cookie, body: { title: '越权', folderId: folder.id } })).status, 404);
  const book = (await f.request('/textbooks', { method: 'POST', cookie: a.cookie, body: { title: '统计教材', folderId: folder.id } })).value.data;
  for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await f.request(`/textbooks/${book.id}`, { method, cookie: b.cookie, ...(method === 'PATCH' ? { body: { title: '不应修改' } } : {}) })).status, 404);
  assert.equal((await f.request('/textbooks', { cookie: b.cookie })).value.data.items.length, 0);
  assert.equal((await f.request(`/textbooks/${book.id}`, { method: 'PATCH', cookie: a.cookie, body: { title: '新名称', expectedRevision: 99 } })).status, 409);
  assert.equal((await f.request(`/textbooks/${book.id}`, { method: 'PATCH', cookie: a.cookie, body: { title: '新名称', expectedRevision: 1 } })).status, 200);
  assert.equal((await f.request(`/folders/${folder.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await f.request(`/textbooks/${book.id}`, { cookie: a.cookie })).value.data.folderId, null);
});

test('preferences and core data survive an independently opened store after restart', async t => {
  const f = await fixture(t), a = await f.signup();
  assert.equal((await f.request('/users/me/preferences', { method: 'PATCH', cookie: a.cookie, body: { theme: 'dark', fontScale: 1.2 } })).status, 200);
  assert.equal((await f.request('/users/me/preferences', { method: 'PATCH', cookie: a.cookie, body: { fontScale: 100 } })).status, 400);
  await f.request('/textbooks', { method: 'POST', cookie: a.cookie, body: { title: '重启仍保留' } });
  const restarted = createStudyStore({ dataDir: f.dataDir }), state = await restarted.snapshot();
  assert.equal(state.textbooks.length, 1); assert.equal(state.users[0].preferences.theme, 'dark');
  const newHandler = createStudyHandler({ dataDir: f.dataDir, store: restarted, service: { handle: async () => false } });
  const request = { url: '/api/v1/users/me', method: 'GET', headers: { cookie: a.cookie } };
  let body = ''; const response = { setHeader() {}, writeHead(status) { assert.equal(status, 200); }, end(value) { body = value; } };
  await newHandler(request, response, '/api/v1/users/me'); assert.equal(JSON.parse(body).data.user.id, a.user.id);
});

test('serialized mutations avoid lost updates, clone boundaries and rollback on failure', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 25 }, (_, index) => f.store.mutate(async state => { await Promise.resolve(); state.activity.push({ id: `event-${index}`, userId: 'synthetic', count: state.activity.length }); })));
  let state = await f.store.snapshot(); assert.equal(state.activity.length, 25); assert.equal(new Set(state.activity.map(row => row.count)).size, 25);
  state.activity.length = 0; assert.equal((await f.store.snapshot()).activity.length, 25);
  const before = await readFile(path.join(f.dataDir, 'study.json'), 'utf8');
  await assert.rejects(f.store.mutate(state => { state.activity.length = 0; throw new Error('synthetic failure'); }));
  assert.equal(await readFile(path.join(f.dataDir, 'study.json'), 'utf8'), before);
  await assert.rejects(f.store.mutate(state => { state.activity.push({ id: 'non-finite', value: Infinity }); }));
  assert.equal((await readdir(f.dataDir)).some(name => name.endsWith('.tmp')), false);
});

test('workshop materials, scope and conversations remain private', async t => {
  const f = await fixture(t), a = await f.signup('a'), b = await f.signup('b');
  const book = (await f.request('/textbooks', { method: 'POST', cookie: a.cookie, body: { title: '课本' } })).value.data;
  const workshop = (await f.request('/workshops', { method: 'POST', cookie: a.cookie, body: { title: '我的课堂', linkedTextbookIds: [book.id] } })).value.data;
  assert.equal((await f.request('/workshops', { method: 'POST', cookie: b.cookie, body: { title: '越权关联', linkedTextbookIds: [book.id] } })).status, 404);
  const material = (await f.request(`/workshops/${workshop.id}/materials`, { method: 'POST', cookie: a.cookie, body: { name: '讲义', text: '合成材料，不是真实课堂记录' } })).value.data;
  const conv = (await f.request(`/workshops/${workshop.id}/conversations`, { method: 'POST', cookie: a.cookie, body: { title: '追问' } })).value.data;
  assert.equal((await f.request(`/conversations/${conv.id}`, { cookie: b.cookie })).status, 404);
  assert.equal((await f.request(`/workshops/${workshop.id}/materials/${material.id}`, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await f.request(`/conversations/${conv.id}`, { cookie: a.cookie })).value.data.messages.length, 0);
});

test('book deletion closes indirect child references and retains counted file tombstones', async t => {
  const f = await fixture(t), a = await f.signup('a'), b = await f.signup('b');
  const book = (await f.request('/textbooks', { method: 'POST', cookie: a.cookie, body: { title: '删除演示' } })).value.data;
  await f.store.mutate(state => {
    state.chapters.push({ id: 'chapter-a', userId: a.user.id, textbookId: book.id });
    state.knowledgePoints.push({ id: 'point-a', userId: a.user.id, chapterId: 'chapter-a', textbookId: book.id });
    state.exercises.push({ id: 'exercise-a', userId: a.user.id, knowledgePointId: 'point-a' });
    state.attempts.push({ id: 'attempt-a', userId: a.user.id, exerciseId: 'exercise-a' });
    state.conversations.push({ id: 'conv-a', userId: a.user.id, knowledgePointId: 'point-a' });
    state.messages.push({ id: 'message-a', userId: a.user.id, conversationId: 'conv-a', content: 'private synthetic' });
    state.jobs.push({ id: 'job-a', userId: a.user.id, payload: { conversationId: 'conv-a' }, status: 'running' });
    state.fileRecords.push({ id: 'file-a', userId: a.user.id, textbookId: book.id, storedName: 'synthetic.pdf', bytes: 1234, text: 'private text', pages: ['private'] });
    state.messages.push({ id: 'message-b', userId: b.user.id, conversationId: 'conv-a', content: 'must-remain-isolated' });
  });
  assert.equal((await f.request(`/textbooks/${book.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  const state = await f.store.snapshot();
  for (const key of ['chapters', 'knowledgePoints', 'exercises', 'attempts', 'conversations', 'jobs']) assert.equal(state[key].filter(row => row.userId === a.user.id).length, 0, key);
  assert.equal(state.messages.filter(row => row.userId === a.user.id).length, 0); assert.equal(state.messages.filter(row => row.userId === b.user.id).length, 1);
  assert.equal(state.fileRecords[0].status, 'deleted'); assert.equal(state.fileRecords[0].bytes, 1234); assert.equal(state.fileRecords[0].text, undefined); assert.equal(state.fileRecords[0].pages, undefined);
});

test('conversation deletion clears messages and jobs that reference only its ID', async t => {
  const f = await fixture(t), a = await f.signup();
  const workshop = (await f.request('/workshops', { method: 'POST', cookie: a.cookie, body: { title: '工作坊' } })).value.data;
  const conv = (await f.request(`/workshops/${workshop.id}/conversations`, { method: 'POST', cookie: a.cookie, body: {} })).value.data;
  await f.store.mutate(state => { state.messages.push({ id: 'message', userId: a.user.id, conversationId: conv.id }); state.jobs.push({ id: 'job', userId: a.user.id, payload: { conversationId: conv.id } }); });
  assert.equal((await f.request(`/conversations/${conv.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  const state = await f.store.snapshot(); assert.equal(state.messages.length, 0); assert.equal(state.jobs.length, 0);
});

test('feedback and counters use actual local records; no fake billing or SMS successes', async t => {
  const f = await fixture(t), a = await f.signup();
  const feedback = await f.request('/feedbacks', { method: 'POST', cookie: a.cookie, body: { title: '合成反馈', content: '仅测试提交，不是评委意见' } }); assert.equal(feedback.status, 201);
  assert.equal((await f.request('/feedbacks/mine', { cookie: a.cookie })).value.data.items.length, 1);
  const quota = await f.request('/users/me/quota', { cookie: a.cookie }); assert.equal(quota.value.data.billingConfigured, false); assert.equal(quota.value.data.balance, null);
  assert.equal((await f.request('/credits/ledger', { cookie: a.cookie })).value.data.items.length, 0);
  assert.equal((await f.request('/membership/skus', { cookie: a.cookie })).value.data.configured, false);
  assert.equal((await f.request('/orders', { method: 'POST', cookie: a.cookie, body: { sku: 'not-a-real-order' } })).status, 503);
  assert.equal((await f.request('/auth/send-otp', { method: 'POST', body: { phone: 'synthetic' } })).status, 503);
});

test('service delegation receives only an authenticated safe owner', async t => {
  let seen;
  const service = { handle: async (_req, res, _pathname, user) => { seen = user; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: { handled: true } })); return true; } };
  const f = await fixture(t, { service }), a = await f.signup();
  assert.equal((await f.request('/knowledge-points/test/lesson', { method: 'POST', cookie: a.cookie, body: {} })).status, 200);
  assert.equal(seen.id, a.user.id); assert.equal(seen.passwordHash, undefined);
  assert.equal((await f.request('/knowledge-points/test/lesson', { method: 'POST', body: {} })).status, 401);
});
