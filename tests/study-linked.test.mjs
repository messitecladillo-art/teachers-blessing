import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createStudyStore } from '../learning/store.mjs';
import { createStudyHandler } from '../learning/api.mjs';
import { createLearningService, inferPdfOutline } from '../learning/services.mjs';

test('page grouping keeps a 3000-page unstructured PDF within the 100-chapter course budget', () => {
  const pages = count => Array.from({ length: count }, (_, index) => ({ number: index + 1, text: 'Synthetic plain body.' }));
  const large = inferPdfOutline(pages(3000)); assert.equal(large.outlineMethod, 'page-groups'); assert.equal(large.outline.length, 100);
  assert.deepEqual([large.outline[0].startPage, large.outline[0].endPage, large.outline.at(-1).startPage, large.outline.at(-1).endPage], [1, 30, 2971, 3000]);
  assert.match(large.outline[0].title, /待修订/);
  const previous = inferPdfOutline(pages(1000)); assert.equal(previous.outline.length, 100); assert.equal(previous.outline[0].endPage, 10);
});

test('public metadata advertises the shared PDF limits while SMS and payment stay disabled', async t => {
  const h = await fixture(t), config = await h.request('/config/public'); assert.equal(config.status, 200);
  assert.deepEqual(config.data.learningLimits, { textbookBytes: 314572800, pages: 3000, markdownBytes: 5242880, workshopBytes: 31457280, ocrPages: 5, structurePages: 20 });
  assert.equal(config.data.smsConfigured, false); assert.equal(config.data.paymentConfigured, false);
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'study-linked-'));
  const store = createStudyStore({ dataDir: directory });
  const inputs = [];
  const model = async input => {
    const value = input.messages.filter(row => row.role === 'user').map(row => { try { return JSON.parse(row.content); } catch { return null; } }).find(row => row?.sources || row?.task);
    inputs.push({ value, messages: input.messages });
    return options.model ? options.model(value, input) : JSON.stringify({ title: '合成学习总结', content: 'SYNTHETIC_LINKED_RESPONSE', sourceIds: value.sources.map(row => row.id) });
  };
  let service = createLearningService({ store, dataDir: directory, model, ...options.service });
  let handler = createStudyHandler({ store, dataDir: directory, model, service });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://local').pathname)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); const resolved = path.resolve(directory); assert.equal(path.dirname(resolved).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('study-linked-')); await rm(resolved, { recursive: true, force: true }); });
  async function request(route, { cookie, method = 'GET', body, raw, name = 'synthetic.md' } = {}) {
    const response = await fetch(origin + '/api/v1' + route, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    const value = await response.json(); return { status: response.status, data: value.data, error: value.error, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function signup(name) { const result = await request('/auth/register', { method: 'POST', body: { email: name + '@example.invalid', password: 'Synthetic-pass-123', nickname: name } }); assert.equal(result.status, 201); return result.cookie; }
  async function wait(id, cookie) { for (let index = 0; index < 400; index++) { const result = await request('/jobs/' + id, { cookie }); assert.equal(result.status, 200); if (!['queued','running','cancelling'].includes(result.data.status)) return result.data; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Synthetic job did not settle'); }
  async function book(cookie, title, content) { const result = await request('/textbooks', { cookie, method: 'POST', body: { title } }); assert.equal(result.status, 201); const id = result.data.id; assert.equal((await request('/textbooks/' + id + '/files', { cookie, method: 'POST', raw: Buffer.from(content) })).status, 201); const task = await request('/textbooks/' + id + '/parse', { cookie, method: 'POST', body: {} }); assert.equal((await wait(task.data.id, cookie)).status, 'completed'); const outline = (await request('/textbooks/' + id + '/outline', { cookie })).data; return { id, ...outline }; }
  async function restart() { await service.close(); const restored = createStudyStore({ dataDir: directory }); service = createLearningService({ store: restored, dataDir: directory, model, ...options.service }); handler = createStudyHandler({ store: restored, dataDir: directory, model, service }); }
  return { request, signup, wait, book, inputs, service, store, directory, restart, origin };
}

test('slow incomplete learning JSON has an absolute deadline, closes its connection and reserves no work', async t => {
  const h = await fixture(t, { service: { jsonReadTimeoutMs: 100 } }), cookie = await h.signup('slow-json');
  const book = await h.book(cookie, 'JSON超时合成教材', '# Chapter\nSynthetic source text.');
  const beforeJobs = (await h.request('/jobs', { cookie })).data.items.length;
  const beforeLedger = (await h.request('/credits/ledger', { cookie })).data.items.length;
  const address = new URL(h.origin), started = Date.now();
  const response = await new Promise((resolve, reject) => {
    const chunks = []; let drip; let writes = 0;
    const socket = net.createConnection({ host: address.hostname, port: Number(address.port) });
    const deadline = setTimeout(() => { socket.destroy(); reject(new Error('Did not enforce absolute learning JSON deadline')); }, 1200);
    socket.on('data', chunk => chunks.push(chunk)); socket.on('error', reject);
    socket.on('connect', () => {
      socket.write(`POST /api/v1/textbooks/${book.id}/summaries HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${h.origin}\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nContent-Length: 2048\r\nConnection: keep-alive\r\n\r\n{"goal":"`);
      drip = setInterval(() => { if (!socket.destroyed) { writes++; socket.write(' '); } }, 10);
    });
    socket.on('close', () => { clearTimeout(deadline); clearInterval(drip); resolve({ raw: Buffer.concat(chunks).toString('utf8'), writes, elapsed: Date.now() - started }); });
  });
  assert.match(response.raw, /^HTTP\/1\.1 408 /);
  assert.match(response.raw, /\r\nConnection: close\r\n/i);
  assert.ok(response.writes > 1, 'continued chunks cannot reset the absolute timer');
  assert.ok(response.elapsed < 1000);
  const body = JSON.parse(response.raw.split('\r\n\r\n').slice(1).join('\r\n\r\n'));
  assert.equal(body.error.code, 'BODY_TIMEOUT');
  assert.equal(h.inputs.length, 0);
  assert.equal((await h.request('/jobs', { cookie })).data.items.length, beforeJobs);
  assert.equal((await h.request('/credits/ledger', { cookie })).data.items.length, beforeLedger);
  assert.equal((await h.request('/textbooks/' + book.id + '/summaries', { cookie })).data.items.length, 0);
});

test('the short JSON deadline does not cut off a slower raw textbook upload', async t => {
  const h = await fixture(t, { service: { jsonReadTimeoutMs: 50 } }), cookie = await h.signup('slow-upload');
  const book = (await h.request('/textbooks', { cookie, method: 'POST', body: { title: '合成慢上传' } })).data;
  const bytes = Buffer.from('# Source\nSynthetic body transmitted in two chunks.');
  const uploaded = await new Promise((resolve, reject) => {
    const request = http.request(h.origin + '/api/v1/textbooks/' + book.id + '/files', { method: 'POST', headers: { Cookie: cookie, Origin: h.origin, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'slow.md', 'Content-Length': bytes.length } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { try { resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (failure) { reject(failure); } });
    });
    request.on('error', reject); request.write(bytes.subarray(0, 5));
    const finish = setTimeout(() => request.end(bytes.subarray(5)), 150);
    request.on('close', () => clearTimeout(finish));
  });
  assert.equal(uploaded.status, 201); assert.equal(uploaded.value.data.bytes, bytes.length);
  assert.equal((await h.request('/textbooks/' + book.id + '/files', { cookie })).data.items.length, 1);
  assert.equal(h.inputs.length, 0);
});

test('workshop question uses linked textbook knowledge and own material with real citation metadata', async t => {
  const h = await fixture(t), cookie = await h.signup('linked-a');
  const book = await h.book(cookie, '合成关联教材', '# Chapter One\nlinkneedle linked textbook evidence.');
  const workshop = (await h.request('/workshops', { cookie, method: 'POST', body: { title: '研究课题', linkedTextbookIds: [book.id] } })).data;
  await h.request('/workshops/' + workshop.id + '/materials', { cookie, method: 'POST', body: { name: '本人材料', text: 'linkneedle own workshop evidence.' } });
  const conversation = (await h.request('/workshops/' + workshop.id + '/conversations', { cookie, method: 'POST', body: {} })).data;
  const task = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'Explain linkneedle' } });
  assert.equal((await h.wait(task.data.id, cookie)).status, 'completed');
  const sources = h.inputs.at(-1).value.sources;
  const linked = sources.find(row => row.collection === 'knowledgePoints');
  assert.ok(linked, 'linked textbook must actually enter the model context');
  assert.equal(linked.textbookId, book.id); assert.equal(linked.textbookTitle, '合成关联教材');
  assert.equal(linked.revision, book.knowledgePoints[0].revision);
  assert.deepEqual(linked.sourceAnchor, book.knowledgePoints[0].sourceAnchor);
  assert.deepEqual(linked.sourcePages, [], 'a KP page range is not an exact page-aligned retrieval hit');
  assert.ok(sources.some(row => row.collection === 'materials'));
  const reply = (await h.request('/conversations/' + conversation.id + '/messages', { cookie })).data.items.at(-1);
  assert.ok(reply.sourceVersions.some(row => row.id === linked.id && row.revision === linked.revision && row.textbookTitle === linked.textbookTitle));
});

test('unlink and relink during an in-flight answer reject the late scope version and release its reserved unit', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await fixture(t, { model: value => { entered(); return new Promise(resolve => { release = () => resolve(JSON.stringify({ content: 'LATE_LINKED_RESPONSE', sourceIds: value.sources.map(row => row.id) })); }); } });
  const cookie = await h.signup('late-a'), book = await h.book(cookie, '延迟教材', '# Chapter\nlatekeyword original evidence.');
  const workshop = (await h.request('/workshops', { cookie, method: 'POST', body: { title: '课题', linkedTextbookIds: [book.id] } })).data;
  const conversation = (await h.request('/workshops/' + workshop.id + '/conversations', { cookie, method: 'POST', body: {} })).data;
  const task = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'latekeyword' } });
  await started;
  assert.equal((await h.request('/workshops/' + workshop.id, { cookie, method: 'PATCH', body: { linkedTextbookIds: [], expectedRevision: workshop.revision } })).status, 200);
  const restored = await h.request('/workshops/' + workshop.id, { cookie, method: 'PATCH', body: { linkedTextbookIds: [book.id] } });
  assert.equal(restored.data.scopeRevision, 3);
  release();
  assert.equal((await h.wait(task.data.id, cookie)).status, 'failed');
  assert.equal((await h.request('/conversations/' + conversation.id + '/messages', { cookie })).data.items.filter(row => row.role === 'assistant').length, 0);
  assert.equal((await h.request('/credits/ledger', { cookie })).data.items.find(row => row.jobId === task.data.id).status, 'released');
});

