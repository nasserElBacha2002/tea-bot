import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationRetentionService } from './conversationRetention.service.js';
import { config } from '../config.js';

function createHarness({ batches = [], onDelete, resetImpl } = {}) {
  const deletedIds = [];
  const resetUsers = [];
  const calls = { delete: 0, reset: 0 };
  const queue = [...batches];

  const service = new ConversationRetentionService({
    dbEnabled: () => true,
    runtimeSession: {
      resetSession: async (userId) => {
        calls.reset += 1;
        if (resetImpl) return resetImpl(userId);
        resetUsers.push(userId);
      },
    },
    runTransaction: async (fn) => fn(null),
    conversationRepo: {
      deleteInactiveBatchBefore: async (cutoff, { limit } = {}) => {
        calls.delete += 1;
        if (onDelete) return onDelete({ cutoff, limit, call: calls.delete });
        const batch = queue.shift() || [];
        deletedIds.push(...batch.map((row) => row.id));
        return batch;
      },
    },
  });

  return { service, deletedIds, resetUsers, calls };
}

function withRetentionConfig(patch, fn) {
  const previous = {
    enabled: config.conversationRetentionEnabled,
    days: config.conversationRetentionDays,
    batch: config.conversationRetentionBatchSize,
  };
  Object.assign(config, {
    conversationRetentionEnabled: true,
    ...patch,
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.conversationRetentionEnabled = previous.enabled;
      config.conversationRetentionDays = previous.days;
      config.conversationRetentionBatchSize = previous.batch;
    });
}

test('runSweep elimina inactivas en batch y resetea sesiones runtime', async () => {
  await withRetentionConfig({ conversationRetentionBatchSize: 2 }, async () => {
    const { service, deletedIds, resetUsers, calls } = createHarness({
      batches: [
        [{ id: 'c1', externalUserId: 'user:c1' }, { id: 'c2', externalUserId: 'user:c2' }],
        [{ id: 'c3', externalUserId: 'user:c3' }],
        [],
      ],
    });
    const result = await service.runSweep({ now: new Date('2026-09-04T12:00:00.000Z') });
    assert.equal(result.skipped, false);
    assert.equal(result.conversationsDeleted, 3);
    assert.equal(result.runtimeCleaned, 3);
    assert.equal(result.runtimeCleanupFailed, 0);
    assert.deepEqual(deletedIds, ['c1', 'c2', 'c3']);
    assert.deepEqual(resetUsers, ['user:c1', 'user:c2', 'user:c3']);
    assert.equal(calls.delete, 3);
  });
});

test('batchSize configurado 1000 con tope 500 procesa todas las filas', async () => {
  await withRetentionConfig({ conversationRetentionBatchSize: 500 }, async () => {
    const remaining = Array.from({ length: 1200 }, (_, i) => ({
      id: `c${i}`,
      externalUserId: `user:c${i}`,
    }));
    const { service } = createHarness({
      onDelete: ({ limit }) => remaining.splice(0, limit),
    });
    const result = await service.runSweep();
    assert.equal(result.conversationsDeleted, 1200);
    assert.equal(result.runtimeCleaned, 1200);
  });
});

test('segunda ejecución es idempotente (no encuentra filas)', async () => {
  await withRetentionConfig({}, async () => {
    const { service, deletedIds, calls } = createHarness({ batches: [[], []] });
    const first = await service.runSweep();
    const second = await service.runSweep();
    assert.equal(first.conversationsDeleted, 0);
    assert.equal(second.conversationsDeleted, 0);
    assert.equal(deletedIds.length, 0);
    assert.equal(calls.delete, 2);
  });
});

test('runSweep no-op si retención deshabilitada', async () => {
  const previousEnabled = config.conversationRetentionEnabled;
  config.conversationRetentionEnabled = false;
  const { service, calls } = createHarness({
    batches: [[{ id: 'c1', externalUserId: 'user:c1' }]],
  });
  try {
    const result = await service.runSweep();
    assert.equal(result.skipped, true);
    assert.equal(calls.delete, 0);
  } finally {
    config.conversationRetentionEnabled = previousEnabled;
  }
});

test('deleteInactiveBatchBefore no borra si lastMessageAt se refrescó', async () => {
  await withRetentionConfig({}, async () => {
    const conversation = {
      id: 'c-race',
      externalUserId: 'user:race',
      lastMessageAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const { service } = createHarness({
      onDelete: ({ cutoff }) => {
        if (new Date(conversation.lastMessageAt) < cutoff) {
          return [{ id: conversation.id, externalUserId: conversation.externalUserId }];
        }
        return [];
      },
    });
    conversation.lastMessageAt = new Date();
    const result = await service.runSweep({ now: new Date('2026-09-04T12:00:00.000Z') });
    assert.equal(result.conversationsDeleted, 0);
  });
});

test('runSweep propaga error de repository; scheduler lo absorbe', async () => {
  await withRetentionConfig({}, async () => {
    let shouldThrow = true;
    const { service } = createHarness({
      onDelete: async () => {
        if (shouldThrow) throw new Error('db down');
        return [];
      },
    });

    await assert.rejects(() => service.runSweep(), /db down/);
    assert.equal(service.running, false);

    const scheduledResult = await service.runScheduledSweep();
    assert.equal(scheduledResult.failed, true);
    assert.equal(service.running, false);

    shouldThrow = false;
    const again = await service.runSweep();
    assert.equal(again.skipped, false);
    assert.equal(again.conversationsDeleted, 0);
  });
});

test('resetSession fallido no reporta cleanup completo y reintenta', async () => {
  await withRetentionConfig({}, async () => {
    let shouldFail = true;
    const { service, calls } = createHarness({
      batches: [[{ id: 'c-fail', externalUserId: 'user:fail' }], []],
      resetImpl: async (userId) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('disk full');
        }
        return userId;
      },
    });

    const first = await service.runSweep();
    assert.equal(first.conversationsDeleted, 1);
    assert.equal(first.runtimeCleanupFailed, 1);
    assert.equal(first.runtimeCleaned, 0);
    assert.equal(service.pendingRuntimeCleanup.has('user:fail'), true);

    const second = await service.runSweep();
    assert.equal(second.runtimeCleaned >= 1, true);
    assert.equal(second.runtimeCleanupFailed, 0);
    assert.equal(service.pendingRuntimeCleanup.has('user:fail'), false);
    assert.equal(calls.reset >= 2, true);
  });
});
