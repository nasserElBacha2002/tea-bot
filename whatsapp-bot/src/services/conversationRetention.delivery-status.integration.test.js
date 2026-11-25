import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query, withTransaction } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('retención elimina message_delivery_status ligado al mensaje', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const providerMessageId = `SM_RET_${suffix}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
  });
  await conversationRepository.updateConversation(conversation.id, {
    lastMessageAt: new Date('2000-01-01T00:00:00.000Z'),
  });
  const providerMessageId2 = `SM_RET2_${suffix}`;
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'hola',
    provider: 'twilio',
    providerMessageId,
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'hola2',
    provider: 'twilio',
    providerMessageId: providerMessageId2,
  });
  await query(
    `INSERT INTO dbo.message_delivery_status (
      provider, provider_message_id, status
    ) VALUES (N'twilio', $1, N'delivered')`,
    [providerMessageId],
  );
  await query(
    `INSERT INTO dbo.message_delivery_status (
      provider, provider_message_id, status
    ) VALUES (N'twilio', $1, N'read')`,
    [providerMessageId2],
  );

  try {
    const batch = await withTransaction((transaction) =>
      conversationRepository.deleteInactiveRetentionBatch(
        new Date('2000-02-01T00:00:00.000Z'),
        { limit: 10, transaction },
      ),
    );
    assert.equal(batch.rows.some((row) => row.id === conversation.id), true);
    assert.equal(batch.deliveryStatusDeleted, 2);

    const delivery = await query(
      `SELECT COUNT(*) AS total FROM dbo.message_delivery_status
       WHERE provider = N'twilio' AND provider_message_id = $1`,
      [providerMessageId],
    );
    assert.equal(Number(delivery.rows[0]?.total || 0), 0);
  } finally {
    await query(
      `DELETE FROM dbo.message_delivery_status WHERE provider_message_id IN ($1, $2)`,
      [providerMessageId, providerMessageId2],
    );
    await conversationRepository.deleteByIds([conversation.id]);
  }
});