test('linked source revision changes reject an already generated but uncommitted answer', async t => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; });
  const h = await fixture(t, { model: value => { entered(); return new Promise(resolve => { release = () => resolve(JSON.stringify({ content: 'LATE_SOURCE_RESPONSE', sourceIds: value.sources.map(row => row.id) })); }); } });
  const cookie = await h.signup('revision-a'), book = await h.book(cookie, '修订教材', '# Chapter\nrevisionkeyword source evidence.');
  const workshop = (await h.request('/workshops', { cookie, method: 'POST', body: { title: '课题', linkedTextbookIds: [book.id] } })).data;
  const conversation = (await h.request('/workshops/' + workshop.id + '/conversations', { cookie, method: 'POST', body: {} })).data;
  const task = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'revisionkeyword' } }); await started;
  const chapter = book.chapters[0], point = book.knowledgePoints[0];
  const update = await h.request('/textbooks/' + book.id + '/outline', { cookie, method: 'PATCH', body: { chapters: [{ id: chapter.id, title: '修订章节', startPage: chapter.startPage, endPage: chapter.endPage, knowledgePoints: [{ id: point.id, title: point.title, startPage: point.sourceAnchor.startPage, endPage: point.sourceAnchor.endPage }] }] } }); assert.equal(update.status, 200);
  release(); assert.equal((await h.wait(task.data.id, cookie)).status, 'failed');
  assert.equal((await h.request('/conversations/' + conversation.id + '/messages', { cookie })).data.items.filter(row => row.role === 'assistant').length, 0);
});

