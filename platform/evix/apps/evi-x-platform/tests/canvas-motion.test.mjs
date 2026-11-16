import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_MOTION, canvasMotionDuration, canvasDetailLevel, snapCanvasPosition, interpolateCanvasPositions, createCanvasMotion } from '../lib/canvas-motion.ts';
import { duplicateCanvasNodes, removeCanvasNodes } from '../components/canvas/canvas-types.ts';
import { stableCanvasSelection, connectedDatasetColumns } from '../components/canvas/canvas-inspection.ts';

test('repeated React Flow selection receipts keep state identity and cannot trigger a render loop', () => {
  const previous = ['a', 'b']; let state = previous;
  for (let update = 0; update < 100; update++) state = stableCanvasSelection(state, ['a', 'b']);
  assert.equal(state, previous);
  const changed = stableCanvasSelection(state, ['b']); assert.notEqual(changed, state); assert.deepEqual(changed, ['b']);
  const empty = []; assert.equal(stableCanvasSelection(empty, []), empty);
});
test('variable choices use connected data metadata, skip control links and terminate on cycles', () => {
  const definition = { schemaVersion: 'research-workflow/v1', nodes: [{ id: 'data', kind: 'dataset', title: '调查', config: { datasetVersionId: 'd-1' } }, { id: 'unrelated', kind: 'dataset', title: '旁支', config: { datasetVersionId: 'd-2' } }, { id: 'clean', kind: 'transform', title: '清洗', config: {} }, { id: 'alpha', kind: 'alpha', title: '信度', config: {} }], edges: [{ id: 'control', kind: 'control', source: 'unrelated', target: 'alpha' }, { id: 'data1', kind: 'data', source: 'data', target: 'clean' }, { id: 'data2', kind: 'data', source: 'clean', target: 'alpha' }] };
  const datasets = [{ id: 'd-1', sourceName: '调查', columns: ['服务', '价值', '满意'] }, { id: 'd-2', sourceName: '旁支', columns: ['旁支变量'] }];
  assert.deepEqual(connectedDatasetColumns(definition, 'alpha', datasets), ['服务', '价值', '满意']);
  definition.edges = [{ id: 'cycle1', kind: 'data', source: 'alpha', target: 'clean' }, { id: 'cycle2', kind: 'data', source: 'clean', target: 'alpha' }];
  assert.deepEqual(connectedDatasetColumns(definition, 'alpha', datasets), []);
});

test('reduced and off motion reach final state without moving input targets', () => {
  for (const action of Object.keys(CANVAS_MOTION)) { assert.equal(canvasMotionDuration(action, 'off'), 0); assert.equal(canvasMotionDuration(action, 'reduced'), 0); assert.equal(canvasMotionDuration(action, 'standard', true), 0); }
  assert.equal(canvasMotionDuration('selection', 'standard'), 180); assert.equal(canvasMotionDuration('layout', 'standard'), 300);
  assert.deepEqual(snapCanvasPosition({ x: 29, y: -9 }), { x: 32, y: -16 });
  assert.deepEqual(snapCanvasPosition({ x: 29, y: -9 }, true), { x: 29, y: -9 });
});
test('semantic zoom preserves readable configuration outside scaled canvas', () => {
  assert.deepEqual([1.2, .8, .4, .15].map(canvasDetailLevel), ['detail', 'summary', 'title', 'overview']);
});
test('layout interpolation keeps nodes and ports on one shared coordinate path', () => {
  const a = { n1: { x: 10, y: 20 } }, b = { n1: { x: 110, y: -80 }, n2: { x: 20, y: 30 } };
  assert.deepEqual(interpolateCanvasPositions(a, b, 0), { ...a, n2: b.n2 });
  assert.deepEqual(interpolateCanvasPositions(a, b, 1), b);
  assert.deepEqual(interpolateCanvasPositions(a, b, 2), b);
  const midway = interpolateCanvasPositions(a, b, .5).n1; assert.ok(midway.x > 10 && midway.x < 110); assert.ok(midway.y > -80 && midway.y < 20);
});
test('duplicate aliases artifact versions and remaps internal edges without copying private data', () => {
  const doc = { definition: { schemaVersion: 'research-workflow/v1', nodes: [{ id: 'a', kind: 'questionnaire', title: '问卷', config: { artifactVersionId: 'existing-version' } }, { id: 'b', kind: 'review', title: '复核', config: {} }], edges: [{ id: 'e', source: 'a', sourcePort: 'questionnaire', target: 'b', targetPort: 'value', kind: 'data' }] }, layout: { positions: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }, groups: [{ id: 'g', title: '研究', nodeIds: ['a', 'b'], collapsed: false }] } };
  let count = 0; const { document, ids } = duplicateCanvasNodes(doc, ['a', 'b'], () => `new-${++count}`);
  assert.deepEqual(ids, ['new-1', 'new-2']); assert.equal(document.definition.nodes[2].config.artifactVersionId, 'existing-version');
  assert.deepEqual(document.definition.edges[1], { ...doc.definition.edges[0], id: 'new-3', source: 'new-1', target: 'new-2' });
  assert.equal(doc.definition.nodes.length, 2); assert.deepEqual(document.layout.positions['new-1'], { x: 48, y: 48 });
  const removed = removeCanvasNodes(document, ['a', 'b']); assert.equal(removed.definition.edges.length, 1); assert.equal(removed.layout.groups.length, 0); assert.deepEqual(Object.keys(removed.layout.positions), ['new-1', 'new-2']);
});
test('interrupted visuals cancel their animation and release visibility listeners', () => {
  const listeners = new Map(), reducedListeners = new Map(), animations = [];
  globalThis.document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const reduced = { matches: false, addEventListener: (name, callback) => reducedListeners.set(name, callback), removeEventListener: name => reducedListeners.delete(name) };
  globalThis.window = { matchMedia: () => reduced };
  const element = { animate: (frames, options) => { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } }; animations.push(animation); return animation; } };
  let preference = 'standard'; const controller = createCanvasMotion({ contains: node => node === element }, () => preference);
  controller.animate(element, [{ opacity: 0 }, { opacity: 1 }], 'enter');
  controller.animate(element, [{ opacity: .5 }, { opacity: 1 }], 'selection'); assert.equal(animations[0].cancelled, true); assert.equal(animations[1].options.duration, 180);
  globalThis.document.hidden = true; listeners.get('visibilitychange')(); assert.equal(animations[1].cancelled, true);
  controller.animate(element, [{ opacity: 0 }, { opacity: 1 }], 'enter'); assert.equal(animations.length, 2);
  globalThis.document.hidden = false; preference = 'off'; controller.animate(element, [{ opacity: 0 }, { opacity: 1 }], 'enter'); assert.equal(animations.length, 2);
  controller.dispose(); assert.equal(listeners.size, 0); assert.equal(reducedListeners.size, 0);
  delete globalThis.window; delete globalThis.document;
});
