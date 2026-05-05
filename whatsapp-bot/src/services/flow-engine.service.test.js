import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowEngine } from './flow-engine.service.js';
import { compileFlow } from '../utils/compile-flow.js';

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

test('evaluateCompiledTransitionsDetailed: exact/includes/default/fallback', () => {
  const engine = new FlowEngine();
  const flow = {
    id: 'f1',
    version: 'v1',
    entryNode: 'a',
    fallbackNode: 'fb',
    nodes: [
      {
        id: 'a',
        transitions: [
          { type: 'matchAny', value: ['1', 'uno'], nextNode: 'b' },
          { type: 'matchIncludes', value: 'comprar', nextNode: 'c' },
          { type: 'default', nextNode: 'd' },
        ],
      },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
      { id: 'fb' },
    ],
  };
  const compiled = compileFlow(flow);
  assert.equal(engine.evaluateCompiledTransitionsDetailed(compiled, 'a', '1', 'fb').nextNodeId, 'b');
  assert.equal(engine.evaluateCompiledTransitionsDetailed(compiled, 'a', 'quiero comprar', 'fb').nextNodeId, 'c');
  assert.equal(engine.evaluateCompiledTransitionsDetailed(compiled, 'a', 'zzz', 'fb').nextNodeId, 'd');
  assert.equal(engine.evaluateCompiledTransitionsDetailed(compiled, 'x', 'zzz', 'fb').nextNodeId, 'fb');
});