test('atlas and summary HTTP preserve independent versions and derive snapshot freshness', async t => {
  const h = await fixture(t), cookie = await h.signup('summary-a'), other = await h.signup('summary-b');
  const book = await h.book(cookie, '总结教材', '# Chapter One\nA fraction is an equal part.\n\n# Chapter Two\nPlants use light and water.');
  const atlas = await h.request('/textbooks/' + book.id + '/atlas', { cookie }); assert.equal(atlas.status, 200);
  assert.ok(atlas.data.nodes.some(row => row.kind === 'knowledgePoint' && row.id === book.knowledgePoints[0].id));
  assert.equal((await h.request('/textbooks/' + book.id + '/atlas', { cookie: other })).status, 404);
  assert.equal((await h.request('/textbooks/' + book.id + '/summaries', { cookie })).data.items.length, 0);
  const task = await h.request('/textbooks/' + book.id + '/summaries', { cookie, method: 'POST', body: { chapterIds: [], goal: '复习重点' } }); assert.equal(task.status, 202);
  assert.equal(task.data.type, 'summary'); assert.equal(task.data.payload.textbookId, book.id);
  const done = await h.wait(task.data.id, cookie); assert.equal(done.status, 'completed', JSON.stringify(done));
  const first = await h.request('/artifacts/' + done.result.id, { cookie }); assert.equal(first.status, 200); assert.equal(first.data.type, 'personal-summary'); assert.equal(first.data.format, 'markdown'); assert.equal(first.data.version, 1); assert.equal(first.data.current, true); assert.equal(first.data.stale, false); assert.equal(first.data.scope.goal, '复习重点'); assert.ok(first.data.sourceVersions.every(row => row.revision && row.sourceAnchor && !('text' in row)));
  assert.equal((await h.request('/artifacts/' + done.result.id, { cookie: other })).status, 404);
  const next = await h.request('/textbooks/' + book.id + '/summaries', { cookie, method: 'POST', body: { chapterIds: [book.chapters[0].id], goal: '另一目标' } }); const nextDone = await h.wait(next.data.id, cookie); assert.equal(nextDone.status, 'completed');
  assert.equal((await h.request('/artifacts/' + nextDone.result.id, { cookie })).data.version, 2);
  assert.equal((await h.request('/artifacts/' + done.result.id, { cookie })).data.current, true, 'new scope/goal does not mutate or invalidate an unchanged historical snapshot');
  await h.request('/knowledge-points/' + book.knowledgePoints[0].id + '/progress', { cookie, method: 'PATCH', body: { status: 'learning' } });
  const historical = (await h.request('/artifacts/' + done.result.id, { cookie })).data; assert.equal(historical.stale, true); assert.equal(historical.current, false); assert.equal(historical.content, first.data.content);
  const list = (await h.request('/textbooks/' + book.id + '/summaries', { cookie })).data.items; assert.equal(list.length, 2); assert.ok(list.find(row => row.id === done.result.id).stale);
  assert.equal((await h.request('/textbooks/' + book.id + '/summaries', { cookie, method: 'POST', body: { chapterIds: ['not-owned-chapter'], goal: '' } })).status, 404);
  const chapter = book.chapters[0], point = book.knowledgePoints[0];
  assert.equal((await h.request('/textbooks/' + book.id + '/outline', { cookie, method: 'PATCH', body: { chapters: [{ id: chapter.id, title: chapter.title, startPage: chapter.startPage, endPage: chapter.endPage, knowledgePoints: [{ id: point.id, title: point.title, startPage: point.sourceAnchor.startPage, endPage: point.sourceAnchor.endPage }] }] } })).status, 200);
  assert.equal((await h.request('/artifacts/' + done.result.id, { cookie })).data.stale, true, 'removed chapter leaves a readable historical summary');
  assert.ok(!(await h.request('/textbooks/' + book.id + '/atlas', { cookie })).data.nodes.some(row => row.id === book.chapters[1].id));
  await h.restart();
  const restored = await h.request('/artifacts/' + done.result.id, { cookie }); assert.equal(restored.status, 200); assert.equal(restored.data.content, first.data.content); assert.equal(restored.data.stale, true);
});

