import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlowChecksum } from './flow-checksum.js';

test('computeFlowChecksum es estable para el mismo JSON', () => {
  const flow = { id: 'x', nodes: [{ id: 'a' }] };
  const a = computeFlowChecksum(JSON.stringify(flow));
  const b = computeFlowChecksum(JSON.stringify(flow));
  assert.equal(a, b);
  assert.equal(a.length, 64);
});
