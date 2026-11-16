import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCanvasIdentity } from '../lib/canvas-identity.ts';

test('account changes purge that account draft in every project without removing other data', () => {
  const values = new Map([['evix:canvas:draft:a:one', 'private'], ['evix:canvas:draft:a:two', 'private'], ['evix:canvas:draft:ab:one', 'keep'], ['evix:canvas:view:a:one', 'keep'], ['questionnaire-backup', 'keep']]);
  const storage = { get length() { return values.size; }, key(i) { return [...values.keys()][i] ?? null; }, removeItem(k) { values.delete(k); } };
  clearCanvasIdentity(storage, 'a');
  assert.equal(values.size, 3); assert.ok(values.has('evix:canvas:draft:ab:one')); assert.ok(values.has('questionnaire-backup'));
  clearCanvasIdentity(storage, ''); clearCanvasIdentity(storage, 'a:'); assert.equal(values.size, 3);
});
