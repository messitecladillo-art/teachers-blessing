import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, validateCanvasLayout } from '../../../packages/evi-x-shared/src/workflow.ts';

// Synthetic layout input only; never inserts records or invokes models.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const size = Number(process.argv[2] ?? 50);
if (![50, 200].includes(size)) throw Error('Choose 50 or 200 nodes.');
const destination = resolve(root, process.argv[3] ?? `.collab/runs/20261011-research-canvas/canvas-${size}.json`);
const rel = relative(root, destination);
if (isAbsolute(rel) || rel.startsWith('..') || !rel.endsWith('.json')) throw Error('Output must be a JSON file inside this workspace.');
const nodes = [], edges = [], positions = {};
const half = Math.floor(size / 2);
for (let i = 0; i < size; i++) {
  const kind = i === 0 ? 'dataset' : i < half ? (i % 2 ? 'frequency' : 'numeric') : 'chart';
  const config = kind === 'dataset' ? {} : kind === 'chart' ? { chartKind: 'table', theme: 'blue' } : { x: 0 };
  const id = `stress-${i}`;
  nodes.push({ id, kind, title: `${kind === 'dataset' ? '数据' : kind === 'chart' ? '图表' : '分析'} ${String(i + 1).padStart(3, '0')}`, config });
  positions[id] = { x: 80 + (i % 10) * 340, y: 120 + Math.floor(i / 10) * 225 };
  if (i > 0 && i < half) edges.push({ id: `data-${i}`, source: 'stress-0', sourcePort: 'dataset', target: id, targetPort: 'dataset', kind: 'data' });
  if (i >= half) edges.push({ id: `result-${i}`, source: `stress-${1 + (i - half) % (half - 1)}`, sourcePort: 'result', target: id, targetPort: 'result', kind: 'data' });
}
const desiredEdges = size === 200 ? 500 : 80;
for (let i = 0; edges.length < desiredEdges; i++) {
  const source = i % size, target = (source + 1 + Math.floor(i / size)) % size;
  edges.push({ id: `reference-${i}`, source: `stress-${source}`, target: `stress-${target}`, sourcePort: '', targetPort: '', kind: 'reference' });
}
const definition = parseWorkflow({ schemaVersion: 'research-workflow/v1', nodes, edges });
const layout = validateCanvasLayout({ positions, groups: [] }, nodes.map(node => node.id));
await mkdir(resolve(destination, '..'), { recursive: true });
await writeFile(destination, JSON.stringify({ definition, layout }, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ size, edges: edges.length, file: destination }) + '\n');
