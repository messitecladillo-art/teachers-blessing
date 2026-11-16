'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, SelectionMode, useReactFlow, type Connection, type NodeChange, type Edge, type Viewport } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { WORKFLOW_CATALOG, parseWorkflow, validateCanvasLayout } from '@evix/shared/workflow';
import { canvasDetailLevel, createCanvasMotion, snapCanvasPosition, interpolateCanvasPositions, type CanvasMotionPreference } from '@/lib/canvas-motion';
import CanvasNodeView, { type ResearchFlowNode } from './CanvasNodeView';
import CanvasInspector from './CanvasInspector';
import CanvasConnectionPanel from './CanvasConnectionPanel';
import { rejectDuplicateMembers } from '@/lib/questionnaire';
import { cloneCanvas, duplicateCanvasNodes, removeCanvasNodes, RUN_LABELS, isRunTerminal, type CanvasDocument, type CanvasNode, type CatalogEntry } from './canvas-types';
import { useCanvasProject, type CanvasProjectProps } from './useCanvasProject';
import { connectedDatasetColumns, stableCanvasSelection } from './canvas-inspection';
import '@xyflow/react/dist/style.css';
import styles from './ResearchCanvas.module.css';

const CATALOG = WORKFLOW_CATALOG as unknown as CatalogEntry[];
const NODE_TYPES = { research: CanvasNodeView };
const entry = (kind: string) => CATALOG.find(item => item.kind === kind)!;
const id = () => crypto.randomUUID();
const exportJson = (data: unknown, filename: string) => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const defaults = (catalog: CatalogEntry) => Object.fromEntries(catalog.configFields.filter(field => field.default !== undefined).map(field => [field.key, structuredClone(field.default)]));
type Preview = { document: CanvasDocument; label: string; baseDefinition?: string; layoutOnly?: boolean; sourceProposalId?: string };
type ViewPreference = { viewport?: Viewport; motion: CanvasMotionPreference; transparency: number };

