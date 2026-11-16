'use client';
import { CHART_FAMILIES } from '@/lib/chart-registry';
import { CHART_THEMES, defaultChartStyle } from '@/lib/chart-theme';
import type { ChartChoice, ChartStyle } from '@/lib/chart-types';
import type { CanvasNode } from './canvas-types';
import styles from './ResearchCanvas.module.css';

export default function CanvasChartFormat({ node, choices, onConfig, onOpen }: { node: CanvasNode; choices: ChartChoice[]; onConfig: (key: string, value: unknown) => void; onOpen: () => void }) {
  const style = { ...defaultChartStyle('统计结果'), ...(node.config.style && typeof node.config.style === 'object' ? node.config.style : {}) } as ChartStyle;
  const setStyle = (key: keyof ChartStyle, value: unknown) => onConfig('style', { ...(node.config.style && typeof node.config.style === 'object' ? node.config.style : {}), [key]: value, tableRules: 'three_line' });
  return <details className={styles.formatTree} open><summary>图与表格式</summary>
    <details open><summary>图形选择</summary><label className={styles.radioChoice}><input type="radio" name={`chart-${node.id}`} checked={(node.config.chartKind ?? 'auto') === 'auto'} onChange={() => onConfig('chartKind', 'auto')} /><span>根据结果选择</span></label>
      {CHART_FAMILIES.map(family => { const list = choices.filter(choice => choice.family === family.id); return list.length ? <details key={family.id}><summary>{family.title} <small>{list.length}</small></summary>{list.map(choice => <label className={styles.radioChoice} title={choice.reason || choice.description} key={choice.id}><input type="radio" name={`chart-${node.id}`} disabled={!choice.available} checked={node.config.chartKind === choice.id} onChange={() => onConfig('chartKind', choice.id)} /><span>{choice.title}<small>{choice.available ? choice.description : choice.reason}</small></span></label>)}</details> : null; })}
      {!choices.length && <p className={styles.help}>首次运行后，图型树会显示当前结果可用的图形。</p>}
    </details>
    <details open><summary>配色与文字</summary><label className={styles.field}>色系<select value={String(node.config.theme ?? 'blue')} onChange={event => onConfig('theme', event.target.value)}>{CHART_THEMES.map(theme => <option value={theme.id} key={theme.id}>{theme.title}</option>)}</select></label><div className={styles.swatches}>{(CHART_THEMES.find(theme => theme.id === (node.config.theme ?? 'blue')) ?? CHART_THEMES[0]).colors.map(color => <i key={color} style={{ background: color }} />)}</div>
      {([['title','标题'],['subtitle','副标题'],['xLabel','横轴标题'],['yLabel','纵轴标题'],['note','图下注释']] as const).map(([key,label]) => <label key={key} className={styles.field}>{label}<input maxLength={key === 'note' ? 500 : 200} value={style[key]} onChange={event => setStyle(key,event.target.value)} /></label>)}
      <div className={styles.fieldPair}><label className={styles.field}>字体<select value={style.fontFamily} onChange={event => setStyle('fontFamily',event.target.value)}><option value="sans">无衬线</option><option value="serif">衬线</option></select></label><label className={styles.field}>字号<input type="number" min={10} max={24} value={style.fontSize} onChange={event => setStyle('fontSize',Number(event.target.value))} /></label></div>
    </details>
    <details><summary>尺寸与边界</summary><div className={styles.fieldPair}>{([['width','宽度',320,2400],['height','高度',240,1800],['decimals','小数位数',0,6]] as const).map(([key,label,min,max]) => <label className={styles.field} key={key}>{label}<input type="number" min={min} max={max} value={style[key]} onChange={event => setStyle(key,Number(event.target.value))} /></label>)}</div>
      {([['showLegend','图例'],['showLabels','数值标注'],['showGrid','坐标网格'],['showBorder','图形框线']] as const).map(([key,label]) => <label className={styles.toggle} key={key}><span>{label}</span><input type="checkbox" checked={style[key]} onChange={event => setStyle(key,event.target.checked)} /></label>)}
      <div className={styles.fieldPair}>{([['background','背景'],['ink','文字']] as const).map(([key,label]) => <label className={styles.field} key={key}>{label}<input type="color" value={style[key]} onChange={event => setStyle(key,event.target.value)} /></label>)}</div>
    </details>
    <p className={styles.help}>三线表 · 1.5 / 0.75 / 1.5 磅 · 各列居中</p><button type="button" onClick={onOpen} className={styles.wideButton}>打开完整图表工作台 ↗</button>
  </details>;
}
