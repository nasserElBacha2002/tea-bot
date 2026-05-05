import test from 'node:test';
import assert from 'node:assert/strict';
import conversationTracker from './conversationTracker.service.js';

test('buildTrackingPatch guarda key/value de transición track', () => {
  const session = { answers: { nombre: 'Ana' } };
  const transition = { track: { key: 'es_estudiante', value: 'SI' } };
  const patch = conversationTracker.buildTrackingPatch(session, transition);
  assert.deepEqual(patch.answers, { nombre: 'Ana', es_estudiante: 'SI' });
});

test('buildNodeVisitPatch evita duplicados consecutivos', () => {
  const session = { visitedNodes: ['welcome'] };
  const one = conversationTracker.buildNodeVisitPatch(session, 'welcome');
  assert.deepEqual(one.visitedNodes, ['welcome']);
  const two = conversationTracker.buildNodeVisitPatch(one, 'menu');
  assert.deepEqual(two.visitedNodes, ['welcome', 'menu']);
});

test('buildFallbackPatch incrementa contador', () => {
  assert.equal(conversationTracker.buildFallbackPatch({ fallbackCount: 2 }).fallbackCount, 3);
});
