import http from 'node:http';
import path from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStudyHandler } from './learning/api.mjs';

const DEFAULT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT_FILES = new Set(['index.html', 'styles.css', 'app.js', 'cloud.js', 'ppt-editor.js', 'ai-client.js', 'evidence-classroom.js', 'evidence-classroom.css', 'study.html', 'study.js', 'study-notes.js', 'study-render.js', 'study-course.js', 'study-teaching.js', 'study.css', 'study-teaching.css', 'favicon.ico', 'favicon.png', 'robots.txt']);
const RESOURCE_DIRS = new Set(['assets', 'asset', 'data', 'vendor']);
const RESOURCE_EXTENSIONS = new Set(['.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav', '.mp4', '.pdf', '.txt']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function integer(value, fallback, min, max, label) {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Invalid ${label}`);
  return result;
}

function modelId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\s\x00-\x1f\x7f]/.test(value);
}

function originList(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return values.filter(Boolean).map(item => {
    const raw = String(item).trim();
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== raw) throw new Error('Invalid allowed origin');
    return raw;
  });
}

export function loadConfig(env = process.env) {
  const model = (env.EDU_AIGC_MODEL ?? '').trim();
  const allowedModels = [...new Set((env.EDU_AIGC_ALLOWED_MODELS || model).split(',').map(item => item.trim()).filter(Boolean))];
  return normalizeConfig({
    apiKey: env.EDU_AIGC_API_KEY ?? '',
    apiUrl: env.EDU_AIGC_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
    model, allowedModels,
    timeoutMs: integer(env.EDU_AIGC_TIMEOUT_MS, 30000, 1000, 120000, 'timeout'),
    maxOutputTokens: integer(env.EDU_AIGC_MAX_OUTPUT_TOKENS, 4096, 1, 16384, 'output token limit'),
    maxConcurrent: integer(env.EDU_AIGC_MAX_CONCURRENT, 2, 1, 8, 'concurrency'),
    allowedOrigins: originList(env.EDU_AIGC_ALLOWED_ORIGINS),
  });
}

function normalizeConfig(input) {
  const config = {
    apiKey: '', apiUrl: 'https://openrouter.ai/api/v1/chat/completions', model: '',
    allowedModels: [], timeoutMs: 30000, maxOutputTokens: 4096,
    maxConcurrent: 2, maxBodyBytes: 131072, maxResponseBytes: 1048576,
    allowedOrigins: [], ...input,
  };
  config.apiKey = String(config.apiKey).trim();
  config.model = String(config.model).trim();
  config.allowedModels = [...new Set(config.allowedModels.length ? config.allowedModels : config.model ? [config.model] : [])];
  if ((config.model && !modelId(config.model)) || config.allowedModels.length > 32 || config.allowedModels.some(value => !modelId(value)) || (config.model && !config.allowedModels.includes(config.model))) throw new Error('Invalid model configuration');
  const upstream = new URL(config.apiUrl);
  const localHttp = upstream.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname);
  if ((upstream.protocol !== 'https:' && !localHttp) || upstream.username || upstream.password || upstream.hash || upstream.search || !upstream.pathname.endsWith('/chat/completions')) throw new Error('Invalid upstream chat/completions URL');
  config.apiUrl = upstream.href;
  config.allowedOrigins = originList(config.allowedOrigins);
  for (const [key, max] of [['timeoutMs', 120000], ['maxBodyBytes', 1048576], ['maxResponseBytes', 4194304], ['maxOutputTokens', 16384], ['maxConcurrent', 8]]) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > max) throw new Error(`Invalid ${key}`);
  }
  return Object.freeze(config);
}

function sendJson(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}

function fail(res, status, code, message) { sendJson(res, status, { error: { code, message } }); }

function requestAuthority(req, config) {
  const host = req.headers.host;
  if (typeof host !== 'string' || /[\s/@\\]/.test(host)) throw new RequestError(403, 'host_not_allowed', '请求主机不在允许范围。');
  const local = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host);
  if (!local && !config.allowedOrigins.some(origin => new URL(origin).host === host)) throw new RequestError(403, 'host_not_allowed', '请求主机不在允许范围。');
  return `http://${host}`;
}

function checkOrigin(req, authority, config, required = false) {
  const origin = req.headers.origin;
  if ((!origin && required) || (origin && origin !== authority && !config.allowedOrigins.includes(origin)) || req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'origin_not_allowed', '仅允许从本站发起模型请求。');
}

function requestPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) throw new RequestError(400, 'invalid_path', '请求路径无效。');
  let decoded;
  try { decoded = decodeURIComponent(raw.split('?')[0]); } catch { throw new RequestError(400, 'invalid_path', '请求路径编码无效。'); }
  if (/[\\\x00-\x1f\x7f]/.test(decoded) || /%[a-f0-9]{2}/i.test(decoded) || decoded.split('/').some(segment => segment === '..' || segment === '.')) throw new RequestError(400, 'invalid_path', '请求路径无效。');
  return decoded;
}

