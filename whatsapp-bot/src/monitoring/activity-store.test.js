import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeActivityTimestamps } from './activity-store.js';

const memory = {
  lastInboundAt: null,
  lastOutboundAt: null,
  lastProcessedAt: null,
  lastSuccessfulFlowAt: null,
  lastErrorAt: null,
};

test('store vacio usa el timestamp de DB', () => {
  const merged = mergeActivityTimestamps(memory, {
    ok: true,
    lastInboundAt: '2026-10-16T18:00:00.000Z',
    lastOutboundAt: '2026-10-16T18:01:00.000Z',
    lastProcessedAt: '2026-10-16T18:02:00.000Z',
  });
  assert.equal(merged.lastInboundAt, '2026-10-16T18:00:00.000Z');
  assert.equal(merged.lastOutboundAt, '2026-10-16T18:01:00.000Z');
  assert.equal(merged.lastProcessedAt, '2026-10-16T18:02:00.000Z');
  assert.equal(merged.activityPersistenceOk, true);
});

test('se conserva el timestamp mas reciente entre memoria y DB', () => {
  const merged = mergeActivityTimestamps({
    ...memory,
    lastInboundAt: '2026-10-16T19:00:00.000Z',
  }, {
    ok: true,
    lastInboundAt: '2026-10-16T18:00:00.000Z',
    lastOutboundAt: null,
    lastProcessedAt: null,
  });
  assert.equal(merged.lastInboundAt, '2026-10-16T19:00:00.000Z');
});

test('DB caida no inventa timestamps ni se reporta como lectura correcta', () => {
  const merged = mergeActivityTimestamps(memory, {
    ok: false,
    lastInboundAt: '2026-10-16T18:00:00.000Z',
  });
  assert.equal(merged.lastInboundAt, null);
  assert.equal(merged.activityPersistenceOk, false);
});
