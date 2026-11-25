import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationRetentionService } from './conversationRetention.service.js';
import sessionService from './session.service.js';
import { config } from '../config.js';

test.before(() => {
  config.monitoringEnabled = false;
  process.env.TB_QUIET_RETENTION_ROW_LOGS = '1';
});

test.after(() => {
  delete process.env.TB_QUIET_RETENTION_ROW_LOGS;
});
import { resetJobStatusForTests } from '../monitoring/job-status.store.js';

test.beforeEach(() => {
  config.monitoringEnabled = false;
  resetJobStatusForTests();
  sessionService.sessions = {};
});

function createHarness({ batches = [], onDelete, resetImpl } = {}) {
  const deletedIds = [];
  const resetUsers = [];
  const calls = { delete: 0, reset: 0 };
  const queue = [...batches];

  const service = new ConversationRetentionService({
    dbEnabled: () => true,
    acquireLock: async () => ({ acquired: true, returnCode: 0 }),
    releaseLock: async () => {},
    verifyLock: async () => true,
    runtimeSession: {
      resetSessionForDeletedConversation: async (userId, conversationId) => {
        calls.reset += 1;
        if (resetImpl) return resetImpl(userId, conversationId);
        resetUsers.push({ userId, conversationId });
        return { action: 'reset' };
      },
    },
    runTransaction: async (fn) => fn(null),
    attachmentRepo: {
      listStoredKeysByConversationIds: async () => [],
    },
    mediaService: {
      deleteStoredObjects: async () => ({ deleted: 1, failed: 0 }),
    },
    conversationRepo: {
      findByChannelAndExternalUserId: async () => null,
      deleteInactiveRetentionBatch: async (cutoff, { limit } = {}) => {
        if (onDelete) {
          calls.delete += 1;
          const rows = await onDelete({ cutoff, limit, call: calls.delete });
          return { rows: rows || [], storageKeys: [] };
        }
        const batch = queue.shift();
        if (!batch || batch.length === 0) {
          return { rows: [], storageKeys: [] };
        }
        calls.delete += 1;
        deletedIds.push(...batch.map((row) => row.id));
        return { rows: batch, storageKeys: [] };
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
    assert.equal(resetUsers.length, 3);
    assert.equal(calls.delete, 2);
  });
});

test('batchSize configurado 1000 con tope 500 procesa 1200 filas en lotes completos y final parcial', async () => {
  await withRetentionConfig({ conversationRetentionBatchSize: 500 }, async () => {
    const total = 1200;
    const remaining = Array.from({ length: total }, (_, i) => ({
      id: `c${i}`,
      externalUserId: `user:c${i}`,
    }));
    const limits = [];
    const { service, calls } = createHarness({
      onDelete: ({ limit }) => {
        limits.push(limit);
        return remaining.splice(0, limit);
      },
      resetImpl: async () => ({ action: 'no_session' }),
    });
    const result = await service.runSweep();
    assert.equal(result.conversationsDeleted, total);
    assert.equal(calls.delete, 4);
    assert.deepEqual(limits, [500, 500, 500, 500]);
    const second = await service.runSweep();
    assert.equal(second.conversationsDeleted, 0);
    assert.equal(calls.delete, 5);
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
    assert.equal(calls.delete, 0);
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
      onDelete: ({ cutoff, preview }) => {
        const eligible = new Date(conversation.lastMessageAt) < cutoff
          ? [{ id: conversation.id, externalUserId: conversation.externalUserId }]
          : [];
        if (preview) return eligible;
        return eligible;
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
      resetImpl: async () => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('disk full');
        }
        return { action: 'reset' };
      },
    });

    const first = await service.runSweep();
    assert.equal(first.conversationsDeleted, 1);
    assert.equal(first.runtimeCleanupFailed, 1);
    assert.equal(first.runtimeCleaned, 0);
    assert.equal(service.pendingRuntimeCleanup.has('c-fail'), true);

    const second = await service.runSweep();
    assert.equal(second.runtimeCleaned >= 1, true);
    assert.equal(second.runtimeCleanupFailed, 0);
    assert.equal(service.pendingRuntimeCleanup.has('c-fail'), false);
    assert.equal(calls.reset >= 2, true);
  });
});

