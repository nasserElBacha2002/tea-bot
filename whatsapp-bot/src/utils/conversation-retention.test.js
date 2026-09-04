import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETENTION_BATCH_SIZE_MAX,
  clampRetentionBatchSize,
  computeRetentionCutoff,
  isConversationPastRetention,
  parsePositiveInt,
} from './conversation-retention.js';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const CUTOFF = computeRetentionCutoff(NOW, 30);

test('cutoff es now - 30 días', () => {
  assert.equal(CUTOFF.toISOString(), '2026-08-05T12:00:00.000Z');
});

test('lastMessageAt = now - 31 días se elimina', () => {
  const lastMessageAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(isConversationPastRetention({ lastMessageAt }, CUTOFF), true);
});

test('lastMessageAt = now - 29 días permanece', () => {
  const lastMessageAt = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
  assert.equal(isConversationPastRetention({ lastMessageAt }, CUTOFF), false);
});

test('lastMessageAt exactamente en cutoff permanece (semántica <)', () => {
  assert.equal(isConversationPastRetention({ lastMessageAt: CUTOFF }, CUTOFF), false);
});

test('lastMessageAt NULL usa startedAt', () => {
  const startedAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(isConversationPastRetention({ lastMessageAt: null, startedAt }, CUTOFF), true);
  const recentStart = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
  assert.equal(isConversationPastRetention({ lastMessageAt: null, startedAt: recentStart }, CUTOFF), false);
});

test('parsePositiveInt valida enteros', () => {
  assert.equal(parsePositiveInt('30', 10), 30);
  assert.equal(parsePositiveInt('0', 10), 10);
  assert.equal(parsePositiveInt('-5', 10), 10);
  assert.equal(parsePositiveInt('nope', 10), 10);
  assert.equal(parsePositiveInt('3.9', 10), 3);
});

test('clampRetentionBatchSize aplica un solo máximo', () => {
  assert.equal(clampRetentionBatchSize(1000), RETENTION_BATCH_SIZE_MAX);
  assert.equal(clampRetentionBatchSize(50), 50);
  assert.equal(clampRetentionBatchSize(0), 100);
});
