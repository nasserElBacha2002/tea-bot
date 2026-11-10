import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationClassificationRepository from '../repositories/conversation-classification.repository.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import auditLogService from './audit-log.service.js';

const integrationEnabled = isConversationDbEnabled();

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!integrationEnabled) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

async function createAgedConversation({ suffix, lastMessageAt, withDeps = false }) {
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `RET-${suffix}`,
    phoneNumber: null,
    displayName: `Retention ${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: withDeps ? 'welcome' : null,
  });

  await conversationRepository.updateConversation(conversation.id, { lastMessageAt });

  if (withDeps) {
    await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'user',
      body: 'hola',
      provider: 'internal',
    });
    await conversationSessionRepository.createSession({
      conversationId: conversation.id,
      flowId: 'main-menu',
      currentNodeKey: 'welcome',
    });
    await humanHandoffRepository.createHandoff({
      conversationId: conversation.id,
      requestedBy: 'bot',
      reason: 'test',
      status: 'resolved',
    });
    await conversationClassificationRepository.insertClassification({
      conversationId: conversation.id,
      classifierVersion: 'test',
      primaryQuery: 'inscripciones',
      modality: null,
      programType: null,
      programName: null,
      specificReason: null,
      responsibleArea: null,
      source: 'fallback',
      confidence: 0,
      matchedRule: null,
      matchedNode: null,
      flowId: 'main-menu',
      flowVersion: 'v1',
    });
    await conversationSheetExportRepository.upsertExport({
      conversationId: conversation.id,
      sheetTabName: 'Conversaciones',
      exportStatus: 'exported',
      finalStatus: 'bot',
      idempotencyKey: `ret-${suffix}`,
    });
    await auditLogService.record({
      entityType: 'conversation',
      entityId: conversation.id,
      action: 'conversation.retention_fixture',
      metadata: { reason: 'integration_test' },
    });
  }

  return conversation;
}

async function countByConversation(conversationId) {
  const tables = {
    messages: 'dbo.conversation_messages',
    sessions: 'dbo.conversation_sessions',
    handoffs: 'dbo.human_handoffs',
    classifications: 'dbo.conversation_classifications',
    sheetExports: 'dbo.conversation_sheet_exports',
  };
  const counts = {};
  for (const [key, table] of Object.entries(tables)) {
    const result = await query(
      `SELECT COUNT(*) AS total FROM ${table} WHERE conversation_id = $1`,
      [conversationId],
    );
    counts[key] = Number(result.rows[0]?.total ?? 0);
  }
  const audits = await query(
    `SELECT COUNT(*) AS total FROM dbo.audit_logs
     WHERE entity_type = N'conversation' AND entity_id = $1`,
    [String(conversationId)],
  );
  counts.auditLogs = Number(audits.rows[0]?.total ?? 0);
  return counts;
}

test('schema real: índice last_message_at y cascades de retención', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }

  const index = await query(
    `SELECT 1 AS ok FROM sys.indexes
     WHERE name = N'idx_conversations_last_message_at'
       AND object_id = OBJECT_ID(N'dbo.conversations')`,
  );
  assert.equal(Number(index.rows.length), 1);

  const cutoff = new Date('2000-01-15T00:00:00.000Z');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const stale = await createAgedConversation({
    suffix: `${suffix}-stale`,
    lastMessageAt: new Date('2000-01-01T00:00:00.000Z'),
    withDeps: true,
  });
  const fresh = await createAgedConversation({
    suffix: `${suffix}-fresh`,
    lastMessageAt: new Date('2000-02-01T00:00:00.000Z'),
  });
  const exact = await createAgedConversation({
    suffix: `${suffix}-exact`,
    lastMessageAt: cutoff,
  });
  const raced = await createAgedConversation({
    suffix: `${suffix}-raced`,
    lastMessageAt: new Date('2000-01-01T00:00:00.000Z'),
  });

  const depsBefore = await countByConversation(stale.id);
  assert.equal(depsBefore.messages >= 1, true);
  assert.equal(depsBefore.sessions >= 1, true);
  assert.equal(depsBefore.handoffs >= 1, true);
  assert.equal(depsBefore.classifications >= 1, true);
  assert.equal(depsBefore.sheetExports >= 1, true);
  assert.equal(depsBefore.auditLogs >= 1, true);

  try {
    await conversationRepository.updateConversation(raced.id, { lastMessageAt: new Date() });

    const deleted = await conversationRepository.deleteInactiveBatchBefore(cutoff, { limit: 500 });
    const deletedIds = new Set(deleted.map((row) => String(row.id).toLowerCase()));
    assert.equal(deletedIds.has(String(stale.id).toLowerCase()), true);
    assert.equal(deletedIds.has(String(fresh.id).toLowerCase()), false);
    assert.equal(deletedIds.has(String(exact.id).toLowerCase()), false);
    assert.equal(deletedIds.has(String(raced.id).toLowerCase()), false);

    assert.equal(await conversationRepository.findById(stale.id), null);
    assert.ok(await conversationRepository.findById(fresh.id));
    assert.ok(await conversationRepository.findById(exact.id));
    assert.ok(await conversationRepository.findById(raced.id));

    const depsAfter = await countByConversation(stale.id);
    assert.deepEqual(
      {
        messages: depsAfter.messages,
        sessions: depsAfter.sessions,
        handoffs: depsAfter.handoffs,
        classifications: depsAfter.classifications,
        sheetExports: depsAfter.sheetExports,
      },
      {
        messages: 0,
        sessions: 0,
        handoffs: 0,
        classifications: 0,
        sheetExports: 0,
      },
    );
    assert.equal(depsAfter.auditLogs >= 1, true);

    const second = await conversationRepository.deleteInactiveBatchBefore(cutoff, { limit: 500 });
    const secondIds = new Set(second.map((row) => String(row.id).toLowerCase()));
    assert.equal(secondIds.has(String(stale.id).toLowerCase()), false);
    assert.ok(await conversationRepository.findById(fresh.id));
    assert.ok(await conversationRepository.findById(exact.id));
    assert.ok(await conversationRepository.findById(raced.id));
  } finally {
    for (const conversation of [fresh, exact, stale, raced]) {
      try {
        await conversationRepository.deleteByIds([conversation.id]);
      } catch {
        /* already deleted or missing */
      }
    }
  }
});
