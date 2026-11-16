import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as callbackScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createStudyStore, COLLECTIONS } from './store.mjs';
import { LEARNING_LIMITS } from './limits.mjs';
import { createCoverService } from './cover-service.mjs';
import {createBookmarkService} from './bookmarks.mjs';
import {createPagePreviewService} from './page-preview-service.mjs';
import {createLearningStudio} from './studio-service.mjs';

const scrypt = promisify(callbackScrypt);
const COOKIE = 'edu_study_session';
const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/study');
const DEFAULT_PREFERENCES = Object.freeze({ theme: 'light', language: 'zh-CN', teachingStyle: 'default', fontScale: 1 });
class StudyError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const error = (status, code, message) => new StudyError(status, code, message);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const safeUser = user => ({ id: user.id, email: user.email, nickname: user.nickname, createdAt: user.createdAt });

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify({ success: true, data });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text), 'X-Content-Type-Options': 'nosniff' }); res.end(text);
}
function fail(res, status, code, message) {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify({ success: false, error: { code, message } });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text), 'X-Content-Type-Options': 'nosniff' }); res.end(text);
}
async function readJson(req, maxBytes = 131072) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw error(415, 'json_required', '请使用JSON请求。');
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); throw error(413, 'body_too_large', '请求内容超过限制。'); }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const finish = (failure, value) => { if (settled) return; settled = true; clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', interrupted); req.off('aborted', interrupted); failure ? reject(failure) : resolve(value); };
    const data = chunk => { size += chunk.length; if (size > maxBytes) { finish(error(413, 'body_too_large', '请求内容超过限制。')); req.resume(); } else chunks.push(chunk); };
    const end = () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); finish(null, value); } catch { finish(error(400, 'invalid_json', 'JSON格式无效。')); } };
    const interrupted = () => finish(error(400, 'request_interrupted', '请求中断。'));
    const timer = setTimeout(() => { finish(error(408, 'request_timeout', '请求读取超时。')); req.resume(); }, 15000);
    req.on('data', data); req.on('end', end); req.on('error', interrupted); req.on('aborted', interrupted);
  });
}
function fields(body, allowed) { if (Object.keys(body).some(key => !allowed.includes(key))) throw error(400, 'invalid_fields', '请求包含不支持的字段。'); return body; }
function text(value, max, fallback) { if (value === undefined && fallback !== undefined) return fallback; if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw error(400, 'invalid_text', '文本为空、过长或包含无效字符。'); return value.trim(); }
function description(value = '') { if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw error(400, 'invalid_text', '课题说明须为不超过200字符的文本。'); return value.trim(); }
function owned(state, collection, id, user) { const item = state[collection]?.find(row => row.id === id && row.userId === user.id); if (!item) throw error(404, 'not_found', '记录不存在或无访问权限。'); return item; }
function boundedList(items) { return { items: items.slice(-200).reverse() }; }
function textbookView(state,book,user){
  const points=state.knowledgePoints.filter(point=>point.userId===user.id&&point.textbookId===book.id&&!point.archived);
  const file=state.fileRecords.find(file=>file.userId===user.id&&file.id===book.activeFileId&&file.status!=='deleted');
  return {...book,chapterCount:state.chapters.filter(chapter=>chapter.userId===user.id&&chapter.textbookId===book.id&&!chapter.archived).length,knowledgePointCount:points.length,masteredPointCount:points.filter(point=>point.progress==='mastered').length,coverAvailable:file?.mime==='application/pdf'};
}
function preferences(input, existing = DEFAULT_PREFERENCES) {
  fields(input, ['theme', 'language', 'teachingStyle', 'fontScale']);
  const next = { ...existing, ...input };
  if (!['light', 'dark', 'system'].includes(next.theme) || !['zh-CN', 'en'].includes(next.language) || !['default', 'language_adaptive', 'english'].includes(next.teachingStyle) || typeof next.fontScale !== 'number' || !Number.isFinite(next.fontScale) || next.fontScale < .8 || next.fontScale > 1.5) throw error(400, 'invalid_preferences', '偏好设置不在允许范围内。');
  return next;
}
async function passwordHash(password) { const salt = randomBytes(16).toString('hex'), derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); return `scrypt$${salt}$${derived.toString('hex')}`; }
async function passwordMatches(password, stored) { const [, salt, expected] = String(stored ?? '').split('$'); if (!/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(expected ?? '')) { await scrypt(password, 'study-dummy-verification-salt', 64); return false; } const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); return timingSafeEqual(derived, Buffer.from(expected, 'hex')); }
function password(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw error(400, 'invalid_password', '密码长度应为8至128个字符。'); return value; }
function email(value) { const result = text(value, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw error(400, 'invalid_email', '请输入有效邮箱格式的本地账号。'); return result; }
function checkRevision(body, row) { if (body.expectedRevision !== undefined && body.expectedRevision !== row.revision) throw error(409, 'revision_conflict', '记录已更新，请重新载入。'); }

function cascadeOwned(state, rootCollection, rootId, user, timestamp) {
  owned(state, rootCollection, rootId, user);
  const collections = COLLECTIONS.filter(name => !['users', 'sessions', 'folders', 'activity', 'ledger', 'feedbacks'].includes(name) && (rootCollection === 'workshops' || name !== 'workshops'));
  const ids = new Set([rootId]);
  const linkKeys = ['textbookId', 'bookId', 'chapterId', 'knowledgePointId', 'kpId', 'conversationId', 'exerciseId', 'exerciseSetId', 'setId', 'fileId', 'lessonId', 'artifactId', 'jobId', 'workshopId'];
  const arrayKeys = ['chapterIds', 'knowledgePointIds', 'kpIds', 'conversationIds', 'exerciseIds', 'fileIds', 'materialIds'];
  const references = row => [row, row.payload, row.input, row.options].some(value => value && typeof value === 'object' && (linkKeys.some(key => typeof value[key] === 'string' && ids.has(value[key])) || arrayKeys.some(key => Array.isArray(value[key]) && value[key].some(id => ids.has(id)))));
  let added;
  do {
    added = false;
    for (const name of collections) for (const row of state[name]) if (row.userId === user.id && !ids.has(row.id) && references(row)) { ids.add(row.id); added = true; }
  } while (added);
  for (const name of collections) {
    if (name === 'fileRecords') state.fileRecords = state.fileRecords.map(row => row.userId === user.id && ids.has(row.id) ? {
      id: row.id, userId: row.userId, storedName: row.storedName, name: row.name, mime: row.mime,
      bytes: row.bytes, sha256: row.sha256, status: 'deleted', createdAt: row.createdAt,
      updatedAt: timestamp, deletedAt: timestamp,
    } : row);
    else state[name] = state[name].filter(row => !(row.userId === user.id && ids.has(row.id)));
  }
  if (rootCollection === 'textbooks') for (const workshop of state.workshops) if (workshop.userId === user.id) workshop.linkedTextbookIds = (workshop.linkedTextbookIds ?? []).filter(value => value !== rootId);
}

/** Owns authentication/core CRUD; learning services are lazily imported and share this store. */
export function createStudyHandler({ dataDir = DEFAULT_DIR, model, researchProvider, store: suppliedStore, service: suppliedService, clock = () => Date.now(), sessionTtlMs = 7 * 86400000, secureCookies = process.env.EDU_STUDY_SECURE_COOKIES === '1', coverRenderer,pagePreviewRenderer,pagePreviewService:suppliedPagePreviewService } = {}) {
  const store = suppliedStore ?? createStudyStore({ dataDir });
  const covers=createCoverService({store,dataDir,...(coverRenderer?{render:coverRenderer}:{})});
  const bookmarks=createBookmarkService({store});
  const pagePreview=suppliedPagePreviewService||createPagePreviewService({store,dataDir,...(pagePreviewRenderer?{render:pagePreviewRenderer}:{})});
  const studio=createLearningStudio({store,clock});
  let learning, activeAuth = 0;
  const authAttempts = new Map();
  const now = () => new Date(clock()).toISOString();
  const id = () => randomUUID();
  const stamp = user => ({ id: id(), userId: user.id, createdAt: now(), updatedAt: now(), revision: 1 });
  const cookie = (res, token, age) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(age / 1000))}${secureCookies ? '; Secure' : ''}`);
  const sessionToken = req => { const values = String(req.headers.cookie ?? '').split(';').map(piece => piece.trim()).filter(piece => piece.startsWith(COOKIE + '=')); if (values.length !== 1) return null; const token = values[0].slice(COOKIE.length + 1); return /^[a-f0-9]{64}$/.test(token) ? token : null; };
  async function authenticate(req) {
    const token = sessionToken(req), state = await store.snapshot();
    const session = token && state.sessions.find(row => row.tokenHash === hashToken(token) && row.expiresAt > clock());
    const user = session && state.users.find(row => row.id === session.userId);
    if (!user) throw error(401, 'authentication_required', '请先登录本地学习账号。');
    return { user, token, session };
  }
  async function newSession(state, userId, oldHash) {
    state.sessions = state.sessions.filter(row => row.expiresAt > clock() && row.tokenHash !== oldHash);
    const current = state.sessions.filter(row => row.userId === userId);
    if (current.length >= 10) state.sessions = state.sessions.filter(row => row.id !== current[0].id);
    const token = randomBytes(32).toString('hex');
    state.sessions.push({ id: id(), userId, tokenHash: hashToken(token), createdAt: now(), expiresAt: clock() + sessionTtlMs });
    return token;
  }
  async function recordActivity(userId, type, metadata = {}) { return store.mutate(state => { state.activity.push({ id: id(), userId, type, metadata, createdAt: now() }); if (state.activity.length > 18000) state.activity.splice(0, state.activity.length - 18000); }); }
  const helpers = { readJson, send, fail, error, id, now, owned, recordActivity };
  async function services() { if (!learning) learning = suppliedService ? Promise.resolve(suppliedService) : import('./services.mjs').then(module => module.createLearningService({ store, model, researchProvider, dataDir, ...helpers })); return learning; }
  function rateLimit(req) { const key = req.socket.remoteAddress ?? 'local'; const time = clock(); const entry = authAttempts.get(key); const current = entry && entry.until > time ? entry : { count: 0, until: time + 15 * 60000 }; current.count++; authAttempts.set(key, current); if (authAttempts.size > 1000) for (const [k, item] of authAttempts) if (item.until <= time) authAttempts.delete(k); if (current.count > 40 || activeAuth >= 4) throw error(429, 'auth_rate_limited', '登录操作过于频繁，请稍后重试。'); }

  return async function handleStudy(req, res, pathname) {
    if (!pathname.startsWith('/api/v1/')) return false;
    try {
      const route = pathname.slice('/api/v1'.length), method = req.method;
      const url = new URL(req.url, 'http://local.invalid');
      if (method === 'GET' && route === '/config/public') { const {textbookBytes,pages,markdownBytes,workshopBytes,ocrPages,structurePages}=LEARNING_LIMITS;send(res, 200, { registration: 'local_password', emailVerificationConfigured: false, smsConfigured: false, paymentConfigured: false, modelConfigured: typeof model === 'function',webResearchConfigured: typeof researchProvider==='function'&&researchProvider.configured!==false,learningLimits:{textbookBytes,pages,markdownBytes,workshopBytes,ocrPages,structurePages} }); return true; }
      if (['/auth/send-otp', '/auth/reset-password'].includes(route)) throw error(503, 'verification_service_unavailable', '短信与外部账号验证服务未配置；请使用本地邮箱账号和密码登录。');
      if (method === 'POST' && ['/auth/register', '/auth/login', '/auth/login-password'].includes(route)) {
        const body = fields(await readJson(req, 4096), route === '/auth/register' ? ['email', 'password', 'nickname'] : ['email', 'password']);
        const account = email(body.email), secret = password(body.password); rateLimit(req); activeAuth++;
        try {
          if (route === '/auth/register') {
            const nickname = text(body.nickname, 60), digest = await passwordHash(secret);
            const result = await store.mutate(async state => {
              if (state.users.some(user => user.email === account)) throw error(409, 'account_exists', '该本地账号已注册。');
              if (state.users.length >= 5000) throw error(409, 'account_limit', '本地账号数量已达上限。');
              const user = { id: id(), email: account, nickname, passwordHash: digest, preferences: { ...DEFAULT_PREFERENCES }, createdAt: now(), updatedAt: now() };
              state.users.push(user); const token = await newSession(state, user.id);
              return { token, user: safeUser(user), preferences: user.preferences };
            });
            cookie(res, result.token, sessionTtlMs); send(res, 201, { user: result.user, preferences: result.preferences }); return true;
          }
          const initial = await store.snapshot(), found = initial.users.find(user => user.email === account);
          if (!await passwordMatches(secret, found?.passwordHash)) throw error(401, 'invalid_credentials', '账号或密码错误。');
          const result = await store.mutate(async state => {
            const current = state.users.find(user => user.id === found.id);
            if (!current || current.passwordHash !== found.passwordHash) throw error(401, 'invalid_credentials', '账号状态已变化，请重新登录。');
            return { token: await newSession(state, current.id), user: safeUser(current), preferences: current.preferences };
          });
          cookie(res, result.token, sessionTtlMs); send(res, 200, { user: result.user, preferences: result.preferences }); return true;
        } finally { activeAuth--; }
      }
      if (route === '/announcements' && method === 'GET') { send(res, 200, { items: [{ id: 'local-availability', title: '本地学习系统服务状态', content: '教材学习功能使用你配置的模型。短信、邮件验证、真实会员支付尚未接入；不会模拟付费或短信发送成功。', createdAt: '2026-11-16T00:00:00+08:00' }] }); return true; }
      if (route === '/auth/logout' && method === 'POST') { const token = sessionToken(req); if (token) await store.mutate(state => { state.sessions = state.sessions.filter(row => row.tokenHash !== hashToken(token)); }); cookie(res, '', 0); send(res, 200, { signedOut: true }); return true; }
      const auth = await authenticate(req), user = safeUser(auth.user);
      if(await pagePreview.handle(req,res,pathname,user))return true;
      if(await bookmarks.handle(req,res,pathname,user,{json:request=>readJson(request),send}))return true;
      if(await studio.handle(req,res,pathname,user,{json:request=>readJson(request),send}))return true;
      const coverRoute=/^\/textbooks\/([^/]+)\/cover$/.exec(route);
      if(coverRoute){if(method!=='GET')throw error(405,'method_not_allowed','封面只支持GET');const cover=await covers.get(coverRoute[1],user);if(!res.destroyed&&!res.writableEnded){res.writeHead(200,{'Content-Type':'image/png','Content-Length':cover.bytes.length,'Content-Disposition':'inline; filename="textbook-first-page.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Cover-Source':'pdf-first-page','X-Cover-Source-SHA256':cover.sourceSha256});res.end(cover.bytes);}return true;}
      if (method === 'GET' && ['/users/me', '/auth/me'].includes(route)) { send(res, 200, { user, preferences: auth.user.preferences }); return true; }
      if (method === 'POST' && route === '/auth/refresh') { const token = await store.mutate(state => { const session = state.sessions.find(row => row.tokenHash === auth.session.tokenHash && row.expiresAt > clock()); if (!session) throw error(401, 'authentication_required', '会话已失效。'); return newSession(state, user.id, session.tokenHash); }); cookie(res, token, sessionTtlMs); send(res, 200, { user, preferences: auth.user.preferences }); return true; }
      if (method === 'POST' && route === '/users/me/change-password') { const body = fields(await readJson(req, 4096), ['currentPassword', 'newPassword']); const current = password(body.currentPassword), replacement = password(body.newPassword); if (!await passwordMatches(current, auth.user.passwordHash)) throw error(401, 'invalid_credentials', '当前密码不正确。'); const digest = await passwordHash(replacement); await store.mutate(state => { const record = state.users.find(row => row.id === user.id); if (record.passwordHash !== auth.user.passwordHash) throw error(409, 'account_changed', '账号已变化，请重新登录。'); record.passwordHash = digest; record.updatedAt = now(); state.sessions = state.sessions.filter(row => row.userId !== user.id); }); cookie(res, '', 0); send(res, 200, { signedOut: true }); return true; }
      if (method === 'PATCH' && route === '/users/me') { const body = fields(await readJson(req, 4096), ['nickname']); const nickname = text(body.nickname, 60); const record = await store.mutate(state => { const row = state.users.find(item => item.id === user.id); row.nickname = nickname; row.updatedAt = now(); return safeUser(row); }); send(res, 200, { user: record }); return true; }
      if (['/users/me/preferences', '/preferences'].includes(route) && ['GET', 'PATCH'].includes(method)) { if (method === 'GET') send(res, 200, auth.user.preferences); else { const body = await readJson(req, 4096); const result = await store.mutate(state => { const row = state.users.find(item => item.id === user.id); row.preferences = preferences(body, row.preferences); row.updatedAt = now(); return row.preferences; }); send(res, 200, result); } return true; }

      const folderRoute = /^\/(?:folders|textbook-folders)(?:\/([^/]+))?$/.exec(route);
      if (folderRoute) {
        const folderId = folderRoute[1];
        if (method === 'GET' && !folderId) send(res, 200, boundedList((await store.snapshot()).folders.filter(row => row.userId === user.id)));
        else if (method === 'POST' && !folderId) { const body = fields(await readJson(req, 4096), ['name']); const name = text(body.name, 100); const value = await store.mutate(state => { if (state.folders.filter(row => row.userId === user.id).length >= 100) throw error(409, 'folder_limit', '文件夹数量已达上限。'); const row = { ...stamp(user), name }; state.folders.push(row); return row; }); send(res, 201, value); }
        else if (folderId && method === 'PATCH') { const body = fields(await readJson(req, 4096), ['name', 'expectedRevision']); const name = text(body.name, 100); const value = await store.mutate(state => { const row = owned(state, 'folders', folderId, user); checkRevision(body, row); row.name = name; row.revision++; row.updatedAt = now(); return row; }); send(res, 200, value); }
        else if (folderId && method === 'DELETE') { await store.mutate(state => { owned(state, 'folders', folderId, user); state.folders = state.folders.filter(row => row.id !== folderId); for (const book of state.textbooks) if (book.userId === user.id && book.folderId === folderId) { book.folderId = null; book.revision++; book.updatedAt = now(); } }); send(res, 200, { deleted: true }); }
        else throw error(405, 'method_not_allowed', '此文件夹操作不受支持。');
        return true;
      }
      if (route === '/textbooks' && method === 'GET') { const state = await store.snapshot(), folderId = url.searchParams.get('folderId'); send(res, 200, boundedList(state.textbooks.filter(row => row.userId === user.id && (!folderId || row.folderId === folderId)).map(row=>textbookView(state,row,user)))); return true; }
      if (route === '/textbooks' && method === 'POST') { const body = fields(await readJson(req, 4096), ['title', 'folderId']); const title = text(body.title, 200); const value = await store.mutate(state => { if (body.folderId != null) owned(state, 'folders', body.folderId, user); if (state.textbooks.filter(row => row.userId === user.id).length >= 100) throw error(409, 'textbook_limit', '教材数量已达上限。'); const row = { ...stamp(user), title, folderId: body.folderId ?? null, status: 'empty' }; state.textbooks.push(row); return row; }); send(res, 201, value); return true; }
      const textbookRoute = /^\/textbooks\/([^/]+)$/.exec(route);
      if (textbookRoute) {
        const bookId = textbookRoute[1];
        if (method === 'GET') {const state=await store.snapshot();send(res,200,textbookView(state,owned(state,'textbooks',bookId,user),user));}
        else if (method === 'PATCH') { const body = fields(await readJson(req, 4096), ['title', 'folderId', 'expectedRevision']); const value = await store.mutate(state => { const row = owned(state, 'textbooks', bookId, user); checkRevision(body, row); if (body.title !== undefined) row.title = text(body.title, 200); if (body.folderId !== undefined) { if (body.folderId !== null) owned(state, 'folders', body.folderId, user); row.folderId = body.folderId; } row.revision++; row.updatedAt = now(); return row; }); send(res, 200, value); }
        else if (method === 'DELETE') { await store.mutate(state => cascadeOwned(state, 'textbooks', bookId, user, now())); send(res, 200, { deleted: true, binaryCleanup: 'tombstoned_and_counted_until_private_maintenance' }); }
        else throw error(405, 'method_not_allowed', '此教材操作不受支持。');
        return true;
      }

      if (route === '/workshops' && method === 'GET') { send(res, 200, boundedList((await store.snapshot()).workshops.filter(row => row.userId === user.id))); return true; }
      if (route === '/workshops' && method === 'POST') { const body = fields(await readJson(req, 16384), ['title', 'description', 'linkedTextbookIds']); const title = text(body.title, 200), detail = description(body.description); const links = body.linkedTextbookIds ?? []; if (!Array.isArray(links) || links.length > 50 || links.some(value => typeof value !== 'string')) throw error(400, 'invalid_scope', '关联教材范围无效。'); const value = await store.mutate(state => { for (const link of links) owned(state, 'textbooks', link, user); const row = { ...stamp(user), title, description: detail, scopeRevision: 1, linkedTextbookIds: [...new Set(links)] }; state.workshops.push(row); return row; }); send(res, 201, value); return true; }
      const workshopRoute = /^\/workshops\/([^/]+)$/.exec(route);
      if (workshopRoute) { const workshopId = workshopRoute[1];
        if (method === 'GET') send(res, 200, owned(await store.snapshot(), 'workshops', workshopId, user));
        else if (method === 'PATCH') { const body = fields(await readJson(req, 16384), ['title', 'description', 'linkedTextbookIds', 'expectedRevision']); const value = await store.mutate(state => { const row = owned(state, 'workshops', workshopId, user); checkRevision(body, row); if (body.title !== undefined) row.title = text(body.title, 200); if (body.description !== undefined) row.description = description(body.description); if (body.linkedTextbookIds !== undefined) { if (!Array.isArray(body.linkedTextbookIds) || body.linkedTextbookIds.length > 50 || body.linkedTextbookIds.some(link => typeof link !== 'string')) throw error(400, 'invalid_scope', '关联教材范围无效。'); for (const link of body.linkedTextbookIds) owned(state, 'textbooks', link, user); const links = [...new Set(body.linkedTextbookIds)]; if (JSON.stringify([...links].sort()) !== JSON.stringify([...(row.linkedTextbookIds || [])].sort())) row.scopeRevision = (row.scopeRevision || 1) + 1; row.linkedTextbookIds = links; } row.revision++; row.updatedAt = now(); return row; }); send(res, 200, value); }
        else if (method === 'DELETE') { await store.mutate(state => cascadeOwned(state, 'workshops', workshopId, user, now())); send(res, 200, { deleted: true, binaryCleanup: 'tombstoned_and_counted_until_private_maintenance' }); }
        else throw error(405, 'method_not_allowed', '此工作坊操作不受支持。'); return true;
      }
      const materialsRoute = /^\/workshops\/([^/]+)\/materials(?:\/([^/]+))?$/.exec(route);
      if (materialsRoute) { const [, workshopId, materialId] = materialsRoute; owned(await store.snapshot(), 'workshops', workshopId, user);
        if (method === 'GET' && !materialId) send(res, 200, boundedList((await store.snapshot()).materials.filter(row => row.userId === user.id && row.workshopId === workshopId)));
        else if (method === 'POST' && !materialId) { const body = fields(await readJson(req, 100000), ['name', 'text']); const value = await store.mutate(state => { owned(state, 'workshops', workshopId, user); const row = { ...stamp(user), workshopId, name: text(body.name, 200), text: text(body.text, 80000), classification: 'user_provided' }; state.materials.push(row); return row; }); send(res, 201, value); }
        else if (method === 'DELETE' && materialId) { await store.mutate(state => { const row = owned(state, 'materials', materialId, user); if (row.workshopId !== workshopId) throw error(404, 'not_found', '材料不存在。'); state.materials = state.materials.filter(item => item.id !== materialId); }); send(res, 200, { deleted: true }); }
        else throw error(405, 'method_not_allowed', '此材料操作不受支持。'); return true;
      }
      const conversationList = /^\/workshops\/([^/]+)\/conversations$/.exec(route);
      if (conversationList) { const workshopId = conversationList[1]; owned(await store.snapshot(), 'workshops', workshopId, user);
        if (method === 'GET') send(res, 200, boundedList((await store.snapshot()).conversations.filter(row => row.userId === user.id && row.workshopId === workshopId)));
        else if (method === 'POST') { const body = fields(await readJson(req, 4096), ['title', 'persona', 'knowledgePointId']); const value = await store.mutate(state => { const workshop = owned(state, 'workshops', workshopId, user); let point; if (body.knowledgePointId !== undefined) { point = owned(state, 'knowledgePoints', body.knowledgePointId, user); owned(state, 'textbooks', point.textbookId, user); if (!(workshop.linkedTextbookIds ?? []).includes(point.textbookId)) throw error(400, 'point_not_in_scope', '该知识点不在工作坊关联教材范围内。'); } const row = { ...stamp(user), workshopId, ...(point ? { knowledgePointId: point.id } : {}), title: text(body.title, 200, '新对话'), persona: body.persona === undefined ? '' : text(body.persona, 2000), status: 'active' }; state.conversations.push(row); return row; }); send(res, 201, value); }
        else throw error(405, 'method_not_allowed', '此对话操作不受支持。'); return true;
      }
      const conversationRoute = /^\/conversations\/([^/]+)$/.exec(route);
      if (conversationRoute) { const conversationId = conversationRoute[1];
        if (method === 'GET') { const state = await store.snapshot(), row = owned(state, 'conversations', conversationId, user); send(res, 200, { ...row, messages: state.messages.filter(item => item.userId === user.id && item.conversationId === conversationId).slice(-200) }); }
        else if (method === 'PATCH') { const body = fields(await readJson(req, 8192), ['title', 'persona', 'expectedRevision']); const value = await store.mutate(state => { const row = owned(state, 'conversations', conversationId, user); checkRevision(body, row); if (body.title !== undefined) row.title = text(body.title, 200); if (body.persona !== undefined) row.persona = body.persona === '' ? '' : text(body.persona, 2000); row.revision++; row.updatedAt = now(); return row; }); send(res, 200, value); }
        else if (method === 'DELETE') { await store.mutate(state => cascadeOwned(state, 'conversations', conversationId, user, now())); send(res, 200, { deleted: true }); }
        else throw error(405, 'method_not_allowed', '此对话操作不受支持。'); return true;
      }
      if (method === 'GET' && ['/statistics', '/users/me/quota', '/credits/ledger'].includes(route)) { const state = await store.snapshot(), counts = {}; for (const name of ['textbooks', 'chapters', 'knowledgePoints', 'lessons', 'exercises', 'attempts', 'highlights', 'workshops', 'messages']) counts[name] = state[name].filter(row => row.userId === user.id).length; if (route === '/credits/ledger') send(res, 200, { items: state.ledger.filter(row => row.userId === user.id).slice(-200).reverse(), billingConfigured: false, balance: null }); else if (route === '/users/me/quota') send(res, 200, { mode: 'local_unmetered', billingConfigured: false, balance: null, modelConfigured: typeof model === 'function', limits: { textbooks: 100, folders: 100, storeBytes: 67108864 }, counts }); else send(res, 200, { counts, recentActivity: state.activity.filter(row => row.userId === user.id).slice(-50).reverse(), generatedAt: now() }); return true; }
      if (route === '/feedbacks' && method === 'POST') { const body = fields(await readJson(req, 20000), ['title', 'content']); const value = await store.mutate(state => { const row = { ...stamp(user), title: text(body.title, 160), content: text(body.content, 8000), status: 'submitted_local', replies: [] }; state.feedbacks.push(row); return row; }); send(res, 201, value); return true; }
      if (['/feedbacks', '/feedbacks/mine'].includes(route) && method === 'GET') { send(res, 200, boundedList((await store.snapshot()).feedbacks.filter(row => row.userId === user.id))); return true; }
      const feedbackRoute = /^\/feedbacks\/([^/]+)(\/replies)?$/.exec(route);
      if (feedbackRoute) { if (method === 'GET' && !feedbackRoute[2]) send(res, 200, owned(await store.snapshot(), 'feedbacks', feedbackRoute[1], user)); else if (method === 'POST' && feedbackRoute[2]) { const body = fields(await readJson(req, 20000), ['content']); const value = await store.mutate(state => { const row = owned(state, 'feedbacks', feedbackRoute[1], user); row.replies.push({ id: id(), userId: user.id, content: text(body.content, 8000), createdAt: now() }); row.updatedAt = now(); return row; }); send(res, 201, value); } else throw error(405, 'method_not_allowed', '此反馈操作不受支持。'); return true; }
      if (method === 'GET' && ['/membership/skus', '/membership/topup-skus', '/membership/credit-coefficients', '/orders'].includes(route)) { send(res, 200, { configured: false, items: [], message: '真实会员、积分充值与支付服务未接入；本地系统不会模拟支付成功。' }); return true; }
      if (route === '/orders' && method === 'POST') throw error(503, 'payment_unavailable', '支付服务未配置，未创建或扣款任何真实订单。');
      const learningService = await services();
      if (await learningService.handle(req, res, pathname, user)) return true;
      throw error(404, 'not_found', '接口不存在。');
    } catch (failure) { if (failure && Number.isInteger(failure.status) && typeof failure.code === 'string') fail(res, failure.status, failure.code, failure.message); else fail(res, 500, 'study_internal_error', '本地学习服务处理失败，未公开内部详情。'); return true; }
  };
}
