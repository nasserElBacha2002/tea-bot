import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, withTransaction } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import { computeRetentionCutoff } from '../utils/conversation-retention.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('estados assigned/waiting_human no eximen vencimiento por inactividad', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const staleAt = new Date('2000-01-01T00:00:00.000Z');
  const cutoff = computeRetentionCutoff(new Date('2000-02-01T12:00:00.000Z'), 30);

  const assigned = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-${suffix}-assigned`,
    status: 'assigned',
    currentFlowId: 'main-menu',
  });
  const waiting = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-${suffix}-waiting`,
    status: 'waiting_human',
    currentFlowId: 'main-menu',
  });
  const recent = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-${suffix}-recent`,
    status: 'assigned',
    currentFlowId: 'main-menu',
  });

  await conversationRepository.updateConversation(assigned.id, { lastMessageAt: staleAt });
  await conversationRepository.updateConversation(waiting.id, { lastMessageAt: staleAt });
  await conversationRepository.updateConversation(recent.id, { lastMessageAt: new Date('2000-02-01T00:00:00.000Z') });

  try {
    const batch = await withTransaction((transaction) =>
      conversationRepository.deleteInactiveRetentionBatch(cutoff, {
        limit: 50,
        transaction,
      }),
    );
    const deleted = new Set(batch.rows.map((row) => String(row.id).toLowerCase()));
    assert.equal(deleted.has(String(assigned.id).toLowerCase()), true);
    assert.equal(deleted.has(String(waiting.id).toLowerCase()), true);
    assert.equal(deleted.has(String(recent.id).toLowerCase()), false);
  } finally {
    await conversationRepository.deleteByIds([assigned.id, waiting.id, recent.id].filter(Boolean));
  }
});