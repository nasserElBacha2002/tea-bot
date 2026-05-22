import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlowChecksum } from '../utils/flow-checksum.js';
import { parsePublishedVersionFromFilename } from '../utils/flow-version-parse.js';
import flowValidator from '../utils/flow-validator.js';

const miniFlow = {
  id: 'test-flow',
  name: 'Test',
  version: 'v1',
  entryNode: 'welcome',
  fallbackNode: 'fallback',
  nodes: [
    {
      id: 'welcome',
      type: 'message',
      message: 'Hola',
      transitions: [{ type: 'default', nextNode: 'fallback' }],
    },
    {
      id: 'fallback',
      type: 'message',
      message: 'No entendí',
      transitions: [{ type: 'default', nextNode: 'welcome' }],
    },
  ],
};

test('parsePublishedVersionFromFilename v19', () => {
  assert.deepEqual(parsePublishedVersionFromFilename('v19.json'), {
    versionNumber: 19,
    versionLabel: 'v19',
  });
});

test('mini flow valida estructura', () => {
  flowValidator.validate(miniFlow);
});

test('checksum estable para mini flow', () => {
  const raw = JSON.stringify(miniFlow);
  assert.equal(computeFlowChecksum(raw), computeFlowChecksum(raw));
});
