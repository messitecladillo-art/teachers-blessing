'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseWorkflow, validateCanvasLayout } from '@evix/shared/workflow';
import { EMPTY_CANVAS, cloneCanvas, isRunTerminal, type CanvasDocument, type CanvasIssue, type CanvasRun, type CanvasNode, type CanvasNodeRun } from './canvas-types';

export type CanvasRequest = (path: string, init?: RequestInit) => Promise<unknown>;
export type CanvasProjectProps = { projectId: string | null; projectTitle: string; userId?: string; csrf?: string; request?: CanvasRequest; artifactRefs?: Record<string, unknown>; active?: boolean; writable?: boolean; onOpenEditor: (section: string, nodeId?: string, context?: { node: CanvasNode; run?: CanvasNodeRun }) => void; onExitCanvas?: () => void };
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const unique = () => crypto.randomUUID();
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '请求未完成，请重试。'; }
type Head = { revision: number; id?: string; versionId?: string; definition: CanvasDocument['definition']; layout: CanvasDocument['layout']; layoutRevision: number; view?: { viewport: { x: number; y: number; zoom: number }; selectedNodeIds: string[]; motion: 'standard' | 'reduced' | 'off'; transparency: number } };
type Draft = { baseRevision: number; baseLayoutRevision: number; document: CanvasDocument; graphKey?: string; layoutKey?: string };
function checkedDocument(value: CanvasDocument): CanvasDocument { const definition = parseWorkflow(value.definition); return { definition, layout: validateCanvasLayout(value.layout, definition.nodes.map(node => node.id)) }; }

