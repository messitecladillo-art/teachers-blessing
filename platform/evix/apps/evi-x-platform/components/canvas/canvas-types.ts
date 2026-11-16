export type CanvasNode = { id: string; kind: string; title: string; config: Record<string, unknown>; disabled?: boolean };
export type CanvasEdge = { id: string; source: string; sourcePort: string; target: string; targetPort: string; kind: 'data' | 'control' | 'reference' };
export type CanvasDefinition = { schemaVersion: 'research-workflow/v1'; nodes: CanvasNode[]; edges: CanvasEdge[] };
export type CanvasLayout = { positions: Record<string, { x: number; y: number }>; groups: { id: string; title: string; nodeIds: string[]; collapsed: boolean }[]; revision?: number };
export type CanvasDocument = { definition: CanvasDefinition; layout: CanvasLayout };
export type CatalogEntry = { kind: string; title: string; category: string; description: string; executor: string; editorSection?: string; inputs: { id: string; type: string; required?: boolean; multiple?: boolean; accepts?: string[] }[]; outputs: { id: string; type: string }[]; configFields: { key: string; label: string; type: string; required?: boolean; options?: unknown[]; default?: unknown; min?: number; max?: number; maxLength?: number }[] };
export type CanvasNodeRun = { nodeId: string; kind: string; status: string; attempt: number; inputHash?: string; result?: Record<string, unknown>; errorCode?: string; startedAt?: string; finishedAt?: string };
export type CanvasRunEvent = { sequence: number; nodeId?: string; type: string; at: string; payload?: Record<string, unknown> };
export type CanvasRun = { id: string; projectId: string; workflowVersionId: string; status: string; createdAt: string; updatedAt: string; unknownCount: number; nodes: CanvasNodeRun[]; events?: CanvasRunEvent[] };
export type CanvasIssue = { code: string; message: string; nodeId?: string; edgeId?: string };
export const EMPTY_CANVAS: CanvasDocument = { definition: { schemaVersion: 'research-workflow/v1', nodes: [], edges: [] }, layout: { positions: {}, groups: [] } };
export const cloneCanvas = (value: CanvasDocument): CanvasDocument => structuredClone(value);
export function removeCanvasNodes(document: CanvasDocument, ids: readonly string[]): CanvasDocument {
  const selected = new Set(ids), next = cloneCanvas(document);
  next.definition.nodes = next.definition.nodes.filter(node => !selected.has(node.id));
  next.definition.edges = next.definition.edges.filter(edge => !selected.has(edge.source) && !selected.has(edge.target));
  next.layout.positions = Object.fromEntries(Object.entries(next.layout.positions).filter(([id]) => !selected.has(id)));
  next.layout.groups = next.layout.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !selected.has(id)) })).filter(group => group.nodeIds.length);
  return next;
}
export function duplicateCanvasNodes(document: CanvasDocument, ids: readonly string[], makeId: () => string): { document: CanvasDocument; ids: string[] } {
  const selected = new Set(ids), next = cloneCanvas(document), aliases = new Map<string, string>();
  document.definition.nodes.filter(node => selected.has(node.id)).forEach(node => {
    const id = makeId(); aliases.set(node.id, id);
    next.definition.nodes.push({ ...structuredClone(node), id, title: `${node.title} · 副本` });
    const p = document.layout.positions[node.id] ?? { x: 0, y: 0 }; next.layout.positions[id] = { x: p.x + 48, y: p.y + 48 };
  });
  document.definition.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)).forEach(edge => next.definition.edges.push({ ...edge, id: makeId(), source: aliases.get(edge.source)!, target: aliases.get(edge.target)! }));
  return { document: next, ids: [...aliases.values()] };
}
export const RUN_LABELS: Record<string, string> = { pending: '待运行', queued: '排队', running: '运行中', waiting: '等待', waiting_review: '等待确认', waiting_input: '等待输入', waiting_collection: '等待回收', waiting_data: '等待回收', wait_expired: '回收期限已到', succeeded: '完成', completed: '完成', ready: '完成', partial: '部分完成', skipped: '跳过', failed: '失败', blocked: '输入阻塞', rejected: '已拒绝', cancelled: '已取消', cancel_requested: '正在停止', outcome_unknown: '待对账', unknown: '待对账' };
export const isRunTerminal = (status: string) => ['succeeded', 'completed', 'failed', 'cancelled', 'partial'].includes(status);