function CanvasContent(props: CanvasProjectProps) {
  const { onOpenEditor } = props;
  const { document: canvas, update, loading, saveState, notice, setNotice, issues, setIssues, run, setRun, runs, busy, conflict, save, validate, execute, cancel, decide, api, datasets: savedDatasets, getRevision, getVersionId, serverView, bindProposal } = useCanvasProject(props);
  const flow = useReactFlow<ResearchFlowNode>();
  const scope = useRef<HTMLDivElement>(null), docRef = useRef(canvas);
  useLayoutEffect(() => { docRef.current = canvas; }, [canvas]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [panel, setPanel] = useState<'library' | 'inspector' | 'settings' | 'history' | 'connect' | 'proposal' | null>(null);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('全部');
  const [logsOpen, setLogsOpen] = useState(false), [mapOpen, setMapOpen] = useState(false), [focusMode, setFocusMode] = useState(false), [moreOpen, setMoreOpen] = useState(false);
  const [zoom, setZoom] = useState(1), [preference, setPreference] = useState<ViewPreference>({ motion: 'standard', transparency: 85 });
  const [viewOwner, setViewOwner] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null), [ghosts, setGhosts] = useState<ResearchFlowNode[]>([]), [freshIds, setFreshIds] = useState<string[]>([]);
  const [animatedPositions, setAnimatedPositions] = useState<CanvasDocument['layout']['positions'] | null>(null);
  const coordinates = useRef<CanvasDocument['layout']['positions'] | null>(null), layoutFrame = useRef<number | null>(null);
  const [connectSource, setConnectSource] = useState(''), [connectTarget, setConnectTarget] = useState('');
  const [connectKind, setConnectKind] = useState<'data' | 'control' | 'reference'>('data');
  const [proposalText, setProposalText] = useState(''), [serviceId, setServiceId] = useState(''), [serviceRevision, setServiceRevision] = useState(1), [proposalBusy, setProposalBusy] = useState(false);
  const [runPreview, setRunPreview] = useState<{ mode: 'all' | 'selected' | 'single'; nodeIds: string[]; selected?: string[]; baseDefinition: string } | null>(null);
  const [runConsent, setRunConsent] = useState(false), [proposalConsent, setProposalConsent] = useState(false);
  const [serviceBindings, setServiceBindings] = useState<Record<string, { serviceId: string; serviceRevision: number }>>({});
  const [pendingUpload, setPendingUpload] = useState<{ name: string; csv: string; classification: 'actual' | 'simulated'; idempotencyKey: string; targetNodeId?: string } | null>(null), [uploadBusy, setUploadBusy] = useState(false);
  const [uploadedDatasets, setUploadedDatasets] = useState<{ id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' }[]>([]);
  const history = useRef<CanvasDocument[]>([]), future = useRef<CanvasDocument[]>([]), dragStart = useRef<CanvasDocument | null>(null);
  const importFile = useRef<HTMLInputElement>(null), uploadFile = useRef<HTMLInputElement>(null);
  const fileEpoch = useRef(0);
  const eventCursor = useRef<{ id: string | null; sequence: number }>({ id: null, sequence: 0 });
  const proposalIntent = useRef<{ body: string; key: string } | null>(null);
  const viewTouched = useRef(false), viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>()), preferenceRef = useRef(preference.motion);
  useEffect(() => { preferenceRef.current = preference.motion; }, [preference.motion]);
  const motion = useRef<ReturnType<typeof createCanvasMotion> | null>(null);
  const localScope = `${props.userId ?? 'local'}:${props.projectId ?? 'workspace'}`;
  const viewKey = `evix:canvas:view:${localScope}`;
  const selected = canvas.definition.nodes.find(node => node.id === selectedIds[0]);
  const selectedCatalog = selected ? entry(selected.kind) : null;
  const runMap = useMemo(() => new Map(run?.nodes.map(node => [node.nodeId, node]) ?? []), [run?.nodes]);
  const detail = canvasDetailLevel(zoom);
  const datasets = [...uploadedDatasets, ...savedDatasets, ...(Array.isArray(props.artifactRefs?.datasets) ? props.artifactRefs.datasets as { id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' }[] : [])].filter((item, index, list) => list.findIndex(other => other.id === item.id) === index);
  const services = Array.isArray(props.artifactRefs?.services) ? props.artifactRefs.services as { id: string; title?: string; name?: string; revision?: number }[] : [];

  const later = useCallback((callback: () => void, delay: number) => { const timer = setTimeout(() => { timers.current.delete(timer); callback(); }, delay); timers.current.add(timer); }, []);
  const stopLayoutMotion = useCallback(() => { if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current); layoutFrame.current = null; coordinates.current = null; setAnimatedPositions(null); }, []);
  const animateLayout = useCallback((from: CanvasDocument['layout']['positions'], to: CanvasDocument['layout']['positions']) => {
    if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current);
    if (preferenceRef.current !== 'standard' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) { coordinates.current = null; setAnimatedPositions(null); return; }
    const began = performance.now(); coordinates.current = from; setAnimatedPositions(from);
    const frame = (time: number) => { const progress = Math.min(1, (time - began) / 300), points = interpolateCanvasPositions(from, to, progress); coordinates.current = points; setAnimatedPositions(points); if (progress < 1) layoutFrame.current = requestAnimationFrame(frame); else { layoutFrame.current = null; coordinates.current = null; setAnimatedPositions(null); } };
    layoutFrame.current = requestAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const root = scope.current; if (!root) return;
    const instance = createCanvasMotion(root, () => preferenceRef.current), pendingTimers = timers.current; motion.current = instance;
    const visibility = () => { root.dataset.pageHidden = String(document.hidden); if (document.hidden) { instance.cancel(); stopLayoutMotion(); } };
    document.addEventListener('visibilitychange', visibility);
    return () => { instance.dispose(); motion.current = null; pendingTimers.forEach(clearTimeout); pendingTimers.clear(); document.removeEventListener('visibilitychange', visibility); if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current); };
  }, [stopLayoutMotion]);
  useEffect(() => { if (props.active === false || preference.motion !== 'standard') { motion.current?.cancel(); const frame = requestAnimationFrame(stopLayoutMotion); return () => cancelAnimationFrame(frame); } }, [props.active, preference.motion, stopLayoutMotion]);
  useEffect(() => {
    if (!run) return;
    const events = run.events ?? [], maximum = Math.max(0, ...events.map(event => event.sequence));
    if (eventCursor.current.id !== run.id) { eventCursor.current = { id: run.id, sequence: maximum }; return; }
    const unseen = events.filter(event => event.sequence > eventCursor.current.sequence);
    eventCursor.current.sequence = maximum;
    if (props.active === false || !scope.current || !motion.current) return;
    unseen.filter(event => event.nodeId && /complete|succeed|result|received|ready/i.test(event.type)).forEach(event => {
      const element = [...scope.current!.querySelectorAll<HTMLElement>('[data-canvas-node]')].find(item => item.dataset.canvasNode === event.nodeId)?.querySelector(`.${styles.nodeDescription}`);
      if (element) motion.current?.animate(element, [{ opacity: .35, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], 'enter');
      docRef.current.definition.edges.filter(edge => edge.source === event.nodeId && edge.kind === 'data').forEach(edge => {
        const path = [...scope.current!.querySelectorAll('[data-id]')].find(item => item.getAttribute('data-id') === edge.id)?.querySelector('.react-flow__edge-path');
        if (path) motion.current?.animate(path, [{ strokeDasharray: '8 80', strokeDashoffset: '88', opacity: .6 }, { strokeDasharray: '8 80', strokeDashoffset: '-88', opacity: 1 }], 'transfer');
      });
    });
  }, [run, props.active]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try { const value = JSON.parse(localStorage.getItem(viewKey) ?? 'null') as ViewPreference | null; if (value && ['standard', 'reduced', 'off'].includes(value.motion) && Number.isFinite(value.transparency)) { setPreference(value); if (value.viewport) void flow.setViewport(value.viewport); } } catch { /* use defaults */ }
      setSelectedIds([]); setServiceBindings({}); setPendingUpload(null); setUploadedDatasets([]); setViewOwner(viewKey); viewTouched.current = false; history.current = []; future.current = [];
    });
    const clearFiles = () => { fileEpoch.current++; setPendingUpload(null); setUploadedDatasets([]); setServiceBindings({}); proposalIntent.current = null; };
    window.addEventListener('evix:identity-cleared', clearFiles);
    return () => { cancelled = true; clearFiles(); window.removeEventListener('evix:identity-cleared', clearFiles); };
  }, [viewKey, flow]);
  useEffect(() => {
    if (!serverView || viewTouched.current || !['standard', 'reduced', 'off'].includes(serverView.motion)) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (cancelled || viewTouched.current) return; setPreference({ motion: serverView.motion, transparency: Math.round(serverView.transparency * 100), viewport: serverView.viewport }); setSelectedIds(serverView.selectedNodeIds.filter(nodeId => docRef.current.definition.nodes.some(node => node.id === nodeId))); void flow.setViewport(serverView.viewport); });
    return () => { cancelled = true; };
  }, [serverView, flow]);
  const storeView = useCallback((viewport?: Viewport) => {
    if (viewOwner !== viewKey) return;
    const state = { ...preference, viewport: viewport ?? flow.getViewport() }; localStorage.setItem(viewKey, JSON.stringify(state));
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    if (props.projectId && props.request && props.active !== false) viewSaveTimer.current = setTimeout(() => { void api('/workflow/view', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewport: state.viewport, selectedNodeIds: selectedIds, motion: state.motion, transparency: state.transparency / 100 }) }).catch(() => {}); }, 800);
  }, [flow, preference, viewKey, viewOwner, selectedIds, props.projectId, props.request, props.active, api]);
  useEffect(() => { storeView(); }, [storeView]);
  useEffect(() => () => { if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current); }, []);

  const commit = useCallback((next: CanvasDocument, remember = true) => { if (props.writable === false) return; if (remember) { history.current.push(cloneCanvas(docRef.current)); if (history.current.length > 60) history.current.shift(); future.current = []; } update(next); }, [update, props.writable]);
  const undo = useCallback(() => { const previous = history.current.pop(); if (!previous) return; future.current.push(cloneCanvas(docRef.current)); update(previous); setGhosts([]); motion.current?.cancel(); setNotice('已撤销'); }, [update, setNotice]);
  const redo = useCallback(() => { const next = future.current.pop(); if (!next) return; history.current.push(cloneCanvas(docRef.current)); update(next); setNotice('已恢复'); }, [update, setNotice]);
  const fresh = useCallback((ids: string[]) => { setFreshIds(ids.slice(0, 8)); later(() => setFreshIds([]), 650); }, [later]);
  const addNode = useCallback((kind: string, point?: { x: number; y: number }) => {
    const catalog = entry(kind); if (!catalog || docRef.current.definition.nodes.length >= 200) { setNotice('画布最多容纳 200 个节点'); return; }
    const next = cloneCanvas(docRef.current), nodeId = id(), position = point ?? flow.screenToFlowPosition({ x: (scope.current?.getBoundingClientRect().left ?? 0) + 400, y: (scope.current?.getBoundingClientRect().top ?? 0) + 240 });
    next.definition.nodes.push({ id: nodeId, kind, title: catalog.title, config: defaults(catalog) }); next.layout.positions[nodeId] = snapCanvasPosition(position);
    commit(next); setSelectedIds([nodeId]); setPanel('inspector'); fresh([nodeId]);
  }, [commit, flow, fresh, setNotice]);
  const duplicate = useCallback(() => { if (docRef.current.definition.nodes.length + selectedIds.length > 200) { setNotice('画布最多容纳 200 个节点'); return; } const next = duplicateCanvasNodes(docRef.current, selectedIds, id); commit(next.document); setSelectedIds(next.ids); fresh(next.ids); }, [commit, fresh, selectedIds, setNotice]);
  const remove = useCallback(() => {
    if (selectedIds.length) {
      const current = docRef.current;
      setGhosts(current.definition.nodes.filter(node => selectedIds.includes(node.id)).map(node => ({ id: `ghost-${node.id}`, type: 'research', position: current.layout.positions[node.id] ?? { x: 0, y: 0 }, data: { node, catalog: entry(node.kind), detail, exiting: true }, selectable: false, draggable: false, connectable: false, focusable: false, style: { pointerEvents: 'none' } })));
      commit(removeCanvasNodes(current, selectedIds)); setSelectedIds([]); setPanel(null); later(() => setGhosts([]), preference.motion === 'standard' ? 180 : 0);
    } else if (selectedEdgeIds.length) { const next = cloneCanvas(docRef.current); next.definition.edges = next.definition.edges.filter(edge => !selectedEdgeIds.includes(edge.id)); commit(next); setSelectedEdgeIds([]); }
  }, [commit, detail, later, preference.motion, selectedEdgeIds, selectedIds]);
  const updateNode = useCallback((node: CanvasNode) => { const next = cloneCanvas(docRef.current); next.definition.nodes = next.definition.nodes.map(item => item.id === node.id ? node : item); commit(next); }, [commit]);

  const connectionProblem = useCallback((connection: Connection) => {
    const source = docRef.current.definition.nodes.find(node => node.id === connection.source), target = docRef.current.definition.nodes.find(node => node.id === connection.target);
    if (!source || !target || source.id === target.id) return '请选择两个不同节点';
    const output = entry(source.kind)?.outputs.find(port => port.id === connection.sourceHandle), input = entry(target.kind)?.inputs.find(port => port.id === connection.targetHandle);
    if (!output || !input || (output.type !== input.type && !input.accepts?.includes(output.type))) return '输入和输出类型不匹配';
    if (!input.multiple && docRef.current.definition.edges.some(edge => edge.kind === 'data' && edge.target === target.id && edge.targetPort === input.id)) return '此输入已有连接，请先断开';
    if (docRef.current.definition.edges.some(edge => edge.source === source.id && edge.sourcePort === output.id && edge.target === target.id && edge.targetPort === input.id)) return '该连接已存在';
    return '';
  }, []);
  const connect = useCallback((connection: Connection) => {
    const problem = connectionProblem(connection); if (problem) { setNotice(problem); return; }
    if (docRef.current.definition.edges.length >= 500) { setNotice('画布最多容纳 500 条连接'); return; }
    const next = cloneCanvas(docRef.current); next.definition.edges.push({ id: id(), source: connection.source!, sourcePort: connection.sourceHandle!, target: connection.target!, targetPort: connection.targetHandle!, kind: 'data' }); commit(next); setNotice('连接已建立');
  }, [commit, connectionProblem, setNotice]);
  const toggleGroup = useCallback((groupId: string) => { const next = cloneCanvas(docRef.current); next.layout.groups = next.layout.groups.map(group => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group); commit(next); }, [commit]);
  const openEditor = useCallback((section: string, nodeId: string) => { const node = docRef.current.definition.nodes.find(item => item.id === nodeId); onOpenEditor(section, nodeId, node ? { node, run: runMap.get(nodeId) } : undefined); }, [onOpenEditor, runMap]);
  const onSelectionChange = useCallback(({ nodes, edges }: { nodes: ResearchFlowNode[]; edges: Edge[] }) => {
    if (preview) return;
    const ids = nodes.filter(node => !node.id.startsWith('ghost-') && docRef.current.definition.nodes.some(item => item.id === node.id)).map(node => node.id), edgeIds = edges.map(edge => edge.id);
    setSelectedIds(previous => stableCanvasSelection(previous, ids));
    setSelectedEdgeIds(previous => stableCanvasSelection(previous, edgeIds));
  }, [preview]);
  const hiddenIds = useMemo(() => new Set(canvas.layout.groups.filter(group => group.collapsed).flatMap(group => group.nodeIds)), [canvas.layout.groups]);
  const nodes: ResearchFlowNode[] = useMemo(() => [
    ...canvas.layout.groups.filter(group => !group.collapsed).map(group => { const points = group.nodeIds.map(nodeId => canvas.layout.positions[nodeId] ?? { x: 160, y: 160 }); if (!points.length) points.push({ x: 160, y: 160 }); const x = Math.min(...points.map(point => point.x)) - 24, y = Math.min(...points.map(point => point.y)) - 50; const width = Math.max(...points.map(point => point.x)) - x + 284, height = Math.max(...points.map(point => point.y)) - y + 168; return { id: group.id, type: 'research' as const, position: { x, y }, data: { node: { id: group.id, kind: 'note', title: group.title, config: {} }, catalog: entry('note'), detail, groupFrame: true, groupCount: group.nodeIds.length, onGroupToggle: () => toggleGroup(group.id) }, width, height, draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -1, style: { width, height } }; }),
    ...canvas.definition.nodes.filter(node => !hiddenIds.has(node.id)).map(node => ({ id: node.id, type: 'research' as const, position: canvas.layout.positions[node.id] ?? { x: 160, y: 160 }, selected: selectedIds.includes(node.id), data: { node, catalog: entry(node.kind), run: runMap.get(node.id), detail, fresh: freshIds.includes(node.id), onOpen: openEditor }, width: 260, height: detail === 'title' || detail === 'overview' ? 86 : 144 })),
    ...canvas.layout.groups.filter(group => group.collapsed).map(group => ({ id: group.id, type: 'research' as const, position: canvas.layout.positions[group.nodeIds[0]] ?? { x: 160, y: 160 }, data: { node: { id: group.id, kind: 'note', title: group.title, config: {} }, catalog: entry('note'), detail, collapsed: true, groupCount: group.nodeIds.length }, width: 260, height: 110 })),
    ...ghosts,
  ], [canvas, hiddenIds, selectedIds, runMap, detail, freshIds, openEditor, ghosts, toggleGroup]);
  const edges: Edge[] = useMemo(() => canvas.definition.edges.filter(edge => !hiddenIds.has(edge.source) && !hiddenIds.has(edge.target)).map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, selected: selectedEdgeIds.includes(edge.id), type: 'smoothstep', animated: props.active !== false && runMap.get(edge.source)?.status === 'running', className: styles.flowEdge, style: { stroke: edge.kind === 'reference' ? 'var(--wb-muted)' : 'var(--wb-accent)', strokeWidth: edge.kind === 'data' ? 1.7 : 1.3, strokeDasharray: edge.kind === 'control' ? '7 5' : edge.kind === 'reference' ? '2 5' : undefined }, label: edge.kind === 'reference' ? '关联' : edge.kind === 'control' ? '先后' : undefined })), [canvas.definition.edges, hiddenIds, selectedEdgeIds, props.active, runMap]);

  const onNodesChange = useCallback((changes: NodeChange<ResearchFlowNode>[]) => {
    const next = cloneCanvas(docRef.current); let changed = false;
    changes.forEach(change => {
      if (change.type !== 'position' || !change.position || change.id.startsWith('ghost-')) return;
      const group = next.layout.groups.find(item => item.id === change.id);
      if (group) { const old = next.layout.positions[group.nodeIds[0]] ?? change.position; const delta = { x: change.position.x - old.x, y: change.position.y - old.y }; if (!delta.x && !delta.y) return; group.nodeIds.forEach(nodeId => { const point = next.layout.positions[nodeId]; if (point) next.layout.positions[nodeId] = { x: point.x + delta.x, y: point.y + delta.y }; }); }
      else { const previous = next.layout.positions[change.id]; if (previous?.x === change.position.x && previous?.y === change.position.y) return; next.layout.positions[change.id] = change.position; } changed = true;
    });
    if (changed) update(next);
  }, [update]);
  const groupSelection = useCallback(() => {
    if (selectedIds.length < 2) { setNotice('选择至少两个节点进行编组'); return; }
    const next = cloneCanvas(docRef.current), groupId = id();
    if (next.layout.groups.some(group => group.nodeIds.some(nodeId => selectedIds.includes(nodeId)))) { setNotice('所选节点已有编组，请先解组再重新组合'); return; }
    next.layout.groups.push({ id: groupId, title: '研究分组', nodeIds: selectedIds, collapsed: false }); commit(next); setNotice('已编组');
  }, [commit, selectedIds, setNotice]);
  const layoutPreview = useCallback(() => {
    const next = cloneCanvas(docRef.current), graph = new dagre.graphlib.Graph(); graph.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 110 }); graph.setDefaultEdgeLabel(() => ({}));
    next.definition.nodes.forEach(node => graph.setNode(node.id, { width: 260, height: 144 })); next.definition.edges.filter(edge => edge.kind !== 'reference').forEach(edge => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph); next.definition.nodes.forEach(node => { const p = graph.node(node.id); next.layout.positions[node.id] = { x: p.x - 130 + 100, y: p.y - 72 + 100 }; }); animateLayout(docRef.current.layout.positions, next.layout.positions); setPreview({ document: next, label: '自动排布预览', baseDefinition: JSON.stringify(docRef.current.definition), layoutOnly: true });
  }, [animateLayout]);
  const applyPreview = useCallback(() => {
    if (!preview) return;
    if (preview.baseDefinition && preview.baseDefinition !== JSON.stringify(docRef.current.definition)) { setNotice('当前流程已修改，提案保留供比较；请重新生成后应用。'); return; }
    stopLayoutMotion(); if (preview.sourceProposalId) bindProposal(preview.sourceProposalId); commit(preview.document); fresh(preview.document.definition.nodes.filter(node => !docRef.current.definition.nodes.some(old => old.id === node.id)).map(node => node.id)); setPreview(null); setNotice('方案已应用'); later(() => void flow.fitView({ duration: preference.motion === 'standard' ? 260 : 0, padding: .2 }), 50);
  }, [commit, preview, fresh, flow, later, preference.motion, setNotice, stopLayoutMotion, bindProposal]);
  const insertReference = useCallback(() => {
    const next = cloneCanvas(docRef.current), list = ['dataset', 'frequency', 'numeric', 'chart', 'claim', 'report']; const ids = list.map(() => id());
    list.forEach((kind, index) => { const catalog = entry(kind); next.definition.nodes.push({ id: ids[index], kind, title: catalog.title, config: defaults(catalog) }); next.layout.positions[ids[index]] = { x: 150 + (index % 3) * 350, y: 160 + Math.floor(index / 3) * 270 }; });
    const joins: [number, string, number, string][] = [[0, 'dataset', 1, 'dataset'], [0, 'dataset', 2, 'dataset'], [1, 'result', 3, 'result'], [1, 'result', 4, 'result'], [4, 'text', 5, 'text']];
    joins.forEach(([source, sourcePort, target, targetPort]) => { if (entry(list[source]).outputs.some(port => port.id === sourcePort) && entry(list[target]).inputs.some(port => port.id === targetPort)) next.definition.edges.push({ id: id(), source: ids[source], sourcePort, target: ids[target], targetPort, kind: 'data' }); });
    setPreview({ document: next, label: '可编辑参考流程' }); setPanel(null);
  }, []);
  const buildFromArtifacts = useCallback(() => {
    const next = cloneCanvas(docRef.current); const refs = props.artifactRefs ?? {};
    Object.entries({ questionnaire: 'questionnaire', dataset: 'dataset', report: 'report' }).forEach(([key, kind], index) => {
      const value = refs[key]; if (!value || typeof value !== 'object') return; const reference = value as { versionId?: string; id?: string }; const version = reference.versionId ?? reference.id; if (!version) return; const nodeId = id(), catalog = entry(kind), config = { ...defaults(catalog), [kind === 'dataset' ? 'datasetVersionId' : 'artifactVersionId']: version }; next.definition.nodes.push({ id: nodeId, kind, title: catalog.title, config }); next.layout.positions[nodeId] = { x: 180 + index * 330, y: 230 };
    });
    if (next.definition.nodes.length === docRef.current.definition.nodes.length) { setNotice('打开各编辑板块后，可将成果版本带入画布'); return; }
    setPreview({ document: next, label: '从已有成果建立引用' });
  }, [props.artifactRefs, setNotice]);
  const check = useCallback(async (mode?: 'all' | 'selected' | 'single') => {
    const baseDefinition = JSON.stringify(docRef.current.definition);
    try { const selected = mode && mode !== 'all' ? selectedIds : undefined; const result = await validate(selected); if (result.valid && mode) { const upstream = result.nodeIds.filter(nodeId => !selected?.includes(nodeId)); const reusable = run?.workflowVersionId === getVersionId() && upstream.every(nodeId => runMap.get(nodeId)?.status === 'succeeded'); setRunConsent(false); setRunPreview({ mode: mode === 'single' && upstream.length && !reusable ? 'selected' : mode, selected, nodeIds: result.nodeIds, baseDefinition }); } else if (!result.valid) setLogsOpen(true); } catch (error) { setNotice(error instanceof Error ? error.message : '检查未完成'); }
  }, [selectedIds, validate, setNotice, run, runMap, getVersionId]);
  const askProposal = async () => {
    if (props.writable === false) return;
    if (!proposalText.trim() || !serviceId || !proposalConsent) { setNotice('填写目标、选择模型服务并确认本次使用内容'); return; }
    setProposalBusy(true);
    const baseDefinition = JSON.stringify(docRef.current.definition), token = fileEpoch.current;
    const body = { prompt: proposalText, definition: docRef.current.definition, expectedRevision: getRevision(), serviceId, serviceRevision, consent: true }, signature = JSON.stringify(body); if (proposalIntent.current?.body !== signature) proposalIntent.current = { body: signature, key: id() };
    try { const response = await api<{ id: string; status: string; errorCode?: string; definition: CanvasDocument['definition']; layout?: CanvasDocument['layout']; baseRevision?: number }>('/workflow/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: proposalIntent.current.key }) }); if (token !== fileEpoch.current) return; if (response.status !== "ready") throw Error(response.status === "outcome_unknown" ? "提案调用结果待对账，未重新调用" : response.errorCode ?? "提案尚未就绪"); const definition = parseWorkflow(response.definition); const layout = response.layout ?? { positions: Object.fromEntries(definition.nodes.map((node, index) => [node.id, docRef.current.layout.positions[node.id] ?? { x: 160 + (index % 4) * 340, y: 160 + Math.floor(index / 4) * 220 }])), groups: [] }; setPreview({ document: { definition, layout: validateCanvasLayout(layout, definition.nodes.map(node => node.id)) }, label: 'AI 流程提案', baseDefinition, sourceProposalId: response.id }); } catch (error) { if (token === fileEpoch.current) setNotice(error instanceof Error ? error.message : '提案未完成'); } finally { if (token === fileEpoch.current) setProposalBusy(false); }
  };
  const onDrop = (event: DragEvent) => { event.preventDefault(); if (props.writable === false) return; const kind = event.dataTransfer.getData('application/evix-node'); if (entry(kind)) addNode(kind, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); };
  const readImport = async (file?: File) => {
    if (!file || props.writable === false) return; const token = ++fileEpoch.current;
    try { if (file.size > 600000) throw Error('流程文件超过 600 KB'); const text = await file.text(); rejectDuplicateMembers(text); const raw = JSON.parse(text) as CanvasDocument; if (token !== fileEpoch.current) return; const definition = parseWorkflow(raw.definition); const layout = validateCanvasLayout(raw.layout, definition.nodes.map(node => node.id)); setPreview({ document: { definition, layout }, label: '导入流程预览', baseDefinition: JSON.stringify(docRef.current.definition) }); } catch (error) { if (token === fileEpoch.current) setNotice(error instanceof Error ? error.message : '导入未完成'); }
  };
  const readDataset = async (file?: File) => { if (!file || props.writable === false) return; const token = ++fileEpoch.current; try { if (file.size > 2000000) throw Error('数据文件最多 2 MB'); const csv = await file.text(); if (token === fileEpoch.current) setPendingUpload({ name: file.name, csv, classification: 'actual', idempotencyKey: id(), targetNodeId: selected?.kind === 'dataset' ? selected.id : undefined }); } catch (error) { if (token === fileEpoch.current) setNotice(error instanceof Error ? error.message : '读取未完成'); } };
  const uploadDataset = async () => {
    if (!pendingUpload || props.writable === false) return; const token = fileEpoch.current; setUploadBusy(true);
    try { const dataset = await api<{ id: string; sourceName: string; rowCount: number; columns: string[]; classification: 'actual' | 'simulated' }>('/datasets/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: pendingUpload.idempotencyKey, sourceName: pendingUpload.name, classification: pendingUpload.classification, csv: pendingUpload.csv }) }); if (token !== fileEpoch.current) return; setUploadedDatasets(list => [dataset, ...list]); const target = docRef.current.definition.nodes.find(node => node.id === pendingUpload.targetNodeId && node.kind === 'dataset'); if (target) updateNode({ ...target, config: { ...target.config, datasetVersionId: dataset.id } }); setPendingUpload(null); setNotice(`${dataset.sourceName} 已上传 · ${dataset.rowCount} 行`); } catch (error) { if (token === fileEpoch.current) setNotice(error instanceof Error ? error.message : '上传未完成'); } finally { if (token === fileEpoch.current) setUploadBusy(false); }
  };
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { stopLayoutMotion(); setPanel(null); setPreview(null); setRunPreview(null); setMoreOpen(false); setLogsOpen(false); setFocusMode(false); fileEpoch.current++; setPendingUpload(null); setUploadBusy(false); return; }
    if (event.key === 'Tab') { const dialog = scope.current?.querySelector<HTMLElement>('[role="dialog"]'); if (dialog) { const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')]; const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); } } }
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    if (/^Arrow/.test(event.key) && (event.target as HTMLElement).closest('.react-flow__node')) { history.current.push(cloneCanvas(docRef.current)); future.current = []; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
    if (event.key === 'Enter' && selected) setPanel('inspector');
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); void flow.fitView({ nodes: event.shiftKey ? undefined : selectedIds.map(id => ({ id })), duration: preference.motion === 'standard' ? 260 : 0, padding: .3 }); }
  };

  const shownCanvas = preview?.document ?? canvas;
  const displayNodes = preview ? nodes.filter(node => node.id.startsWith('ghost-')).concat(shownCanvas.definition.nodes.map(node => ({ id: node.id, type: 'research', position: animatedPositions?.[node.id] ?? shownCanvas.layout.positions[node.id] ?? { x: 160, y: 160 }, data: { node, catalog: entry(node.kind), detail }, draggable: props.writable !== false && Boolean(preview.layoutOnly), connectable: false }))) : nodes;
  const displayEdges = preview ? shownCanvas.definition.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'smoothstep', style: { stroke: 'var(--wb-accent)', strokeWidth: 1.7 } })) : edges;
  const activeNode = selected ? runMap.get(selected.id) : undefined;
  const categories = [...new Set(CATALOG.map(item => item.category))];
  const filtered = CATALOG.filter(item => (category === '全部' || item.category === category) && `${item.title} ${item.description}`.includes(query));
  const completedCount = run?.nodes.filter(node => ['completed', 'succeeded', 'ready'].includes(node.status)).length ?? 0;
  const paidNodes = (runPreview?.mode === 'single' ? runPreview.selected ?? [] : runPreview?.nodeIds ?? []).map(nodeId => canvas.definition.nodes.find(node => node.id === nodeId)).filter((node): node is CanvasNode => Boolean(node && ['model', 'provider'].includes(entry(node.kind)?.executor)));
  const hasRunPreview = Boolean(runPreview), hasPendingUpload = Boolean(pendingUpload);
  useEffect(() => {
    const dialog = scope.current?.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = window.document.activeElement;
    dialog.querySelector<HTMLElement>('button,input,select')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [hasRunPreview, hasPendingUpload]);
  const runIssues = issues.length || Boolean(run?.nodes.some(node => node.errorCode));
  const serviceField = selected ? <div className={styles.serviceFields}><label className={styles.field}>个人模型服务{services.length ? <select value={serviceBindings[selected.id]?.serviceId ?? ''} onChange={event => { const item = services.find(service => service.id === event.target.value); setServiceBindings(bindings => ({ ...bindings, [selected.id]: { serviceId: event.target.value, serviceRevision: item?.revision ?? 1 } })); }}><option value="">选择我的服务</option>{services.map(service => <option key={service.id} value={service.id}>{service.title ?? service.name ?? service.id}</option>)}</select> : <input value={serviceBindings[selected.id]?.serviceId ?? ''} placeholder="服务 ID" onChange={event => setServiceBindings(bindings => ({ ...bindings, [selected.id]: { serviceId: event.target.value, serviceRevision: 1 } }))} />}</label><button type="button" onClick={() => props.onOpenEditor('services')}>配置模型服务 ↗</button></div> : null;

  return <div ref={scope} className={styles.canvas} data-motion={preference.motion} data-active={props.active !== false} style={{ '--canvas-glass-opacity': preference.transparency / 100 } as CSSProperties} tabIndex={-1} onKeyDownCapture={keyboard} onDrop={onDrop} onDragOver={event => { if (event.dataTransfer.types.includes('application/evix-node')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}>
    <input type="file" ref={importFile} hidden accept="application/json,.json" aria-label="导入研究流程文件" onChange={event => { void readImport(event.target.files?.[0]); event.target.value = ''; }} />
    <input type="file" ref={uploadFile} hidden accept="text/csv,.csv" aria-label="上传项目数据文件" onChange={event => { void readDataset(event.target.files?.[0]); event.target.value = ''; }} />
    {pendingUpload && <div className={styles.modalShade}><section className={`${styles.panel} ${styles.runPreview}`} role="dialog" aria-modal="true" aria-labelledby="canvas-upload-title"><header className={styles.panelHeader}><h2 id="canvas-upload-title">上传并用于后台运行</h2><button type="button" onClick={() => { fileEpoch.current++; setPendingUpload(null); setUploadBusy(false); }}>×</button></header><div className={styles.inspectorBody}><strong>{pendingUpload.name}</strong><label className={styles.field}>数据类型<select disabled={uploadBusy} value={pendingUpload.classification} onChange={event => setPendingUpload({ ...pendingUpload, idempotencyKey: id(), classification: event.target.value as 'actual' | 'simulated' })}><option value="actual">实际调查数据</option><option value="simulated">合成数据</option></select></label><p className={styles.help}>上传后建立私有数据版本，后台计算与成果将引用这一版本。</p></div><footer><button type="button" onClick={() => setPendingUpload(null)}>取消</button><button type="button" className={styles.primary} disabled={uploadBusy} onClick={() => void uploadDataset()}>{uploadBusy ? '上传中…' : '确认上传'}</button></footer></section></div>}
    <ReactFlow<ResearchFlowNode> nodesDraggable={props.writable !== false && (!preview || preview.layoutOnly)} nodesConnectable={props.writable !== false && !preview} nodes={displayNodes} edges={displayEdges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onConnect={connect} isValidConnection={connection => !connectionProblem(connection as Connection)} onSelectionChange={onSelectionChange} onNodeClick={(_, node) => { if (canvas.layout.groups.some(group => group.id === node.id)) toggleGroup(node.id); else { setSelectedIds([node.id]); setPanel('inspector'); } }} onNodeDoubleClick={(_, node) => { const catalog = entry(node.data.node.kind); if (catalog.editorSection) openEditor(catalog.editorSection, node.id); }} onPaneClick={() => { setPanel(null); setMoreOpen(false); }} onNodeDragStart={() => { dragStart.current = cloneCanvas(docRef.current); if (preview?.layoutOnly) { const visual = cloneCanvas(docRef.current); visual.layout.positions = coordinates.current ?? preview.document.layout.positions; docRef.current = visual; update(visual); } stopLayoutMotion(); setPreview(null); motion.current?.cancel(); }} onNodeDragStop={(event, node) => { if (dragStart.current) { history.current.push(dragStart.current); future.current = []; dragStart.current = null; } const next = cloneCanvas(docRef.current); [...new Set([...selectedIds, node.id])].forEach(nodeId => { const position = next.layout.positions[nodeId]; if (position) next.layout.positions[nodeId] = snapCanvasPosition(position, 'altKey' in event && event.altKey); }); update(next); }} onMove={(_, viewport) => setZoom(viewport.zoom)} onMoveEnd={(event, viewport) => { if (event) viewTouched.current = true; storeView(viewport); }} minZoom={.15} maxZoom={2} selectionOnDrag selectionMode={SelectionMode.Partial} panOnDrag={[1, 2]} panOnScroll zoomOnScroll={false} zoomActivationKeyCode="Control" panActivationKeyCode="Space" multiSelectionKeyCode="Shift" deleteKeyCode={null} fitView={false} onlyRenderVisibleElements proOptions={{ hideAttribution: true }} ariaLabelConfig={{ 'node.a11yDescription.default': '按 Enter 查看设置，使用箭头键移动，按 Delete 删除。', 'edge.a11yDescription.default': '按 Delete 删除连接。' }}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--wb-line-strong)" />
      {mapOpen && <MiniMap pannable zoomable nodeColor="var(--wb-accent)" maskColor="var(--wb-well)" position="bottom-left" className={styles.miniMap} />}
    </ReactFlow>
    {!focusMode && <>
      <div className={`${styles.glass} ${styles.topLeft}`}><span className={styles.projectMark}>证见</span><strong title={props.projectTitle}>{props.projectTitle}</strong><div className={styles.modeSwitch}><span className={styles.modeMarker} /><button type="button" onClick={props.onExitCanvas}>工作台</button><button type="button" aria-pressed="true">画布</button></div><span className={styles.saveState} role="status">{loading ? '读取中' : saveState}</span></div>
      <div className={`${styles.glass} ${styles.topRight}`}><button type="button" onClick={() => void check()} disabled={loading || busy}>检查</button><button type="button" className={styles.primary} onClick={() => void check('all')} disabled={loading || busy || props.writable === false || !canvas.definition.nodes.length}>{busy ? '创建中…' : '▶ 运行'}</button><button type="button" aria-label="更多画布操作" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>•••</button>{moreOpen && <div className={styles.moreMenu}><button type="button" onClick={() => { setPanel('history'); setMoreOpen(false); }}>运行历史</button><button type="button" onClick={() => { layoutPreview(); setMoreOpen(false); }}>自动排布</button><button type="button" onClick={() => { setPanel('settings'); setMoreOpen(false); }}>画布设置</button><button type="button" onClick={() => exportJson(canvas, '证见研究流程.json')}>导出流程</button><button type="button" disabled={props.writable === false} onClick={() => { importFile.current?.click(); setMoreOpen(false); }}>导入流程</button><button type="button" disabled={props.writable === false || !props.projectId} onClick={() => { uploadFile.current?.click(); setMoreOpen(false); }}>上传数据版本</button><button type="button" onClick={() => { setFocusMode(true); setMoreOpen(false); }}>专注画布</button><button type="button" disabled={props.writable === false} onClick={() => void save().catch(() => {})}>立即保存</button></div>}</div>
      <button type="button" className={`${styles.glass} ${styles.addButton}`} aria-label="添加节点" disabled={props.writable === false} aria-expanded={panel === 'library'} onClick={() => { setPanel(panel === 'library' ? null : 'library'); setQuery(''); }}>＋</button>
      <div className={`${styles.glass} ${styles.bottomTools}`}><button type="button" onClick={() => void flow.zoomOut({ duration: preference.motion === 'standard' ? 180 : 0 })} aria-label="缩小">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => void flow.zoomIn({ duration: preference.motion === 'standard' ? 180 : 0 })} aria-label="放大">＋</button><i /><button type="button" onClick={() => void flow.fitView({ duration: preference.motion === 'standard' ? 260 : 0, padding: .2 })}>适应全图</button><button type="button" aria-pressed={mapOpen} onClick={() => setMapOpen(!mapOpen)}>小地图</button><i /><button type="button" onClick={undo} aria-label="撤销">↶</button><button type="button" onClick={redo} aria-label="重做">↷</button>{selectedIds.length > 1 && <><button type="button" onClick={groupSelection}>编组</button><button type="button" onClick={duplicate}>复制 {selectedIds.length} 项</button><button type="button" onClick={() => void check('selected')}>运行所选</button></>}</div>
    </>}
    {focusMode && <button type="button" className={`${styles.glass} ${styles.focusExit}`} onClick={() => setFocusMode(false)}>退出专注 · Esc</button>}
    {!loading && !canvas.definition.nodes.length && !preview && <div className={styles.empty}><span className={styles.emptyGlyph}>Q → D → I → A</span><h1>从一个问题，连接你的研究。</h1><div><button type="button" onClick={() => setPanel('library')}>＋ 添加节点</button><button type="button" onClick={insertReference}>参考流程</button><button type="button" onClick={() => setPanel('proposal')}>✧ AI 提出方案</button></div>{props.artifactRefs && <button type="button" className={styles.emptyImport} onClick={buildFromArtifacts}>从已有成果建立引用 ↗</button>}</div>}
    {canvas.layout.groups.filter(group => !group.collapsed).length > 0 && !focusMode && <div className={styles.groupsBar}>{canvas.layout.groups.filter(group => !group.collapsed).map(group => <button key={group.id} type="button" className={styles.glass} onClick={() => toggleGroup(group.id)}>▦ {group.title} · {group.nodeIds.length} <span>收起</span></button>)}</div>}
    {!focusMode && panel === 'library' && <aside className={`${styles.panel} ${styles.library}`} aria-label="节点库"><header className={styles.panelHeader}><div><small>研究组件</small><h2>添加节点</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="关闭节点库">×</button></header><input className={styles.search} aria-label="搜索节点" placeholder="搜索方法与节点…" autoFocus value={query} onChange={event => setQuery(event.target.value)} /><div className={styles.categoryTabs}>{['全部', ...categories].map(item => <button type="button" key={item} className={category === item ? styles.categoryActive : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className={styles.libraryList}>{filtered.map(item => <button type="button" key={item.kind} className={styles.libraryItem} draggable onDragStart={event => { event.dataTransfer.setData('application/evix-node', item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addNode(item.kind)}><span>{item.category}</span><strong>{item.title}</strong><small>{item.description}</small><i>＋</i></button>)}</div><footer><button type="button" onClick={insertReference}>插入参考流程</button></footer></aside>}
    {!focusMode && panel === 'inspector' && selected && selectedCatalog && <CanvasInspector key={selected.id} node={selected} catalog={selectedCatalog} run={activeNode} onChange={updateNode} onClose={() => setPanel(null)} onOpen={() => openEditor(selectedCatalog.editorSection ?? 'analysis', selected.id)} onRun={() => void check('single')} onDuplicate={duplicate} onDelete={remove} onConnect={() => { setConnectKind('data'); setConnectSource(selectedCatalog.outputs[0]?.id ?? ''); setConnectTarget(''); setPanel('connect'); }} onDecision={(action, values) => void decide(selected.id, action, values)} datasets={datasets} columns={connectedDatasetColumns(canvas.definition, selected.id, datasets, run?.nodes)} serviceFields={serviceField} writable={props.writable} />}
    {!focusMode && panel === 'settings' && <aside className={`${styles.panel} ${styles.inspector}`} aria-label="画布设置"><header className={styles.panelHeader}><h2>画布设置</h2><button type="button" onClick={() => setPanel(null)} aria-label="关闭设置">×</button></header><div className={styles.inspectorBody}><label className={styles.field}>动态效果<select value={preference.motion} onChange={event => setPreference({ ...preference, motion: event.target.value as CanvasMotionPreference })}><option value="standard">标准</option><option value="reduced">减少动态</option><option value="off">关闭动效</option></select></label><label className={styles.field}>浮动工具透明度 · {preference.transparency}%<input type="range" min="65" max="100" value={preference.transparency} onChange={event => setPreference({ ...preference, transparency: Number(event.target.value) })} /></label><p className={styles.help}>空格 + 拖动平移 · Ctrl + 滚轮缩放<br />Shift 多选 · Ctrl D 复制 · Ctrl Z 撤销<br />F 定位 · Shift F 全图 · Enter 设置</p></div></aside>}
    {!focusMode && panel === 'connect' && selected && <CanvasConnectionPanel node={selected} document={canvas} catalog={CATALOG} kind={connectKind} setKind={setConnectKind} source={connectSource} setSource={setConnectSource} target={connectTarget} setTarget={setConnectTarget} onClose={() => setPanel('inspector')} onCreate={edge => { if (edge.kind === 'data') connect({ source: edge.source, sourceHandle: edge.sourcePort, target: edge.target, targetHandle: edge.targetPort }); else { const next = cloneCanvas(docRef.current); next.definition.edges.push({ ...edge, id: id() }); commit(next); } setPanel('inspector'); }} onDisconnect={edgeId => { const next = cloneCanvas(docRef.current); next.definition.edges = next.definition.edges.filter(item => item.id !== edgeId); commit(next); }} />}
    {!focusMode && panel === 'proposal' && <aside className={`${styles.panel} ${styles.inspector}`} aria-label="AI 流程提案"><header className={styles.panelHeader}><h2>AI 提出方案</h2><button type="button" onClick={() => setPanel(null)}>×</button></header><div className={styles.inspectorBody}><label className={styles.field}>研究目标<textarea rows={6} value={proposalText} onChange={event => setProposalText(event.target.value)} placeholder="描述研究对象、已有材料和希望回答的问题…" /></label><label className={styles.field}>我的模型服务{services.length ? <select value={serviceId} onChange={event => { const service = services.find(item => item.id === event.target.value); setServiceId(event.target.value); setServiceRevision(service?.revision ?? 1); }}><option value="">选择服务</option>{services.map(service => <option key={service.id} value={service.id}>{service.title ?? service.name ?? service.id}</option>)}</select> : <input value={serviceId} onChange={event => setServiceId(event.target.value)} placeholder="服务 ID" />}</label><button type="button" onClick={() => props.onOpenEditor('services')}>配置模型服务 ↗</button><label className={styles.consent}><input type="checkbox" checked={proposalConsent} onChange={event => setProposalConsent(event.target.checked)} /><span>将研究目标与流程配置交给所选模型生成提案</span></label><button type="button" className={styles.primary} disabled={proposalBusy || props.writable === false || !proposalConsent} onClick={() => void askProposal()}>{proposalBusy ? '正在生成提案…' : '生成流程提案'}</button></div></aside>}
    {!focusMode && panel === 'history' && <aside className={`${styles.panel} ${styles.inspector}`} aria-label="运行历史"><header className={styles.panelHeader}><h2>运行历史</h2><button type="button" onClick={() => setPanel(null)}>×</button></header><div className={styles.inspectorBody}>{runs.length ? runs.map(item => <button type="button" className={styles.historyItem} key={item.id} onClick={() => { setRun(item); setLogsOpen(true); setPanel(null); }}><strong>{RUN_LABELS[item.status] ?? item.status}</strong><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><small>{item.id.slice(0, 8)} · {item.nodes?.length ?? 0} 个节点</small></button>) : <p>暂无运行记录</p>}</div></aside>}
    {preview && <div className={`${styles.glass} ${styles.previewBar}`} role="status"><strong>{preview.label}</strong><span>{preview.document.definition.nodes.length} 个节点 · {preview.document.definition.edges.length} 条连接</span><button type="button" onClick={() => { stopLayoutMotion(); setPreview(null); }}>取消</button><button type="button" className={styles.primary} disabled={props.writable === false} onClick={applyPreview}>确认应用</button></div>}
    {runPreview && <div className={styles.modalShade}><section className={`${styles.panel} ${styles.runPreview}`} role="dialog" aria-modal="true" aria-labelledby="canvas-run-title"><header className={styles.panelHeader}><h2 id="canvas-run-title">确认运行范围</h2><button type="button" onClick={() => setRunPreview(null)} aria-label="关闭运行确认">×</button></header><p>{runPreview.mode === 'single' ? `运行所选节点，引用 ${runPreview.nodeIds.length - (runPreview.selected?.length ?? 0)} 个已完成上游结果` : `运行所选范围及必要前置，共 ${runPreview.nodeIds.length} 个节点`}</p><ol>{runPreview.nodeIds.map(nodeId => { const node = canvas.definition.nodes.find(item => item.id === nodeId); return <li key={nodeId}>{node?.title ?? nodeId}<small>{node ? entry(node.kind)?.executor : ''}</small></li>; })}</ol>{paidNodes.length > 0 && <div className={styles.runConsent}>{paidNodes.map(node => <p key={node.id}><strong>{node.title}</strong><span>{services.find(service => service.id === serviceBindings[node.id]?.serviceId)?.name ?? serviceBindings[node.id]?.serviceId ?? "尚未选择模型服务"}</span><small>{String(node.config.purpose ?? node.config.prompt ?? entry(node.kind).description).slice(0, 120)}</small></p>)}<label className={styles.consent}><input type="checkbox" checked={runConsent} onChange={event => setRunConsent(event.target.checked)} /><span>允许本次运行使用所选服务处理研究材料与汇总结果</span></label></div>}<footer><button type="button" onClick={() => setRunPreview(null)}>取消</button><button type="button" className={styles.primary} disabled={props.writable === false || (paidNodes.length > 0 && !runConsent)} onClick={() => { if (runPreview.baseDefinition !== JSON.stringify(docRef.current.definition)) { setNotice("流程已修改，请重新检查运行范围"); setRunPreview(null); return; } void execute(runPreview.mode, runPreview.selected, serviceBindings); setRunPreview(null); setLogsOpen(true); }}>开始运行</button></footer></section></div>}
    {!focusMode && (run || runIssues) && <div className={`${styles.glass} ${styles.runStrip}`}><button type="button" onClick={() => setLogsOpen(!logsOpen)} aria-expanded={logsOpen}><span className={styles.statusDot} data-status={run?.status ?? 'failed'} />{run ? RUN_LABELS[run.status] ?? run.status : '待处理项'}<small>{run ? `${completedCount} / ${run.nodes.length} 已完成` : `${issues.length} 个检查项`}</small></button>{Boolean(run?.unknownCount) && <span className={styles.unknown}>{run!.unknownCount} 项待对账</span>}{run && !isRunTerminal(run.status) && <button type="button" onClick={() => void cancel()}>停止</button>}</div>}
    {!focusMode && logsOpen && <section className={`${styles.panel} ${styles.logs}`} aria-label="运行记录"><header className={styles.panelHeader}><h2>执行记录</h2><button type="button" onClick={() => setLogsOpen(false)} aria-label="关闭运行记录">×</button></header><div className={styles.logsBody}>{issues.map((issue, index) => <button type="button" key={`${issue.code}-${index}`} onClick={() => { if (issue.nodeId) { setSelectedIds([issue.nodeId]); setPanel('inspector'); void flow.fitView({ nodes: [{ id: issue.nodeId }], duration: 260, padding: .7 }); } }}><span className={styles.danger}>待处理</span>{issue.message}</button>)}{run?.events?.map(event => <div className={styles.eventRow} key={event.sequence}><time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time><span>{event.nodeId ? canvas.definition.nodes.find(node => node.id === event.nodeId)?.title ?? event.nodeId : '流程'}</span><strong>{RUN_LABELS[event.type] ?? event.type}</strong></div>)}{run?.nodes.map(node => <button type="button" key={node.nodeId} onClick={() => { setSelectedIds([node.nodeId]); setPanel('inspector'); }}><span className={styles.statusDot} data-status={node.status} /><strong>{canvas.definition.nodes.find(item => item.id === node.nodeId)?.title ?? node.nodeId}</strong><span>{RUN_LABELS[node.status] ?? node.status}</span>{node.errorCode && <small>{node.errorCode}</small>}</button>)}{!issues.length && !run && <p>检查流程或开始运行后，记录会显示在这里。</p>}</div></section>}
    {notice && <div className={`${styles.glass} ${styles.notice}`} role="status"><span>{notice}</span><button type="button" aria-label="关闭消息" onClick={() => { setNotice(''); setIssues([]); }}>×</button></div>}
    {conflict && <div className={`${styles.glass} ${styles.conflict}`} role="alert"><strong>云端版本已变化，当前草稿已保留。</strong><button type="button" onClick={() => exportJson(canvas, '证见冲突草稿.json')}>下载当前草稿</button><button type="button" onClick={() => window.location.reload()}>载入云端版本</button></div>}
  </div>;
}

export default function ResearchCanvas(props: CanvasProjectProps) { return <ReactFlowProvider><CanvasContent {...props} /></ReactFlowProvider>; }
export type { CanvasProjectProps as ResearchCanvasProps } from './useCanvasProject';