test('personal summaries include own notes and submitted answers but never reference keys even after reveal', async t => {
  const h = await fixture(t, { model: value => value.task === 'exercises' ? JSON.stringify({ questions: [{ type: 'short', stem: 'Explain equal parts.', answer: 'HIDDEN_REFERENCE_SENTINEL', rubric: ['HIDDEN_RUBRIC_SENTINEL'], explanation: 'HIDDEN_SOLUTION_SENTINEL', sourceIds: [value.sources[0].id] }] }) : JSON.stringify({ title: '个人总结', content: '合成本人学习记录总结，仍须核对。', sourceIds: value.sources.map(row => row.id) }) });
  const cookie = await h.signup('personal-a'), book = await h.book(cookie, '个人教材', '# Fractions\nA fraction describes equal parts.'), point = book.knowledgePoints[0];
  assert.equal((await h.request('/highlights', { cookie, method: 'POST', body: { sourceId: point.id, revision: point.revision, exact: 'equal parts', occurrence: 0, note: 'PERSONAL_NOTE_SENTINEL' } })).status, 201);
  const exerciseJob = await h.request('/knowledge-points/' + point.id + '/exercises', { cookie, method: 'POST', body: { type: 'short', count: 1 } }); assert.equal((await h.wait(exerciseJob.data.id, cookie)).status, 'completed');
  const exercise = (await h.request('/knowledge-points/' + point.id + '/exercises', { cookie })).data.items.at(-1);
  const attempt = await h.request('/exercises/' + exercise.id + '/attempts', { cookie, method: 'POST', body: { clientAttemptId: 'personal-summary-attempt', answers: { [exercise.questions[0].id]: 'PERSONAL_RESPONSE_SENTINEL' } } }); assert.equal(attempt.status, 201);
  for (const reveal of [false, true]) {
    if (reveal) assert.equal((await h.request('/attempts/' + attempt.data.id + '/reveal', { cookie, method: 'POST', body: {} })).status, 200);
    const task = await h.request('/textbooks/' + book.id + '/summaries', { cookie, method: 'POST', body: { goal: '只用本人学习记录' } }); assert.equal((await h.wait(task.data.id, cookie)).status, 'completed');
    const input = h.inputs.at(-1).value; assert.equal(input.task, 'personal-summary'); assert.equal(input.goal, '只用本人学习记录');
    assert.match(JSON.stringify(input.personalTraces), /PERSONAL_NOTE_SENTINEL/); assert.match(JSON.stringify(input.personalTraces), /PERSONAL_RESPONSE_SENTINEL/);
    assert.doesNotMatch(JSON.stringify(input), /HIDDEN_REFERENCE_SENTINEL|HIDDEN_RUBRIC_SENTINEL|HIDDEN_SOLUTION_SENTINEL/);
    assert.ok(input.sources.every(source => source.id === point.id));
  }
});

