import type { CanvasDefinition, CanvasNodeRun } from './canvas-types.ts';

export type CanvasDataset = { id: string; sourceName: string; rowCount?: number; columns?: string[]; classification?: 'actual' | 'simulated' };
/** Read only actual connected data metadata; research/control links never select variables. */
export function connectedDatasetColumns(definition: CanvasDefinition, nodeId: string, datasets: readonly CanvasDataset[], runs: readonly CanvasNodeRun[] = []): string[] {
  const seen = new Set<string>();
  const inspect = (id: string): string[] => {
    if (seen.has(id)) return []; seen.add(id);
    const node = definition.nodes.find(node => node.id === id), run = runs.find(run => run.nodeId === id);
    if (!node) return [];
    const datasetId = typeof node.config.datasetVersionId === 'string' ? node.config.datasetVersionId : typeof run?.result?.id === 'string' ? run.result.id : undefined;
    const dataset = datasets.find(dataset => dataset.id === datasetId);
    if (dataset?.columns?.length) return [...dataset.columns];
    if (node.kind === 'survey_wait' && Array.isArray(run?.result?.columns) && run.result.columns.every(column => typeof column === 'string')) return [...run.result.columns];
    for (const edge of definition.edges.filter(edge => edge.kind === 'data' && edge.target === id)) { const columns = inspect(edge.source); if (columns.length) return columns; }
    return [];
  };
  return inspect(nodeId);
}
/** Same selection emitted by React Flow can arrive repeatedly after controlled-node updates. */
export function stableCanvasSelection(previous: string[], incoming: string[]): string[] { return previous.length === incoming.length && previous.every((value, index) => value === incoming[index]) ? previous : incoming; }
