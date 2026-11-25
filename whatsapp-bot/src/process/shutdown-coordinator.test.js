import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationRetentionService } from '../services/conversationRetention.service.js';
import { config } from '../config.js';

test('stop espera sweep activo', async () => {
  const previousEnabled = config.conversationRetentionEnabled;
  config.conversationRetentionEnabled = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = new ConversationRetentionService({
    dbEnabled: () => true,
    acquireLock: async () => {
      await blocked;
      return { acquired: true, returnCode: 0 };
    },
    releaseLock: async () => {},
    runTransaction: async (fn) => fn(null),
    conversationRepo: {
      deleteInactiveRetentionBatch: async () => ({ rows: [], storageKeys: [] }),
    },
    mediaService: { deleteStoredObjects: async () => ({ deleted: 0, failed: 0 }) },
    attachmentRepo: { listStoredKeysByConversationIds: async () => [] },
    runtimeSession: {
      resetSessionForDeletedConversation: async () => ({ action: 'no_session' }),
    },
  });

  const sweepPromise = service.runSweep();
  assert.equal(service.running, true);
  const stopPromise = service.stop();
  let stopDone = false;
  stopPromise.then(() => { stopDone = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stopDone, false);
  release();
  await sweepPromise;
  await stopPromise;
  assert.equal(stopDone, true);
  assert.equal(service.running, false);
  config.conversationRetentionEnabled = previousEnabled;
});

test('stop libera timer y marca servicio detenido', async () => {
  const service = new ConversationRetentionService({
    dbEnabled: () => true,
    acquireLock: async () => ({ acquired: true }),
    releaseLock: async () => {},
    runTransaction: async (fn) => fn(null),
    conversationRepo: {
      deleteInactiveRetentionBatch: async () => ({ rows: [], storageKeys: [] }),
    },
    mediaService: { deleteStoredObjects: async () => ({ deleted: 0, failed: 0 }) },
    attachmentRepo: { listStoredKeysByConversationIds: async () => [] },
    runtimeSession: {
      resetSessionForDeletedConversation: async () => ({ action: 'no_session' }),
    },
  });

  service.timer = setInterval(() => {}, 60_000);
  await service.stop();
  assert.equal(service.timer, null);
  assert.equal(service.stopped, true);
});