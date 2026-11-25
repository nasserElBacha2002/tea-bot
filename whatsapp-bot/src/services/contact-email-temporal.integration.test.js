import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import { saveContactEmailForConversation } from './contact-email.service.js';

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('precedencia temporal — evento más reciente gana aunque se procese después', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const phone = `+549${Date.now()}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `email-precedence-${Date.now()}`,
    phoneNumber: phone,
    displayName: 'Precedence',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  const older = new Date('2024-01-01T10:00:00.000Z');
  const newer = new Date('2024-06-01T10:00:00.000Z');

  await saveContactEmailForConversation(conversation, 'new@example.com', { sourceEventAt: newer });
  await saveContactEmailForConversation(conversation, 'old@example.com', { sourceEventAt: older });

  const row = await conversationRepository.findById(conversation.id);
  assert.equal(row.contactEmail, 'new@example.com');

  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversation.id]);
});

test('mismo email en t3 luego B retrasado t2 deja A vigente', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const phone = `+549${Date.now()}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `email-order-${Date.now()}`,
    phoneNumber: phone,
    displayName: 'Order',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  const t1 = new Date('2024-01-01T10:00:00.000Z');
  const t2 = new Date('2024-01-02T10:00:00.000Z');
  const t3 = new Date('2024-06-01T10:00:00.000Z');

  await saveContactEmailForConversation(conversation, 'a@example.com', { sourceEventAt: t1 });
  await saveContactEmailForConversation(conversation, 'a@example.com', { sourceEventAt: t3 });
  await saveContactEmailForConversation(conversation, 'b@example.com', { sourceEventAt: t2 });

  const row = await conversationRepository.findById(conversation.id);
  assert.equal(row.contactEmail, 'a@example.com');

  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversation.id]);
});