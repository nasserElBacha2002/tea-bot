import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase, query, withTransaction } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import { ConversationRetentionService } from './conversationRetention.service.js';
import { ackPendingStorageDelete } from '../repositories/retention-pending-storage.repository.js';
import {
  absoluteStoragePath,
  resolveInboundMediaRoot,
  verifyInboundMediaObject,
  writeInboundMediaObject,
} from '../utils/inbound-media-storage.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('cola durable recupera borrado físico tras reinicio de servicio', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const storageKey = createHash('sha256').update(`ret-media-${suffix}`).digest('hex');
  const root = resolveInboundMediaRoot();
  const absolute = absoluteStoragePath(root, storageKey);
  const buffer = Buffer.from(`retention-media-${suffix}`);

  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-MEDIA-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
  });
  await conversationRepository.updateConversation(conversation.id, {
    lastMessageAt: new Date('2000-01-01T00:00:00.000Z'),
  });
  const message = await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    body: 'media',
    provider: 'internal',
  });
  const pending = await attachmentRepository.upsertPending({
    messageId: message.id,
    conversationId: conversation.id,
    ordinal: 0,
    providerMediaIndex: 0,
    mimeType: 'image/jpeg',
    originalName: 'foto.jpg',
  });
  await query(
    `UPDATE dbo.conversation_message_attachments
     SET status = N'stored', storage_key = $2, byte_size = $3
     WHERE id = $1`,
    [pending.id, storageKey, buffer.length],
  );
  await writeInboundMediaObject(root, storageKey, buffer);
  assert.equal(await verifyInboundMediaObject(root, storageKey), true);

  try {
    const keysBeforeDelete = await attachmentRepository.listStoredKeysByConversationIds([conversation.id]);
    assert.deepEqual(keysBeforeDelete, [storageKey]);

    const cutoff = new Date('2000-02-01T00:00:00.000Z');
    const batch = await withTransaction((transaction) =>
      conversationRepository.deleteInactiveRetentionBatch(cutoff, {
        limit: 10,
        transaction,
        attachmentRepo: attachmentRepository,
      }),
    );
    assert.equal(batch.rows.length, 1);
    assert.deepEqual(batch.storageKeys, [storageKey]);

    assert.equal(await conversationRepository.findById(conversation.id), null);
    const pendingRows = await query(
      `SELECT COUNT(*) AS total FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1`,
      [storageKey],
    );
    assert.equal(Number(pendingRows.rows[0]?.total || 0), 1);
    assert.equal(await verifyInboundMediaObject(root, storageKey), true);

    const recovery = new ConversationRetentionService({
      acquireLock: async () => ({ acquired: true }),
      releaseLock: async () => {},
      verifyLock: async () => true,
    });
    assert.equal(recovery.pendingMediaDeletes.size, 0);
    await recovery._hydratePendingMediaFromStore();
    assert.equal(recovery.pendingMediaDeletes.has(storageKey), true);
    const flush = await recovery._flushPendingMediaDeletes();
    assert.equal(flush.deleted, 1);
    const cleared = await query(
      `SELECT COUNT(*) AS total FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1`,
      [storageKey],
    );
    assert.equal(Number(cleared.rows[0]?.total || 0), 0);
    await assert.rejects(() => fs.stat(absolute), { code: 'ENOENT' });

    const secondFlush = await recovery._flushPendingMediaDeletes();
    assert.equal(secondFlush.deleted, 0);
    await ackPendingStorageDelete(storageKey).catch(() => {});
  } finally {
    await fs.unlink(absolute).catch(() => {});
    await query(
      `DELETE FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1`,
      [storageKey],
    );
    await query(
      `DELETE FROM dbo.message_delivery_status WHERE 1=0`,
    );
    await query(
      `DELETE FROM dbo.conversation_message_attachments
       WHERE conversation_id = $1 OR storage_key = $2`,
      [conversation.id, storageKey],
    ).catch(() => {});
    await conversationRepository.deleteByIds([conversation.id]).catch(() => {});
  }
});

test('clave inválida no hidrata ruta fuera del root', async (t) => {
  assert.equal(
    (await import('../repositories/retention-pending-storage.repository.js'))
      .isStorageKeyEligibleForDelete('..\\secret'),
    false,
  );
});