function readJson(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestError(415, 'json_required', '请求必须使用 application/json。');
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw new RequestError(413, 'body_too_large', '请求内容过大，请缩短对话。'); }
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > limit) { finish(new RequestError(413, 'body_too_large', '请求内容过大，请缩短对话。')); req.resume(); }
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const value = JSON.parse(raw);
        finish(null, value);
      } catch { finish(new RequestError(400, 'invalid_json', '请求JSON格式无效。')); }
    };
    const onError = () => finish(new RequestError(400, 'request_interrupted', '请求读取中断。'));
    const onAbort = () => finish(new RequestError(400, 'request_interrupted', '请求读取中断。'));
    const timer = setTimeout(() => { finish(new RequestError(408, 'body_timeout', '请求发送超时。')); req.resume(); }, 15000);
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
  });
}

function chatInput(input, config, { maxMessageChars = 24000 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['messages', 'model', 'temperature'].includes(key))) throw new RequestError(400, 'invalid_request', '模型请求字段无效。');
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 40) throw new RequestError(400, 'invalid_messages', '对话应包含1至40条消息。');
  let total = 0;
  const messages = input.messages.map(message => {
    if (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).some(key => !['role', 'content'].includes(key)) || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > maxMessageChars) throw new RequestError(400, 'invalid_messages', '消息角色或文本长度无效。');
    total += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (total > 64000 || !messages.some(message => message.role === 'user')) throw new RequestError(400, 'invalid_messages', '对话文本过长或缺少用户问题。');
  const model = input.model === undefined ? config.model : input.model;
  if (input.model !== undefined && (!modelId(model) || !config.allowedModels.includes(model))) throw new RequestError(400, 'model_not_allowed', '所选模型未在服务端允许列表中，请刷新模型配置。');
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) throw new RequestError(400, 'invalid_temperature', 'temperature应为0至2之间的数字。');
  return { model, messages, ...(input.temperature === undefined ? {} : { temperature: input.temperature }), stream: false, max_tokens: config.maxOutputTokens };
}

async function responseJson(response, config, controller) {
  const chunks = []; let bytes = 0;
  if (!response.body || !/\bjson\b/i.test(response.headers.get('content-type') ?? '')) throw new RequestError(502, 'upstream_invalid_response', '模型服务返回了无法读取的结果。');
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > config.maxResponseBytes) { controller.abort(); throw new RequestError(502, 'upstream_response_too_large', '模型结果过大，请缩短生成任务。'); }
    chunks.push(Buffer.from(chunk));
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(502, 'upstream_invalid_response', '模型服务返回了无法读取的结果。'); }
  if (!data || !Array.isArray(data.choices) || data.choices.length < 1 || data.choices.length > 8 || data.choices.some(choice => typeof choice?.message?.content !== 'string') || (config.apiKey && JSON.stringify(data).includes(config.apiKey))) throw new RequestError(502, 'upstream_invalid_response', '模型服务返回了无法读取的结果。');
  return {
    ...(typeof data.id === 'string' ? { id: data.id } : {}),
    object: 'chat.completion', model: typeof data.model === 'string' ? data.model : config.model,
    choices: data.choices.map((choice, index) => ({ index, message: { role: 'assistant', content: choice.message.content }, finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null })),
    ...(data.usage && typeof data.usage === 'object' ? { usage: Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].filter(key => Number.isFinite(data.usage[key]) && data.usage[key] >= 0).map(key => [key, data.usage[key]])) } : {}),
  };
}

