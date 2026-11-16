'use client';
import type { CanvasDocument, CanvasEdge, CanvasNode, CatalogEntry } from './canvas-types';
import styles from './ResearchCanvas.module.css';

export default function CanvasConnectionPanel({ node, document, catalog, kind, setKind, source, setSource, target, setTarget, onCreate, onDisconnect, onClose }: {
  node: CanvasNode; document: CanvasDocument; catalog: CatalogEntry[]; kind: CanvasEdge['kind']; setKind: (kind: CanvasEdge['kind']) => void; source: string; setSource: (id: string) => void; target: string; setTarget: (id: string) => void; onCreate: (edge: Omit<CanvasEdge, 'id'>) => void; onDisconnect: (id: string) => void; onClose: () => void;
}) {
  const spec = catalog.find(entry => entry.kind === node.kind)!;
  const type = spec.outputs.find(port => port.id === source)?.type;
  const targets = document.definition.nodes.filter(item => item.id !== node.id).flatMap(item => kind === 'data' ? (catalog.find(entry => entry.kind === item.kind)?.inputs ?? []).filter(port => port.type === type || Boolean(type && port.accepts?.includes(type))).map(port => ({ nodeId: item.id, portId: port.id, label: `${item.title} → ${port.id}` })) : [{ nodeId: item.id, portId: '', label: item.title }]);
  return <aside className={`${styles.panel} ${styles.inspector}`} aria-label="连接节点">
    <header className={styles.panelHeader}><h2>连接到…</h2><button type="button" onClick={onClose} aria-label="关闭连接设置">×</button></header>
    <div className={styles.inspectorBody}>
      <label className={styles.field}>连线含义<select value={kind} onChange={event => { setKind(event.target.value as CanvasEdge['kind']); setTarget(''); }}><option value="data">数据输入输出 · 实线</option><option value="control">执行先后 · 虚线</option><option value="reference">研究关联 · 点线</option></select></label>
      {kind === 'data' && <label className={styles.field}>输出端口<select value={source} onChange={event => { setSource(event.target.value); setTarget(''); }}>{spec.outputs.map(port => <option key={port.id} value={port.id}>{port.id} · {port.type}</option>)}</select></label>}
      <label className={styles.field}>目标{kind === 'data' ? '输入' : '节点'}<select value={target} onChange={event => setTarget(event.target.value)}><option value="">选择目标节点</option>{targets.map(option => <option value={`${option.nodeId}|${option.portId}`} key={`${option.nodeId}|${option.portId}`}>{option.label}</option>)}</select></label>
      <button type="button" className={styles.primary} disabled={!target} onClick={() => { const [targetId, targetPort] = target.split('|'); onCreate({ source: node.id, sourcePort: kind === 'data' ? source : '', target: targetId, targetPort, kind }); }}>建立连接</button>
      <h3>已有连接</h3>{document.definition.edges.filter(edge => edge.source === node.id || edge.target === node.id).map(edge => <div className={styles.connectionItem} key={edge.id}><span>{document.definition.nodes.find(item => item.id === edge.source)?.title} → {document.definition.nodes.find(item => item.id === edge.target)?.title}</span><button type="button" aria-label="断开此连接" onClick={() => onDisconnect(edge.id)}>断开</button></div>)}
    </div>
  </aside>;
}
