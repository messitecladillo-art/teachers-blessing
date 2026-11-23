let demoRuntimePromise: Promise<typeof import('./demoRuntime')> | null = null;

function loadDemoRuntime(): Promise<typeof import('./demoRuntime')> {
  if (!demoRuntimePromise) {
    demoRuntimePromise = import('./demoRuntime');
  }
  return demoRuntimePromise;
}

export const API_BASE_STORAGE_KEY = 'eduforge_api_base';

export function getApiBase(): string {
  try {
    const saved =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(API_BASE_STORAGE_KEY)
        : '';
    const envBase = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE || '';
    return String(saved || envBase || '')
      .trim()
      .replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setApiBase(nextBase: string): string {
  const clean = String(nextBase || '')
    .trim()
    .replace(/\/+$/, '');
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (clean) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, clean);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    }
  } catch {
    /* ignore storage unavailable */
  }
  return clean;
}

export function isStaticDemoMode(): boolean {
  if (getApiBase()) return false;
  const env = (import.meta as { env?: Record<string, unknown> }).env || {};
  if (env.DEV) return false;
  if (typeof window !== 'undefined' && ['8008', '8000'].includes(window.location.port)) {
    return false;
  }
  return true;
}

export function resolveApiUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base = getApiBase();
  if (!base) return url;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

export function handleSafeDownload(
  e: { preventDefault: () => void },
  url?: string | null,
  fallbackFilename?: string
): void {
  if (!url) return;
  if (isStaticDemoMode()) {
    e.preventDefault();
    void loadDemoRuntime().then((m) => m.downloadStaticDemoFile(url, fallbackFilename));
  }
}

export async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  if (isStaticDemoMode()) {
    const m = await loadDemoRuntime();
    return m.demoApiJson<T>(url, options);
  }
  const resp = await fetch(resolveApiUrl(url), {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err.detail || err.message || detail;
    } catch {
      detail = (await resp.text()) || detail;
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export interface StreamCallbacks<TResult> {
  onStage?: (stage: string, message: string) => void;
  onThinking?: (delta: string) => void;
  onText?: (delta: string) => void;
  onResult: (data: TResult) => void;
  onError?: (message: string) => void;
}

export async function postSseStream<TResult>(
  url: string,
  body: unknown,
  callbacks: StreamCallbacks<TResult>
): Promise<void> {
  if (isStaticDemoMode()) {
    const m = await loadDemoRuntime();
    await m.demoSseStream(
      url,
      (body && typeof body === 'object' ? body : {}) as Record<string, unknown>,
      {
        onStage: callbacks.onStage,
        onThinking: callbacks.onThinking,
        onText: callbacks.onText,
        onResult: (data) => callbacks.onResult(data as TResult),
        onError: callbacks.onError,
      }
    );
    return;
  }

  const resp = await fetch(resolveApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    const errTxt = await resp.text();
    throw new Error(errTxt || `SSE 请求失败 (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = 'message';

  const dispatch = (evt: string, rawData: string) => {
    if (!rawData) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }
    if (evt === 'stage') {
      callbacks.onStage?.(String(parsed.stage || ''), String(parsed.message || ''));
    } else if (evt === 'thinking') {
      callbacks.onThinking?.(String(parsed.delta || ''));
    } else if (evt === 'text') {
      callbacks.onText?.(String(parsed.delta || ''));
    } else if (evt === 'result') {
      callbacks.onResult(parsed as unknown as TResult);
    } else if (evt === 'error') {
      callbacks.onError?.(String(parsed.message || '未知流式错误'));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const rawData = line.slice(5).trim();
        dispatch(currentEvent, rawData);
      }
    }
  }
}

export async function uploadSourceFile(file: File): Promise<{
  source_id: string;
  filename: string;
  converter: string;
  char_count: number;
  chunk_count?: number;
  quality_note?: string;
  chapters_preview?: string[];
  markdown_preview: string;
  markdown_full: string;
}> {
  if (isStaticDemoMode()) {
    const m = await loadDemoRuntime();
    return m.demoUploadFile(file);
  }
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(resolveApiUrl('/api/sources/upload'), { method: 'POST', body: form });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || '文件上传解析失败');
  }
  return await resp.json();
}

export async function postEventStream(
  url: string,
  body: unknown,
  onEvent: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  if (isStaticDemoMode()) {
    const m = await loadDemoRuntime();
    await m.demoEventStream(url, (body && typeof body === 'object' ? body : {}) as Record<string, unknown>, onEvent);
    return;
  }
  const resp = await fetch(resolveApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const errTxt = await resp.text();
    throw new Error(errTxt || `请求失败 (${resp.status})`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = 'message';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(currentEvent, JSON.parse(raw) as Record<string, unknown>);
        } catch {
          /* ignore malformed event chunk */
        }
      }
    }
  }
}