test('cancelled, changed-input and invalid-citation summary tasks cannot create successful artifacts', async t => {
  for (const mode of ['cancel', 'trace-change', 'bad-citation']) await t.test(mode, async t => {
    let entered, release; const started = new Promise(resolve => { entered = resolve; });
    const h = await fixture(t, { model: value => {
      if (mode === 'bad-citation') return JSON.stringify({ title: '不合法引用', content: '不应保存', sourceIds: ['not-provided-source'] });
      entered(); return new Promise(resolve => { release = () => resolve(JSON.stringify({ title: '迟到总结', content: '不应作为当前版本保存', sourceIds: value.sources.map(source => source.id) })); });
    } });
    const cookie = await h.signup('task-' + mode), book = await h.book(cookie, '任务教材', '# Chapter\nCurrent source for summary.');
    const task = await h.request('/textbooks/' + book.id + '/summaries', { cookie, method: 'POST', body: { goal: '合成目标' } }); assert.equal(task.status, 202);
    if (mode !== 'bad-citation') { await started; if (mode === 'cancel') await h.request('/jobs/' + task.data.id + '/cancel', { cookie, method: 'POST', body: {} }); else await h.request('/knowledge-points/' + book.knowledgePoints[0].id + '/progress', { cookie, method: 'PATCH', body: { status: 'mastered' } }); release(); }
    const done = await h.wait(task.data.id, cookie); assert.equal(done.status, mode === 'cancel' ? 'cancelled' : 'failed', JSON.stringify(done));
    assert.equal((await h.request('/textbooks/' + book.id + '/summaries', { cookie })).data.items.length, 0);
    assert.equal((await h.request('/credits/ledger', { cookie })).data.items.find(row => row.jobId === task.data.id).status, 'released');
    if (mode === 'trace-change') assert.equal((await h.request('/jobs/' + task.data.id + '/resume', { cookie, method: 'POST', body: {} })).status, 409);
  });
});

