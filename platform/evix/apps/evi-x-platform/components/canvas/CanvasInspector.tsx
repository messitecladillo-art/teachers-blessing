'use client';
import { useState } from 'react';
import type { ChartChoice } from '@/lib/chart-types';
import { RUN_LABELS, type CanvasNode, type CanvasNodeRun, type CatalogEntry } from './canvas-types';
import styles from './ResearchCanvas.module.css';
import CanvasResult from './CanvasResult';
import CanvasChartFormat from './CanvasChartFormat';

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [draft, setDraft] = useState({ base: serialized, text: serialized }), [error, setError] = useState('');
  if (draft.base !== serialized) setDraft({ base: serialized, text: serialized });
  return <label className={styles.field}>{label}<textarea className={styles.codeInput} value={draft.text} rows={5} onChange={event => setDraft({ base: serialized, text: event.target.value })} onBlur={() => { try { const next = JSON.parse(draft.text); setError(''); onChange(next); } catch { setError('请输入有效 JSON'); } }} />{error && <small role="alert">{error}</small>}</label>;
}
export default function CanvasInspector({ node, catalog, run, onChange, onClose, onOpen, onRun, onDuplicate, onDelete, onConnect, onDecision, datasets, columns = [], serviceFields, writable = true }: {
  node: CanvasNode; catalog: CatalogEntry; run?: CanvasNodeRun; onChange: (next: CanvasNode) => void; onClose: () => void; onOpen: () => void; onRun: () => void; onDuplicate: () => void; onDelete: () => void; onConnect: () => void; onDecision: (action: string, values?: Record<string, unknown>) => void;
  datasets?: { id: string; sourceName: string; columns?: string[]; rowCount?: number; classification?: 'actual' | 'simulated' }[]; columns?: string[]; serviceFields?: React.ReactNode; writable?: boolean;
}) {
  const config = (key: string, value: unknown) => { const next = { ...node.config }; if (value === undefined) delete next[key]; else next[key] = value; onChange({ ...node, config: next }); };
  const waiting = run && /wait|review|approval/.test(run.status);
  return <aside className={`${styles.panel} ${styles.inspector}`} aria-label="节点设置">
    <header className={styles.panelHeader}><div><small>{catalog.category}</small><h2>{node.title}</h2></div><button type="button" onClick={onClose} aria-label="关闭节点设置">×</button></header>
    <fieldset className={styles.inspectorBody} disabled={!writable}>
      <label className={styles.field}>节点名称<input value={node.title} maxLength={120} onChange={event => onChange({ ...node, title: event.target.value })} /></label>
      <p className={styles.help}>{catalog.description}</p>
      {catalog.kind === 'dataset' && datasets?.length ? <label className={styles.field}>项目数据版本<select value={String(node.config.datasetVersionId ?? '')} onChange={event => config('datasetVersionId', event.target.value)}><option value="">选择数据版本</option>{datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.sourceName}{dataset.rowCount !== undefined ? ` · ${dataset.rowCount} 行` : ''}{dataset.classification ? dataset.classification === 'simulated' ? ' · 合成' : ' · 实际' : ''}</option>)}</select></label> : null}
      {catalog.configFields.map(field => {
        const value = node.config[field.key] ?? field.default;
        if (field.key === 'datasetVersionId' && datasets?.length) return null;
        if (catalog.kind === 'chart' && ['theme', 'chartKind', 'style'].includes(field.key)) return null;
        if (catalog.category === '统计' && (field.key === 'scale' && catalog.kind !== 'alpha' || ['x','y'].includes(field.key) && catalog.kind === 'alpha' || field.key === 'y' && ['frequency','numeric'].includes(catalog.kind))) return null;
        if (['x', 'y'].includes(field.key) && columns.length) return <label className={styles.field} key={field.key}>{field.key === 'x' ? '变量 X' : '变量 Y'}<select value={typeof value === 'number' ? value : ''} onChange={event => config(field.key, event.target.value === '' ? undefined : Number(event.target.value))}><option value="">选择变量</option>{columns.map((column,index) => <option value={index} key={index}>{column}</option>)}</select></label>;
        if (field.key === 'scale' && catalog.kind === 'alpha' && columns.length) {
          const scale = value && typeof value === 'object' ? value as Record<string, unknown> : { columns: [], reverse: [], min: 1, max: 5, construct: '' }, selected = Array.isArray(scale.columns) ? scale.columns as number[] : [], reverse = Array.isArray(scale.reverse) ? scale.reverse as number[] : [];
          const setScale = (key: string, next: unknown) => config('scale', { columns: selected, reverse, min: scale.min ?? 1, max: scale.max ?? 5, construct: scale.construct ?? '', [key]: next });
          return <details open className={styles.scaleFields} key={field.key}><summary>量表与计分</summary><label className={styles.field}>共同构念<input value={String(scale.construct ?? '')} maxLength={120} onChange={event => setScale('construct', event.target.value)} /></label><div className={styles.fieldPair}><label className={styles.field}>最低分<input type="number" value={Number(scale.min ?? 1)} onChange={event => setScale('min', Number(event.target.value))} /></label><label className={styles.field}>最高分<input type="number" value={Number(scale.max ?? 5)} onChange={event => setScale('max', Number(event.target.value))} /></label></div><div className={styles.scaleColumns}>{columns.map((column, index) => <div key={index}><label><input type="checkbox" checked={selected.includes(index)} onChange={event => config('scale', { ...scale, min: scale.min ?? 1, max: scale.max ?? 5, construct: scale.construct ?? '', columns: event.target.checked ? [...selected, index] : selected.filter(value => value !== index), reverse: reverse.filter(value => event.target.checked || value !== index) })} />{column}</label>{selected.includes(index) && <label className={styles.reverseItem}><input type="checkbox" checked={reverse.includes(index)} onChange={event => setScale('reverse', event.target.checked ? [...reverse, index] : reverse.filter(value => value !== index))} />反向计分</label>}</div>)}</div></details>;
        }
        if (field.type === 'json') return <JsonField key={field.key} label={field.label} value={value} onChange={next => config(field.key, next)} />;
        if (field.type === 'boolean') return <label className={styles.toggle} key={field.key}><span>{field.label}</span><input type="checkbox" checked={Boolean(value)} onChange={event => config(field.key, event.target.checked)} /></label>;
        if (field.type === 'select') return <label className={styles.field} key={field.key}>{field.label}<select value={String(value ?? '')} onChange={event => config(field.key, event.target.value)}><option value="">请选择</option>{(field.options ?? []).map(option => { const item = typeof option === 'object' && option ? option as { value?: unknown; label?: unknown } : { value: option, label: option }; return <option key={String(item.value)} value={String(item.value)}>{String(item.label ?? item.value)}</option>; })}</select></label>;
        if (field.type === 'number') return <label className={styles.field} key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} value={typeof value === 'number' ? value : ''} onChange={event => config(field.key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>;
        return <label className={styles.field} key={field.key}>{field.label}{['text', 'prompt', 'question', 'content', 'notes', 'source', 'context'].includes(field.key) ? <textarea rows={field.key === 'prompt' ? 6 : 3} value={String(value ?? '')} onChange={event => config(field.key, event.target.value)} /> : <input value={String(value ?? '')} onChange={event => config(field.key, event.target.value)} />}</label>;
      })}
      {catalog.executor === 'model' || catalog.executor === 'provider' ? serviceFields : null}
      {catalog.kind === 'chart' && <CanvasChartFormat node={node} choices={Array.isArray(run?.result?.choices) ? run.result.choices as ChartChoice[] : []} onConfig={config} onOpen={onOpen} />}
      <details className={styles.portDetails}><summary>输入与输出</summary>{catalog.inputs.map(port => <p key={`i-${port.id}`}>← {port.id} <small>{port.type}{port.required ? ' · 必需' : ''}</small></p>)}{catalog.outputs.map(port => <p key={`o-${port.id}`}>→ {port.id} <small>{port.type}</small></p>)}</details>
      <label className={styles.toggle}><span>启用节点</span><input type="checkbox" checked={!node.disabled} onChange={event => onChange({ ...node, disabled: !event.target.checked })} /></label>
      {run && <section className={styles.resultSection}><h3>{RUN_LABELS[run.status] ?? run.status}</h3>{run.errorCode && <p role="alert">{run.errorCode}</p>}{run.startedAt && <small>开始于 {new Date(run.startedAt).toLocaleTimeString('zh-CN')}</small>}{run.result && <CanvasResult result={run.result} />}{waiting && <div className={styles.decisionButtons}>{catalog.kind === 'survey_wait' ? <><button type="button" onClick={() => onDecision('lock_current')}>锁定当前数据</button><button type="button" onClick={() => onDecision('continue', { deadline: new Date(Date.now() + 86400000).toISOString() })}>继续等待一天</button></> : <><button type="button" onClick={() => onDecision(catalog.kind === 'survey_publish' ? 'publish' : catalog.kind === 'report' ? 'apply' : 'approve')}>{catalog.kind === 'survey_publish' ? '发布问卷' : catalog.kind === 'report' ? '应用报告提案' : '确认'}</button><button type="button" onClick={() => onDecision('reject')}>拒绝</button></>}</div>}</section>}
    </fieldset>
    <footer className={styles.inspectorFooter}><button type="button" disabled={!writable} className={styles.primary} onClick={onRun}>运行此节点</button>{catalog.editorSection && <button type="button" onClick={onOpen}>详细编辑 ↗</button>}<button type="button" disabled={!writable} onClick={onConnect}>连接到…</button><button type="button" disabled={!writable} onClick={onDuplicate}>复制</button><button type="button" disabled={!writable} onClick={onDelete} className={styles.danger}>删除</button></footer>
  </aside>;
}
