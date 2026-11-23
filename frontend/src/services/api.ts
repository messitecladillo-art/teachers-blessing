export async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
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
  const resp = await fetch(url, {
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
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/sources/upload', { method: 'POST', body: form });
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
  const resp = await fetch(url, {
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