async function staticFile(req, res, pathname, root) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new RequestError(405, 'method_not_allowed', '此资源只支持GET或HEAD。');
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const parts = relative.split('/');
  const allowed = parts.length === 1 ? ROOT_FILES.has(relative) : RESOURCE_DIRS.has(parts[0]) && RESOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase());
  if (!allowed || parts.some(segment => !segment || segment.startsWith('.') || /[:]/.test(segment))) throw new RequestError(404, 'not_found', '资源不存在。');
  const absolute = path.resolve(root, ...parts);
  if (path.relative(root, absolute).startsWith('..')) throw new RequestError(404, 'not_found', '资源不存在。');
  try {
    let cursor = root;
    for (const part of parts) { cursor = path.join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new RequestError(404, 'not_found', '资源不存在。'); }
    const realRoot = await realpath(root), realFile = await realpath(absolute);
    const within = path.relative(realRoot, realFile);
    if (within.startsWith('..') || path.isAbsolute(within) || !(await lstat(realFile)).isFile()) throw new RequestError(404, 'not_found', '资源不存在。');
    const bytes = await readFile(realFile);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(relative).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(404, 'not_found', '资源不存在。');
  }
}

/** Injection is for isolated tests. Importing this module never starts a listener. */
export function createServer({ config: inputConfig, fetch: fetchImpl = globalThis.fetch, root = DEFAULT_ROOT, studyDataDir } = {}) {
  const config = inputConfig ? normalizeConfig(inputConfig) : loadConfig();
  let active = 0;
  const studyModel = config.apiKey && config.model ? async ({ messages, temperature, signal } = {}) => {
    const payload = chatInput({ messages, ...(temperature === undefined ? {} : { temperature }) }, config, { maxMessageChars: 60000 });
    if (active >= config.maxConcurrent) throw new RequestError(429, 'server_busy', '当前模型任务较多，请稍后再试。');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
    const onAbort = () => controller.abort();
    let onControllerAbort;
    const aborted = new Promise((_resolve, reject) => {
      onControllerAbort = () => reject(new RequestError(timedOut ? 504 : 409, timedOut ? 'upstream_timeout' : 'cancelled', timedOut ? '模型处理超时，结果未保存为完成。' : '任务已取消。'));
      controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    });
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    active++;
    try {
      const result = await Promise.race([(async () => {
      const response = await fetchImpl(config.apiUrl, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload) });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new RequestError(response.status === 429 ? 429 : 502, 'upstream_error', '模型服务没有完成任务，请稍后重试。'); }
      return await responseJson(response, config, controller);
      })(), aborted]);
      const text = result.choices[0].message.content;
      if (!text.trim()) throw new RequestError(502, 'empty_response', '模型没有返回有效内容。');
      return text;
    } catch (error) {
      if (timedOut) throw new RequestError(504, 'upstream_timeout', '模型处理超时，结果未保存为完成。');
      if (signal?.aborted) throw new RequestError(409, 'cancelled', '任务已取消。');
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, 'upstream_unavailable', '模型连接失败，请核对服务端配置。');
    } finally { clearTimeout(timer);signal?.removeEventListener('abort', onAbort);controller.signal.removeEventListener('abort', onControllerAbort);active--; }
  } : undefined;
  const studyHandler = createStudyHandler({ dataDir: studyDataDir || path.join(path.resolve(root), '.local', 'learning'), model: studyModel });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const authority = requestAuthority(req, config);
      const pathname = requestPath(req.url);
      if (pathname.startsWith('/api/v1/')) {
        checkOrigin(req, authority, config, !['GET', 'HEAD'].includes(req.method));
        if (await studyHandler(req, res, pathname)) return;
      }
      if (pathname === '/api/ai/config') {
        if (req.method !== 'GET') throw new RequestError(405, 'method_not_allowed', '配置端点只支持GET。');
        checkOrigin(req, authority, config);
        return sendJson(res, 200, { configured: Boolean(config.apiKey && config.model), model: config.model, allowedModels: config.allowedModels });
      }
      if (pathname === '/api/ai/chat') {
        if (req.method !== 'POST') throw new RequestError(405, 'method_not_allowed', '模型端点只支持POST。');
        checkOrigin(req, authority, config, true);
        const payload = chatInput(await readJson(req, config.maxBodyBytes), config);
        if (!config.apiKey || !config.model) throw new RequestError(503, 'model_not_configured', '模型服务尚未配置。请由运营者在服务端设置EDU_AIGC_API_KEY和EDU_AIGC_MODEL后重启；页面不会保存或索取密钥。');
        if (active >= config.maxConcurrent) throw new RequestError(429, 'server_busy', '当前生成任务较多，请稍后再试。');
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', onClose);
        let onAbort;
        const aborted = new Promise((_resolve, reject) => {
          onAbort = () => reject(new RequestError(timedOut ? 504 : 502, timedOut ? 'upstream_timeout' : 'request_interrupted', timedOut ? '模型响应超时，请稍后核对后重试。' : '请求已中断。'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        active += 1;
        try {
          const upstreamTask = (async () => {
            const response = await fetchImpl(config.apiUrl, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload) });
            if (!response.ok) {
              await response.body?.cancel().catch(() => {});
              throw new RequestError(response.status === 429 ? 429 : 502, response.status === 429 ? 'upstream_rate_limited' : 'upstream_error', response.status === 429 ? '模型服务请求频率受限，请稍后重试。' : '模型服务暂时不可用，请由运营者核对配置；上游错误详情未公开。');
            }
            return responseJson(response, config, controller);
          })();
          const data = await Promise.race([upstreamTask, aborted]);
          if (timedOut) throw new RequestError(504, 'upstream_timeout', '模型响应超时，请稍后核对后重试。');
          return sendJson(res, 200, data);
        } catch (error) {
          if (timedOut) throw new RequestError(504, 'upstream_timeout', '模型响应超时，请稍后核对后重试。');
          if (error instanceof RequestError) throw error;
          throw new RequestError(502, 'upstream_unavailable', '模型服务连接失败，请稍后重试或联系运营者。');
        } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); res.off('close', onClose); active -= 1; }
      }
      if (pathname.startsWith('/api/')) throw new RequestError(404, 'not_found', '接口不存在。');
      return await staticFile(req, res, pathname === '/study' || pathname.startsWith('/study/') ? '/study.html' : pathname, path.resolve(root));
    } catch (error) {
      if (error instanceof RequestError) fail(res, error.status, error.code, error.message);
      else fail(res, 500, 'internal_error', '本地服务处理失败。');
    }
  });
  server.headersTimeout = 10000;
  // Large textbook uploads stream to the private store; JSON bodies retain their own short read deadline.
  server.requestTimeout = 600000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const port = integer(process.env.PORT, 3285, 1, 65535, 'PORT');
    const server = createServer();
    server.on('error', () => { console.error('本地服务启动失败，请检查端口和配置。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`教师工作台：http://127.0.0.1:${port}（密钥仅保留于服务端）`));
  } catch { console.error('模型或端口配置无效，请核对docs/model-proxy.md。'); process.exitCode = 1; }
}
