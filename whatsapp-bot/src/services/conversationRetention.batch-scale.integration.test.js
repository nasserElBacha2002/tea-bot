import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('retención SQL elimina 120 conversaciones sintéticas en batches de 50', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const cutoff = new Date('1999-06-01T00:00:00.000Z');
  const prefix = `RET-BATCH-${suffix}`;
  const ids = [];

  const existingStale = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.conversations
     WHERE (last_message_at IS NOT NULL AND last_message_at < $1)
        OR (last_message_at IS NULL AND started_at < $1)`,
    [cutoff],
  );
  if (Number(existingStale.rows[0]?.total || 0) > 0) {
    t.skip('BLOCKED: conversaciones vencidas ajenas a fixtures en la base');
    return;
  }

  const pre = await query(
    `SELECT COUNT(*) AS total FROM dbo.conversations
     WHERE external_user_id LIKE $1`,
    [`${prefix}%`],
  );
  assert.equal(Number(pre.rows[0]?.total || 0), 0);

  const startedAt = Date.now();
  try {
    for (let i = 0; i < 120; i += 1) {
      const conversation = await conversationRepository.createConversation({
        channel: 'simulator',
        provider: 'internal',
        externalUserId: `${prefix}-${i}`,
        status: 'bot',
        currentFlowId: 'main-menu',
      });
      ids.push(conversation.id);
      await conversationRepository.updateConversation(conversation.id, {
        lastMessageAt: new Date('1999-01-01T00:00:00.000Z'),
      });
    }

    let totalDeleted = 0;
    let batches = 0;
    const deletedOnce = new Set();
    while (batches < 10) {
      const rows = await conversationRepository.deleteInactiveBatchBefore(cutoff, { limit: 50 });
      batches += 1;
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = String(row.id).toLowerCase();
        assert.equal(deletedOnce.has(id), false);
        deletedOnce.add(id);
      }
      totalDeleted += rows.length;
    }
    const elapsedMs = Date.now() - startedAt;
    assert.equal(totalDeleted, 120);
    assert.equal(batches, 4);
    assert.equal(deletedOnce.size, 120);

    const second = await conversationRepository.deleteInactiveBatchBefore(cutoff, { limit: 50 });
    assert.equal(second.length, 0);
    assert.ok(elapsedMs >= 0);
  } finally {
    for (const id of ids) {
      await conversationRepository.deleteByIds([id]).catch(() => {});
    }
  }
});