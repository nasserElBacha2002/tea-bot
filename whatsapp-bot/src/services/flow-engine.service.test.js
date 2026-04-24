import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowEngine } from './flow-engine.service.js';

test('evaluateTransitions: sin nodo devuelve fallback', () => {
  const engine = new FlowEngine();
  assert.equal(engine.evaluateTransitions(null, 'hola', 'fb'), 'fb');
});

test('evaluateTransitions: sin transiciones usa nextNode o fallback', () => {
  const engine = new FlowEngine();
  assert.equal(engine.evaluateTransitions({ id: 'a', transitions: [] }, 'x', 'fb'), 'fb');
  assert.equal(
    engine.evaluateTransitions({ id: 'a', nextNode: 'n2', transitions: [] }, 'x', 'fb'),
    'n2',
  );
});

test('evaluateTransitions: match exacto', () => {
  const engine = new FlowEngine();
  const node = {
    id: 'a',
    transitions: [{ type: 'match', value: 'sí', nextNode: 'b' }],
  };
  assert.equal(engine.evaluateTransitions(node, 'sí', 'fb'), 'b');
});
