import test from 'node:test';
import assert from 'node:assert/strict';
import flowValidator from './flow-validator.js';
import { compileFlow } from './compile-flow.js';
import { normalizeFlowDocumentForRuntime } from './flow-document-runtime-normalize.js';

function numericFlow() {
  return {
    id: 'main-menu',
    version: 'v10',
    entryNode: 'archivo_info',
    fallbackNode: 'fallback',
    nodes: [
      {
        id: 'archivo_info',
        type: 'message',
        message: 'Info',
        transitions: [{ type: 'match', value: 1, nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'fb', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'bye' },
    ],
  };
}

test('normalizeFlowDocumentForRuntime coerces numeric transition values', () => {
  const normalized = normalizeFlowDocumentForRuntime(numericFlow());
  assert.equal(normalized.nodes[0].transitions[0].value, '1');
  assert.doesNotThrow(() => flowValidator.validate(normalized));
  assert.doesNotThrow(() => compileFlow(normalized));
});
