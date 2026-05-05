import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFlow } from './compile-flow.js';

function sampleFlow() {
  return {
    id: 'main-menu',
    version: 'v1',
    entryNode: 'welcome',
    fallbackNode: 'fallback',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: 'Hola',
        transitions: [
          { type: 'match', value: '1', nextNode: 'products' },
          { type: 'matchAny', value: ['si', 'sí'], nextNode: 'products' },
          { type: 'matchIncludes', value: 'comprar', nextNode: 'products' },
          { type: 'default', nextNode: 'fallback' },
        ],
      },
      { id: 'products', type: 'message', message: 'Productos' },
      { id: 'fallback', type: 'message', message: 'No entendi' },
      { id: 'human_handoff', type: 'message', message: 'Te derivo' },
    ],
  };
}

test('compila indices principales', () => {
  const compiled = compileFlow(sampleFlow());
  assert.equal(compiled.nodesById.get('welcome').id, 'welcome');
  assert.equal(compiled.defaultTransitionByNodeId.get('welcome').nextNode, 'fallback');
  assert.equal(compiled.exactMatchByNodeId.get('welcome').get('1').nextNode, 'products');
  assert.equal(compiled.exactMatchByNodeId.get('welcome').get('sí').nextNode, 'products');
  assert.equal(compiled.includesRulesByNodeId.get('welcome')[0].needle, 'comprar');
});

test('expone stats del flujo', () => {
  const compiled = compileFlow(sampleFlow());
  assert.equal(compiled.stats.nodeCount, 4);
  assert.equal(compiled.stats.transitionCount, 4);
  assert.equal(compiled.stats.exactValueCount, 3);
});