test('runSweep con lock distribuido omitido no emite job_started', async () => {
  await withRetentionConfig({}, async () => {
    config.monitoringEnabled = false;
    const events = [];
    const original = console.log;
    console.log = (...args) => {
      for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('{')) {
          try {
            events.push(JSON.parse(arg));
          } catch { /* ignore */ }
        }
      }
      original.apply(console, args);
    };
    const { service } = createHarness({ batches: [[{ id: 'c1', externalUserId: 'u1' }]] });
    service.acquireLock = async () => ({ acquired: false, returnCode: -1 });
    try {
      const result = await service.runSweep();
      assert.equal(result.skipped, true);
      assert.equal(result.skipReason, 'distributed_lock');
      assert.equal(events.some((e) => e.event === 'job_started'), false);
      assert.equal(events.some((e) => e.event === 'job_skipped_distributed_lock'), true);
    } finally {
      console.log = original;
    }
  });
});

test('shutdown interrumpe sin job_finished SUCCESS', async () => {
  await withRetentionConfig({}, async () => {
    const events = [];
    const original = console.log;
    console.log = (...args) => {
      for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('{')) {
          try {
            events.push(JSON.parse(arg));
          } catch { /* ignore */ }
        }
      }
      original.apply(console, args);
    };
    let calls = 0;
    const { resetShutdownCoordinatorForTests, setShuttingDownForTests } = await import('../process/shutdown-coordinator.js');
    const service = new ConversationRetentionService({
      dbEnabled: () => true,
      acquireLock: async () => ({ acquired: true, returnCode: 0 }),
      releaseLock: async () => {},
      verifyLock: async () => true,
      runTransaction: async (fn) => fn(null),
      mediaService: { deleteStoredObjects: async () => ({ deleted: 1, failed: 0 }) },
      attachmentRepo: { listStoredKeysByConversationIds: async () => [] },
      runtimeSession: {
        resetSessionForDeletedConversation: async () => ({ action: 'no_session' }),
      },
      conversationRepo: {
        deleteInactiveRetentionBatch: async () => {
          calls += 1;
          if (calls === 1) {
            setShuttingDownForTests(true);
            return {
              rows: [{ id: 'c-shutdown', externalUserId: 'user-shutdown' }],
              storageKeys: [],
              deliveryStatusDeleted: 0,
            };
          }
          return { rows: [], storageKeys: [], deliveryStatusDeleted: 0 };
        },
      },
    });
    try {
      const result = await service.runSweep();
      assert.equal(result.interrupted, true);
      assert.equal(result.conversationsDeleted, 1);
      assert.equal(events.some((e) => e.event === 'job_stopped_shutdown'), true);
      assert.equal(events.some((e) => e.event === 'job_finished'), false);
    } finally {
      console.log = original;
      resetShutdownCoordinatorForTests();
    }
  });
});

test('limpia runtime solo si la sesión coincide con la conversación eliminada', async () => {
  await withRetentionConfig({}, async () => {
    const calls = { reset: 0, skip: 0 };
    const service = new ConversationRetentionService({
      dbEnabled: () => true,
      acquireLock: async () => ({ acquired: true }),
      releaseLock: async () => {},
      verifyLock: async () => true,
      runTransaction: async (fn) => fn(null),
      mediaService: { deleteStoredObjects: async () => ({ deleted: 0, failed: 0 }) },
      attachmentRepo: { listStoredKeysByConversationIds: async () => [] },
      conversationRepo: (() => {
        let deletedOnce = false;
        return {
          deleteInactiveRetentionBatch: async () => {
            if (deletedOnce) return { rows: [], storageKeys: [] };
            deletedOnce = true;
            return {
              rows: [{ id: 'deleted-1', externalUserId: 'wa:user-1', channel: 'whatsapp' }],
              storageKeys: [],
            };
          },
          findByChannelAndExternalUserId: async () => ({ id: 'new-2' }),
        };
      })(),
      runtimeSession: {
        resetSessionForDeletedConversation: async (_userId, deletedId) => {
          if (String(deletedId) === 'deleted-1') {
            calls.skip += 1;
            return { action: 'skipped_bound_to_other_conversation' };
          }
          calls.reset += 1;
          return { action: 'reset' };
        },
      },
    });

    sessionService.sessions['wa:user-1'] = {
      flowId: 'main-menu',
      currentNode: 'welcome',
      conversationId: 'new-2',
    };

    const result = await service.runSweep();
    assert.equal(result.conversationsDeleted, 1);
    assert.equal(result.runtimeCleanupSkipped, 1);
    assert.equal(calls.reset, 0);
    assert.ok(sessionService.sessions['wa:user-1']);
  });
});