test('workshop metadata and retrieval exclude foreign, unlinked, archived and unready sources', async t => {
  const h = await fixture(t), cookie = await h.signup('scope-a'), foreignCookie = await h.signup('scope-b');
  const linked = await h.book(cookie, '本人已关联', '# Chapter\nscopekeyword linked evidence.');
  const unlinked = await h.book(cookie, '本人未关联', '# Chapter\nscopekeyword UNLINKED_SECRET.');
  const foreign = await h.book(foreignCookie, '外人教材', '# Chapter\nscopekeyword FOREIGN_SECRET.');
  assert.equal((await h.request('/workshops', { cookie, method: 'POST', body: { title: '错误范围', linkedTextbookIds: [foreign.id] } })).status, 404);
  assert.equal((await h.request('/workshops', { cookie, method: 'POST', body: { title: '过长说明', description: 'x'.repeat(201) } })).status, 400);
  const workshop = (await h.request('/workshops', { cookie, method: 'POST', body: { title: '研究课题', description: '合成说明', linkedTextbookIds: [linked.id] } })).data;
  assert.equal(workshop.description, '合成说明'); assert.equal(workshop.scopeRevision, 1);
  const edited = await h.request('/workshops/' + workshop.id, { cookie, method: 'PATCH', body: { description: '', expectedRevision: workshop.revision } });
  assert.equal(edited.status, 200); assert.equal(edited.data.description, ''); assert.equal(edited.data.scopeRevision, 1);
  assert.equal((await h.request('/workshops/' + workshop.id, { cookie, method: 'PATCH', body: { linkedTextbookIds: [foreign.id] } })).status, 404);
  assert.equal((await h.request('/workshops/' + workshop.id, { cookie: foreignCookie })).status, 404);
  const material = (await h.request('/workshops/' + workshop.id + '/materials', { cookie, method: 'POST', body: { name: '材料', text: 'scopekeyword textual evidence.' } })).data;
  const file = (await h.request('/workshops/' + workshop.id + '/files', { cookie, method: 'POST', raw: Buffer.from('# Source\nscopekeyword ready file evidence.') })).data;
  const parse = await h.request('/workshops/' + workshop.id + '/files/' + file.id + '/parse', { cookie, method: 'POST', body: {} }); assert.equal((await h.wait(parse.data.id, cookie)).status, 'completed');
  await h.request('/workshops/' + workshop.id + '/files', { cookie, method: 'POST', raw: Buffer.from('scopekeyword UNREADY_SECRET'), name: 'not-parsed.md' });
  await h.store.mutate(state => { const point = state.knowledgePoints.find(row => row.id === linked.knowledgePoints[0].id); state.knowledgePoints.push({ ...point, id: 'synthetic-archived', archived: true, sourceText: 'scopekeyword ARCHIVED_SECRET' }); });
  const conversation = (await h.request('/workshops/' + workshop.id + '/conversations', { cookie, method: 'POST', body: { knowledgePointId: linked.knowledgePoints[0].id } })).data;
  const task = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'scopekeyword' } }); assert.equal((await h.wait(task.data.id, cookie)).status, 'completed');
  const sources = h.inputs.at(-1).value.sources;
  assert.ok(sources.some(row => row.id === file.id && row.sourcePages.includes(1)));
  assert.ok(sources.some(row => row.id === material.id));
  assert.ok(sources.some(row => row.id === linked.knowledgePoints[0].id));
  assert.ok(!sources.some(row => row.textbookId === unlinked.id || row.textbookId === foreign.id));
  assert.doesNotMatch(JSON.stringify(sources), /FOREIGN_SECRET|UNLINKED_SECRET|UNREADY_SECRET|ARCHIVED_SECRET/);
});

