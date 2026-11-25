import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query, withTransaction } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import { countPendingStorageDeletes } from '../repositories/retention-pending-storage.repository.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('rollback preserva conversación y cola media tras enqueue', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const storageKey = `a1${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 32);
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-TX-${suffix}`,
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
    body: 'x',
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
     SET status = N'stored', storage_key = $2, byte_size = 1
     WHERE id = $1`,
    [pending.id, storageKey],
  );

  const pendingBefore = await countPendingStorageDeletes();
  try {
    await assert.rejects(async () => {
      await withTransaction(async (transaction) => {
        await conversationRepository.deleteInactiveRetentionBatch(new Date('2000-02-01T00:00:00.000Z'), {
          limit: 10,
          transaction,
          attachmentRepo: attachmentRepository,
        });
        throw new Error('force_rollback');
      });
    }, /force_rollback/);

    assert.ok(await conversationRepository.findById(conversation.id));
    const pendingAfter = await countPendingStorageDeletes();
    assert.equal(pendingAfter, pendingBefore);
  } finally {
    await query(`DELETE FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1`, [storageKey]);
    await query(`DELETE FROM dbo.conversation_message_attachments WHERE conversation_id = $1`, [conversation.id]);
    await conversationRepository.deleteByIds([conversation.id]);
  }
});

test('deleteInactiveRetentionBatch sin transacción falla', async () => {
  await assert.rejects(
    () => conversationRepository.deleteInactiveRetentionBatch(new Date(), { limit: 1 }),
    /requires an active transaction/,
  );
});