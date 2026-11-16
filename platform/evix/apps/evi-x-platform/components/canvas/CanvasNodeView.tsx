'use client';
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { RUN_LABELS, type CanvasNode, type CatalogEntry, type CanvasNodeRun } from './canvas-types';
import type { canvasDetailLevel } from '@/lib/canvas-motion';
import styles from './ResearchCanvas.module.css';
import { CanvasChartPreview } from './CanvasResult';

export type ResearchNodeData = { node: CanvasNode; catalog: CatalogEntry; run?: CanvasNodeRun; detail: ReturnType<typeof canvasDetailLevel>; fresh?: boolean; exiting?: boolean; collapsed?: boolean; groupFrame?: boolean; groupCount?: number; onGroupToggle?: () => void; onOpen?: (section: string, id: string) => void };
export type ResearchFlowNode = Node<ResearchNodeData, 'research'>;
const symbols: Record<string, string> = { 研究设计: 'Q', 问卷: '▤', 样本: '◉', 调查: '↗', 数据: 'D', 统计: '∑', 图表: '▥', 模型: '✧', 流程: '⋈', 成果: 'A' };
const summary = (value: Record<string, unknown> | undefined): string => {
  if (!value) return '';
  if (typeof value.summary === 'string') return value.summary.slice(0, 140);
  const metrics = value.summary && typeof value.summary === 'object' ? value.summary as Record<string, unknown> : value;
  return Object.entries(metrics).filter(([key, v]) => typeof v === 'number' || ['n', 'rowCount', 'classification', 'title'].includes(key)).slice(0, 3).map(([key, v]) => `${key}: ${String(v)}`).join(' · ');
};
function CanvasNodeView({ data, selected, dragging }: NodeProps<ResearchFlowNode>) {
  const { node, catalog, run, detail, fresh, exiting, collapsed, groupCount } = data;
  if (data.groupFrame) return <div className={styles.groupFrame}><div className={styles.groupHeader}><span>▦ {node.title} · {groupCount} 项</span><button type="button" className="nodrag nopan" onClick={event => { event.stopPropagation(); data.onGroupToggle?.(); }}>收起</button></div></div>;
  const compact = detail === 'title' || detail === 'overview';
  return <article className={`${styles.nodeShell} ${selected ? styles.nodeSelected : ''} ${dragging ? styles.nodeDragging : ''} ${fresh ? styles.nodeFresh : ''} ${exiting ? styles.nodeExiting : ''} ${node.disabled ? styles.nodeDisabled : ''}`} data-canvas-node={node.id} data-status={run?.status ?? 'draft'} data-detail={detail} aria-label={`${node.title}${run ? `，${RUN_LABELS[run.status] ?? run.status}` : ''}`}>
    <div className={styles.nodeTop}><span className={styles.nodeIcon} aria-hidden="true">{collapsed ? '▦' : symbols[catalog.category] ?? '◇'}</span><span className={styles.nodeCategory}>{collapsed ? `编组 · ${groupCount ?? 0} 项` : catalog.category}</span><span className={styles.statusDot} data-status={run?.status ?? 'draft'} aria-hidden="true" /></div>
    <h3 className={styles.nodeTitle}>{node.title}</h3>
    {!compact && <><p className={styles.nodeDescription}>{summary(run?.result) || (typeof node.config.question === 'string' ? node.config.question : catalog.description)}</p>{typeof run?.result?.svg === 'string' && <div className={styles.nodeChart}><CanvasChartPreview svg={run.result.svg} title={node.title} /></div>}<div className={styles.nodeBottom}><span className={styles.nodeStatus}>{node.disabled ? '已停用' : run ? RUN_LABELS[run.status] ?? run.status : '待配置'}</span>{catalog.editorSection && <button type="button" className={`nodrag nopan ${styles.nodeOpen}`} aria-label={`打开${node.title}编辑器`} onClick={() => data.onOpen?.(catalog.editorSection!, node.id)}>打开 ↗</button>}</div></>}
    {catalog.inputs.map((port, index) => <Handle key={`in-${port.id}`} id={port.id} type="target" position={Position.Left} style={{ top: `${(index + 1) * 100 / (catalog.inputs.length + 1)}%` }} title={`${port.id} · ${port.type}`} className={styles.handle} aria-label={`输入 ${port.id}，${port.type}`} />)}
    {catalog.outputs.map((port, index) => <Handle key={`out-${port.id}`} id={port.id} type="source" position={Position.Right} style={{ top: `${(index + 1) * 100 / (catalog.outputs.length + 1)}%` }} title={`${port.id} · ${port.type}`} className={styles.handle} aria-label={`输出 ${port.id}，${port.type}`} />)}
  </article>;
}
export default memo(CanvasNodeView);
