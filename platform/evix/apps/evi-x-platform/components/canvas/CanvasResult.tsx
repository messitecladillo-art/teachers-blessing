'use client';
import { useEffect, useRef } from 'react';
import styles from './ResearchCanvas.module.css';

function safeSVG(svg: string): boolean { return svg.length <= 4000000 && /^\s*<svg[\s>]/.test(svg) && !/<(?:script|foreignObject|iframe|image|use)\b|\bon\w+\s*=|(?:href|xlink:href)\s*=/i.test(svg); }
export function CanvasChartPreview({ svg, title = '分析图表' }: { svg: string; title?: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current; if (!safeSVG(svg) || !element) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); element.src = url;
    return () => { element.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [svg]);
  // SVG is an image document, never injected into the active DOM.
  // eslint-disable-next-line @next/next/no-img-element
  return safeSVG(svg) ? <img ref={image} className={styles.chartPreview} alt={title} /> : null;
}
function privateDownload(value: unknown): string | null {
  if (typeof window === 'undefined' || typeof value !== 'string' || !value.startsWith('/api/projects/')) return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname.startsWith('/api/projects/') ? `${url.pathname}${url.search}` : null; } catch { return null; }
}
const formatted = (value: unknown) => value === null ? '—' : typeof value === 'number' ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : String(value ?? '');
export default function CanvasResult({ result }: { result: Record<string, unknown> }) {
  const payload = result.output && typeof result.output === 'object' ? result.output as Record<string, unknown> : result;
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : null;
  const headers = Array.isArray(data?.headers) ? data.headers : [], rows = Array.isArray(data?.rows) ? data.rows as unknown[][] : [];
  const metrics = Array.isArray(data?.metrics) ? data.metrics as { label: string; value: number | null }[] : [];
  const download = privateDownload(payload.downloadUrl);
  return <div className={styles.resultContent}>
    <div className={styles.resultMeta}>{typeof payload.classification === 'string' && <span>{{ simulated: '合成数据', synthetic: '合成数据', actual: '实际数据', proposed: '提案', unknown: '来源待确认' }[payload.classification] ?? payload.classification}</span>}{typeof data?.n === 'number' && <span>有效样本 {formatted(data.n)}</span>}{typeof payload.hash === 'string' && <span title={payload.hash}>版本 {payload.hash.slice(0, 8)}</span>}</div>
    {typeof payload.svg === 'string' && <CanvasChartPreview svg={payload.svg} />}
    {metrics.length > 0 && <dl className={styles.resultMetrics}>{metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{formatted(metric.value)}</dd></div>)}</dl>}
    {headers.length > 0 && <div className={styles.tableScroll}><table className={styles.resultTable}><thead><tr>{headers.map((header, index) => <th key={index}>{formatted(header)}</th>)}</tr></thead><tbody>{rows.slice(0, 20).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{formatted(cell)}</td>)}</tr>)}</tbody></table>{rows.length > 20 && <small>显示前 20 行，共 {rows.length} 行</small>}</div>}
    {typeof data?.interpretation === 'string' && <p>{data.interpretation}</p>}
    {typeof payload.text === 'string' && <p className={styles.resultText}>{payload.text}</p>}
    {download && <a className={styles.downloadLink} href={download} download>{typeof payload.filename === 'string' ? `下载 ${payload.filename}` : '下载成果文件'} ↓</a>}
    <details className={styles.receiptDetails}><summary>查看计算与版本记录</summary><pre>{JSON.stringify({ ...payload, svg: typeof payload.svg === 'string' ? '[图形已展示]' : undefined }, null, 2).slice(0, 10000)}</pre></details>
  </div>;
}
