import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderedSubsequence, mergeVisitedNodes } from './export-session-merge.service.js';

test('mergeVisitedNodes prefiere persisted cuando runtime es subsecuencia', () => {
  const runtime = ['welcome', 'si_menu'];
  const persisted = ['welcome', 'si_menu', 'si_dist_menu', 'si_dist_lic_a', 'human_handoff'];
  assert.deepEqual(mergeVisitedNodes(runtime, persisted), persisted);
});

test('isOrderedSubsequence valida orden', () => {
  assert.equal(isOrderedSubsequence(['a', 'c'], ['a', 'b', 'c']), true);
  assert.equal(isOrderedSubsequence(['b', 'a'], ['a', 'b', 'c']), false);
});