test('unlink makes old message annotations stale and removes the old answer from future model history', async t => {
  const h = await fixture(t), cookie = await h.signup('note-a'), book = await h.book(cookie, '引用教材', '# Chapter\nnotekeyword evidence.');
  const workshop = (await h.request('/workshops', { cookie, method: 'POST', body: { title: '课题', linkedTextbookIds: [book.id] } })).data;
  const conversation = (await h.request('/workshops/' + workshop.id + '/conversations', { cookie, method: 'POST', body: {} })).data;
  const task = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'notekeyword' } }); assert.equal((await h.wait(task.data.id, cookie)).status, 'completed');
  const reply = (await h.request('/conversations/' + conversation.id + '/messages', { cookie })).data.items.at(-1);
  const anchor = { sourceKind: 'conversation', sourceId: reply.id, revision: 1, exact: 'SYNTHETIC_LINKED_RESPONSE', occurrence: 0, note: '合成固定引用' };
  const note = await h.request('/highlights', { cookie, method: 'POST', body: anchor }); assert.equal(note.status, 201);
  await h.request('/workshops/' + workshop.id, { cookie, method: 'PATCH', body: { linkedTextbookIds: [] } });
  assert.equal((await h.request('/highlights', { cookie })).data.items.find(row => row.id === note.data.id).resolution.status, 'stale');
  assert.equal((await h.request('/highlights', { cookie, method: 'POST', body: anchor })).status, 409);
  await h.request('/workshops/' + workshop.id + '/materials', { cookie, method: 'POST', body: { name: '当前资料', text: 'freshkeyword current scope only.' } });
  const next = await h.request('/conversations/' + conversation.id + '/messages', { cookie, method: 'POST', body: { content: 'freshkeyword' } }); assert.equal((await h.wait(next.data.id, cookie)).status, 'completed');
  assert.ok(!h.inputs.at(-1).messages.some(row => row.role === 'assistant' && row.content.includes('SYNTHETIC_LINKED_RESPONSE')));
});
