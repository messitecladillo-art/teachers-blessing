import path from 'node:path';
import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const COLLECTIONS = Object.freeze(['users', 'sessions', 'folders', 'textbooks', 'workshops', 'materials', 'fileRecords', 'conversations', 'messages', 'jobs', 'chapters', 'knowledgePoints', 'lessons', 'exercises', 'attempts', 'artifacts', 'highlights', 'feedbacks', 'ledger', 'activity']);
const MAX_STORE_BYTES = 64 * 1024 * 1024;
const empty = () => Object.fromEntries([['schema', 1], ...COLLECTIONS.map(name => [name, []])]);
const clone = value => structuredClone(value);

function validate(value) {
  if (!value || value.schema !== 1 || Object.keys(value).some(key => key !== 'schema' && !COLLECTIONS.includes(key))) throw new Error('Unsupported study store schema');
  for (const name of COLLECTIONS) {
    if (!Array.isArray(value[name]) || value[name].length > 20000 || value[name].some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || row.id.length > 100)) throw new Error('Invalid study store collection');
    if (new Set(value[name].map(row => row.id)).size !== value[name].length) throw new Error('Duplicate study record identity');
  }
  return value;
}

/** Single-process serialized transactions. No filesystem access until first use. */
export function createStudyStore({ dataDir } = {}) {
  if (!dataDir) throw new Error('A private study data directory is required');
  const directory = path.resolve(dataDir), filename = path.join(directory, 'study.json');
  let state, loading, queue = Promise.resolve();
  async function load() {
    if (!loading) loading = (async () => {
      try {
        const info = await stat(filename);
        if (!info.isFile() || info.size > MAX_STORE_BYTES) throw new Error('Study store exceeds its storage bound');
        state = validate(JSON.parse(await readFile(filename, 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        state = empty();
      }
    })();
    await loading;
  }
  async function persist(next) {
    validate(next);
    const json = JSON.stringify(next, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite study value');
      return value;
    });
    if (Buffer.byteLength(json) > MAX_STORE_BYTES) throw new Error('Study store exceeds its storage bound');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.study-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(json, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, filename);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return JSON.parse(json);
  }
  return Object.freeze({
    async snapshot() { await load(); await queue.catch(() => {}); return clone(state); },
    mutate(fn) {
      if (typeof fn !== 'function') return Promise.reject(new TypeError('A transaction function is required'));
      const operation = queue.then(async () => {
        await load();
        const draft = clone(state), result = await fn(draft);
        const published = await persist(draft);
        state = published;
        return clone(result);
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  });
}
