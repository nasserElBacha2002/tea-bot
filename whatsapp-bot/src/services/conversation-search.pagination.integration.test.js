import '../db/test-env-bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { testEnvBootstrapStatus } from '../db/test-env-bootstrap.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSearchService from './conversation-search.service.js';

const MARKER = 'DIN440PG';
const SEARCH_Q = MARKER.toLowerCase();

async function dbUnavailable() {
  const env = testEnvBootstrapStatus();
  if (!env.hasUser || !env.hasPassword) return 'DB_ENV_MISSING: DB_USER, DB_PASSWORD';
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

async function deleteConversation(conversationId) {
  if (!conversationId) return;
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

async function insertMessage(conversationId, body, createdAt) {
  await query(
    `INSERT INTO dbo.conversation_messages (
      conversation_id, direction, sender_type, body, provider, created_at
    ) VALUES ($1, N'inbound', N'user', $2, N'twilio', $3)`,
    [conversationId, body, createdAt],
  );
}

test('paginación contactos y mensajes sin huecos ni duplicados', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const created = [];
  t.after(async () => {
    for (const id of created) {
      await deleteConversation(id);
    }
  });

  const base = Date.now();
  for (let i = 0; i < 5; i += 1) {
    const conv = await conversationRepository.createConversation({
      channel: 'whatsapp',
      provider: 'twilio',
      externalUserId: `din440-${randomUUID()}`,
      phoneNumber: `+5491199${String(10000 + i).slice(-5)}`,
      displayName: `${MARKER}-Contact-${i}`,
    });
    created.push(conv.id);
    const ts = new Date(base - i * 1000);
    await query(
      `UPDATE dbo.conversations SET last_message_at = $2 WHERE id = $1`,
      [conv.id, ts],
    );
    await insertMessage(conv.id, `mensaje ${MARKER} numero ${i}`, ts);
  }

  const limit = 2;
  const allContactIds = [];
  let contactCursor = null;
  for (let page = 0; page < 10; page += 1) {
    const data = await conversationSearchService.searchGlobal({
      q: SEARCH_Q,
      limit,
      cursorContact: contactCursor,
      cursorMessage: null,
    });
    const ids = data.contacts.items.map((c) => c.conversationId);
    for (const id of ids) {
      assert.ok(!allContactIds.includes(id), `contacto duplicado en página ${page}`);
      allContactIds.push(id);
    }
    if (!data.contacts.nextCursor) break;
    contactCursor = data.contacts.nextCursor;
  }
  assert.equal(allContactIds.length, 5, 'debe listar los 5 contactos de fixture');

  const allMessageIds = [];
  let messageCursor = null;
  for (let page = 0; page < 10; page += 1) {
    const data = await conversationSearchService.searchGlobal({
      q: SEARCH_Q,
      limit,
      cursorContact: null,
      cursorMessage: messageCursor,
    });
    const ids = data.messages.items.map((m) => m.messageId);
    for (const id of ids) {
      assert.ok(!allMessageIds.includes(id), `mensaje duplicado en página ${page}`);
      allMessageIds.push(id);
    }
    if (!data.messages.nextCursor) break;
    messageCursor = data.messages.nextCursor;
  }
  assert.equal(allMessageIds.length, 5, 'debe listar los 5 mensajes de fixture');
});