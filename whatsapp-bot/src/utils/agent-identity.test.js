import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentsMatch,
  normalizeAgentId,
  resolveAgentIdFromUsername,
} from './agent-identity.js';

test('normalizeAgentId compara UUID sin importar mayúsculas', () => {
  const upper = '7319B35A-ABC5-4B76-A9C7-55418721F56C';
  const lower = '7319b35a-abc5-4b76-a9c7-55418721f56c';
  assert.equal(normalizeAgentId(upper), lower);
  assert.equal(agentsMatch(upper, lower), true);
});

test('resolveAgentIdFromUsername es estable por username', () => {
  const first = resolveAgentIdFromUsername('admin');
  const second = resolveAgentIdFromUsername('admin');
  assert.equal(first, second);
  assert.notEqual(resolveAgentIdFromUsername('admin'), resolveAgentIdFromUsername('operator'));
});