export function useCanvasProject({ projectId, userId, request, active = true, writable = true }: CanvasProjectProps) {
  const [document, setDocument] = useState<CanvasDocument>(cloneCanvas(EMPTY_CANVAS));
  const [loading, setLoading] = useState(true), [saveState, setSaveState] = useState('读取中');
  const [notice, setNotice] = useState(''), [issues, setIssues] = useState<CanvasIssue[]>([]);
  const [run, setRun] = useState<CanvasRun | null>(null), [runs, setRuns] = useState<CanvasRun[]>([]);
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [datasets, setDatasets] = useState<{ id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' }[]>([]);
  const [serverView, setServerView] = useState<Head['view']>(undefined);
  const sourceProposalId = useRef<string | null>(null);
  const runIntent = useRef<{ body: string; key: string } | null>(null);
  const revision = useRef(0), layoutRevision = useRef(0), versionId = useRef<string | null>(null);
  const snapshot = useRef(document), persisted = useRef({ graph: '', layout: '' }), saving = useRef(false), epoch = useRef(0);
  const saveWaiters = useRef(new Set<() => void>());
  const intents = useRef<{ graph?: { value: string; key: string }; layout?: { value: string; key: string } }>({});
  const storageKey = `evix:canvas:draft:${userId ?? 'local'}:${projectId ?? 'workspace'}`;
  const prefix = projectId ? `/api/projects/${encodeURIComponent(projectId)}` : '';
  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!request || !projectId) throw Error('请打开已登录的项目以使用后台运行。');
    return await request(`${prefix}${path}`, init) as T;
  }, [request, projectId, prefix]);
  const update = useCallback((next: CanvasDocument) => { if (!writable) return; snapshot.current = next; setDocument(next); setSaveState(projectId ? '待保存' : '本地草稿'); }, [projectId, writable]);

  useEffect(() => {
    const token = ++epoch.current;
    let cancelled = false;
    revision.current = 0; layoutRevision.current = 0; versionId.current = null; intents.current = {};
    const restoreLocal = () => {
      try { const stored = sessionStorage.getItem(storageKey); if (stored) { const draft = JSON.parse(stored) as Draft; return { ...draft, document: checkedDocument(draft.document) }; } } catch { /* invalid drafts are not applied */ }
      return null;
    };
    const install = (next: CanvasDocument, label: string, server?: CanvasDocument) => {
      if (cancelled || epoch.current !== token) return;
      snapshot.current = next; setDocument(next); persisted.current = { graph: JSON.stringify((server ?? next).definition), layout: JSON.stringify((server ?? next).layout) }; setSaveState(label); setLoading(false);
    };
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true); setConflict(false); setRun(null); setRuns([]); setIssues([]); setDatasets([]); setServerView(undefined); setBusy(false); sourceProposalId.current = null; runIntent.current = null;
      if (!projectId || !request) { install(restoreLocal()?.document ?? cloneCanvas(EMPTY_CANVAS), '本地草稿'); return; }
      try {
        const head = await api<Head>('/workflow'); if (cancelled || epoch.current !== token) return;
        revision.current = head.revision; layoutRevision.current = head.layoutRevision ?? 0; versionId.current = head.id ?? head.versionId ?? null;
        setServerView(head.view);
        const server = checkedDocument({ definition: head.definition ?? EMPTY_CANVAS.definition, layout: head.layout ?? EMPTY_CANVAS.layout });
        const draft = restoreLocal();
        if (draft && JSON.stringify(draft.document) !== JSON.stringify(server)) {
          if (draft.baseRevision === head.revision && draft.baseLayoutRevision === layoutRevision.current) {
            install(draft.document, '恢复未保存草稿', server);
            if (draft.graphKey) intents.current.graph = { value: JSON.stringify(draft.document.definition), key: draft.graphKey };
            if (draft.layoutKey) intents.current.layout = { value: JSON.stringify(draft.document.layout), key: draft.layoutKey };
          } else { install(draft.document, '草稿存在版本冲突', server); setConflict(true); }
        } else install(server, head.revision ? `已保存 · v${head.revision}` : '尚未保存');
      } catch (error) { if (!cancelled && epoch.current === token) { install(cloneCanvas(EMPTY_CANVAS), '读取未完成'); setConflict(true); setNotice(errorMessage(error)); } }
      await Promise.allSettled([
        api<CanvasRun[] | { runs: CanvasRun[] }>('/workflow/runs').then(value => { if (!cancelled && epoch.current === token) { const list = Array.isArray(value) ? value : value.runs; setRuns(list ?? []); setRun(list?.[0] ?? null); } }),
        api<{ id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' }[] | { datasets: { id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' }[] }>('/datasets/versions').then(value => { if (!cancelled && epoch.current === token) setDatasets(Array.isArray(value) ? value : value.datasets ?? []); }),
      ]);
    });
    return () => { cancelled = true; };
  }, [api, projectId, request, storageKey]);

  useEffect(() => {
    const clear = () => { for (let index = sessionStorage.length - 1; index >= 0; index--) { const key = sessionStorage.key(index); if (key?.startsWith(`evix:canvas:draft:${userId ?? 'local'}:`)) sessionStorage.removeItem(key); } epoch.current++; };
    window.addEventListener('evix:identity-cleared', clear); return () => window.removeEventListener('evix:identity-cleared', clear);
  }, [userId]);

  const save = useCallback(async function persistLatest(): Promise<string | null> {
    if (loading || !writable) return null;
    const current = cloneCanvas(snapshot.current), token = epoch.current;
    const persistDraft = () => sessionStorage.setItem(storageKey, JSON.stringify({ baseRevision: revision.current, baseLayoutRevision: layoutRevision.current, document: current, graphKey: intents.current.graph?.key, layoutKey: intents.current.layout?.key } satisfies Draft));
    persistDraft();
    if (!projectId || !request) { setSaveState('本地已保存'); return null; }
    if (saving.current) { await new Promise<void>(resolve => saveWaiters.current.add(resolve)); if (token !== epoch.current) return null; return persistLatest(); }
    if (conflict) throw Error('云端版本已经变化；请先处理保存冲突。');
    saving.current = true; setSaveState('保存中');
    try {
      const graph = JSON.stringify(current.definition), layout = JSON.stringify(current.layout);
      if (graph !== persisted.current.graph || !versionId.current) {
        if (intents.current.graph?.value !== graph) intents.current.graph = { value: graph, key: unique() }; persistDraft();
        const response = await api<{ id: string; revision: number }>('/workflow/versions', json('POST', { expectedRevision: revision.current, idempotencyKey: intents.current.graph.key, definition: current.definition, ...(sourceProposalId.current ? { sourceProposalId: sourceProposalId.current } : {}) }));
        if (token !== epoch.current) return null;
        revision.current = response.revision; versionId.current = response.id; persisted.current.graph = graph; intents.current.graph = undefined; sourceProposalId.current = null;
      }
      if (layout !== persisted.current.layout) {
        if (intents.current.layout?.value !== layout) intents.current.layout = { value: layout, key: unique() }; persistDraft();
        const response = await api<{ layoutRevision: number }>('/workflow/layout', json('PUT', { expectedLayoutRevision: layoutRevision.current, idempotencyKey: intents.current.layout.key, layout: current.layout }));
        if (token !== epoch.current) return null;
        layoutRevision.current = response.layoutRevision; persisted.current.layout = layout; intents.current.layout = undefined;
      }
      const unchanged = graph === JSON.stringify(snapshot.current.definition) && layout === JSON.stringify(snapshot.current.layout);
      if (unchanged) sessionStorage.removeItem(storageKey); else persistDraft();
      setSaveState(unchanged ? `已保存 · v${revision.current}` : '待保存'); return versionId.current;
    } catch (error) {
      if (token !== epoch.current) return null;
      const message = errorMessage(error); setSaveState('保存未完成'); setNotice(message);
      if (/409|conflict|version|版本.*变化|版本.*冲突/i.test(message)) setConflict(true);
      throw error;
    } finally { saving.current = false; const waiters = [...saveWaiters.current]; saveWaiters.current.clear(); waiters.forEach(resolve => resolve()); }
  }, [api, conflict, loading, projectId, request, storageKey, writable]);
  useEffect(() => {
    if (loading || conflict || !writable) return;
    const timer = setTimeout(() => { void save().catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [document, loading, conflict, save, writable]);

  const runId = run?.id, runStatus = run?.status;
  useEffect(() => {
    if (!runId || !runStatus || !active || !projectId || !request || isRunTerminal(runStatus)) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null;
    const token = epoch.current, id = runId;
    const refresh = async () => {
      try {
        const next = await api<CanvasRun>(`/workflow/runs/${encodeURIComponent(id)}`);
        if (cancelled || epoch.current !== token) return;
        setRun(next); setRuns(list => [next, ...list.filter(item => item.id !== id)]);
        if (!isRunTerminal(next.status)) timer = setTimeout(refresh, /wait/.test(next.status) ? 10000 : 2000);
      } catch (error) { if (!cancelled && epoch.current === token) { setNotice(errorMessage(error)); timer = setTimeout(refresh, 5000); } }
    };
    timer = setTimeout(refresh, 1500);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [runId, runStatus, api, active, projectId, request]);

  const validate = useCallback(async (selectedNodeIds?: string[]) => {
    const token = epoch.current;
    const result = await api<{ valid: boolean; issues: CanvasIssue[]; nodeIds: string[] }>('/workflow/validate', json('POST', { definition: snapshot.current.definition, ...(selectedNodeIds?.length ? { selectedNodeIds } : {}) }));
    if (token === epoch.current) { setIssues(result.issues ?? []); setNotice(result.valid ? `检查通过 · ${result.nodeIds.length} 个节点` : `发现 ${result.issues.length} 个待处理项`); } return result;
  }, [api]);
  const execute = useCallback(async (mode: 'all' | 'selected' | 'single', selectedNodeIds?: string[], serviceBindings?: Record<string, { serviceId: string; serviceRevision: number }>) => {
    if (!writable) { setNotice('当前权限为查看'); return; }
    const token = epoch.current;
    setBusy(true);
    try {
      const validation = await validate(selectedNodeIds); if (!validation.valid || token !== epoch.current) return;
      const id = await save(); if (token !== epoch.current) return; if (!id) throw Error('流程尚未保存至项目。');
      const body = { workflowVersionId: id, mode, consent: true, ...(mode === 'single' && run?.workflowVersionId === id ? { upstreamRunId: run.id } : {}), ...(selectedNodeIds?.length ? { selectedNodeIds } : {}), ...(serviceBindings ? { serviceBindings } : {}) }, signature = JSON.stringify(body);
      if (runIntent.current?.body !== signature) runIntent.current = { body: signature, key: unique() };
      const next = await api<CanvasRun>('/workflow/runs', json('POST', { ...body, idempotencyKey: runIntent.current.key }));
      if (token !== epoch.current) return; runIntent.current = null;
      setRun(next); setRuns(list => [next, ...list]); setNotice('运行已创建');
    } catch (error) { if (token === epoch.current) setNotice(errorMessage(error)); } finally { if (token === epoch.current) setBusy(false); }
  }, [api, save, validate, writable, run]);
  const cancel = useCallback(async () => { if (!run) return; const token = epoch.current; try { const next = await api<CanvasRun>(`/workflow/runs/${run.id}/cancel`, json('POST', { idempotencyKey: unique() })); if (token === epoch.current) setRun(next); } catch (error) { if (token === epoch.current) setNotice(errorMessage(error)); } }, [run, api]);
  const decide = useCallback(async (nodeId: string, action: string, values?: Record<string, unknown>) => {
    const node = run?.nodes.find(item => item.nodeId === nodeId); if (!run || !node) return;
    const token = epoch.current;
    try { const next = await api<CanvasRun>(`/workflow/runs/${run.id}/decisions`, json('POST', { idempotencyKey: unique(), nodeId, expectedAttempt: node.attempt, action, inputHash: node.inputHash, values })); if (token === epoch.current) { setRun(next); setNotice('决定已保存'); } } catch (error) { if (token === epoch.current) setNotice(errorMessage(error)); }
  }, [run, api]);
  return { document, update, loading, saveState, notice, setNotice, issues, setIssues, run, setRun, runs, busy, conflict, save, validate, execute, cancel, decide, api, datasets, serverView, getRevision: () => revision.current, getVersionId: () => versionId.current, bindProposal: (id: string) => { sourceProposalId.current = id; } };
}
