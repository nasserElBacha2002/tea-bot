import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import { processCanonicalTwilioInbound } from './twilio-inbound-pipeline.js';
import { settleTwilioInbound } from '../controllers/twilio-webhook.controller.js';
import flowEngine from './flow-engine.service.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaFetchService from './inbound-media-fetch.service.js';

async function dbUnavailable() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const columns = await query(
    `SELECT
       OBJECT_ID(N'dbo.conversation_message_attachments', N'U') AS attachments_table,
       COL_LENGTH(N'dbo.conversation_message_attachments', N'source_url') AS source_url`,
  );
  const row = columns.rows[0] || {};
  if (row.attachments_table == null) return 'conversation_message_attachments missing (run migration 011)';
  if (row.source_url == null) return 'conversation_message_attachments.source_url missing (run migration 012)';
  return null;
}

async function deleteEvent(messageId) {
  await query(
    'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [messageId],
  );
}

async function deleteConversationByMessage(messageId) {
  const existing = await conversationMessageRepository.findByProviderMessageId('twilio', messageId);
  if (!existing) return;
  const conversationId = existing.conversationId;
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

function mediaBody(messageId, from, mediaItems, text = '') {
  const body = {
    MessageSid: messageId,
    From: `whatsapp:${from}`,
    Body: text,
    NumMedia: String(mediaItems.length),
  };
  mediaItems.forEach((item, index) => {
    body[`MediaUrl${index}`] = item.url;
    body[`MediaContentType${index}`] = item.contentType;
    if (item.fileName) body[`MediaFilename${index}`] = item.fileName;
  });
  return body;
}

test('DIN-439 texto con adjunto ejecuta el motor y persiste dos adjuntos', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const messageId = `SM-D439-${randomUUID()}`;
  const from = `+54911${String(Date.now()).slice(-8)}`;
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-d439-'));
  const previous = {
    enabled: config.inboundMediaEnabled,
    storageDir: config.inboundMediaStorageDir,
    sid: config.twilioAccountSid,
    token: config.twilioAuthToken,
  };
  config.inboundMediaEnabled = true;
  config.inboundMediaStorageDir = storageDir;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  t.after(async () => {
    await deleteEvent(messageId);
    await deleteConversationByMessage(messageId);
    config.inboundMediaEnabled = previous.enabled;
    config.inboundMediaStorageDir = previous.storageDir;
    config.twilioAccountSid = previous.sid;
    config.twilioAuthToken = previous.token;
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    body: { async *[Symbol.asyncIterator]() { yield png; } },
  });
  const previousResolve = flowEngine.resolveIncomingMessage;
  let engineCalls = 0;
  flowEngine.resolveIncomingMessage = async () => {
    engineCalls += 1;
    return { reply: 'respuesta bot', flowId: 'main-menu', currentNodeId: 'welcome' };
  };

  try {
    const settled = await settleTwilioInbound({
      flowId: 'main-menu',
      body: mediaBody(messageId, from, [
        { url: 'https://api.twilio.com/media/png-1', contentType: 'image/png', fileName: 'a.png' },
        { url: 'https://api.twilio.com/media/png-2', contentType: 'image/png', fileName: 'b.png' },
      ], 'caption del archivo'),
    });
    await inboundMediaFetchService.drain();
    assert.equal(settled.httpStatus, 200);
    assert.equal(engineCalls, 1);
    const message = await conversationMessageRepository.findByProviderMessageId('twilio', messageId);
    assert.ok(message);
    assert.equal(message.body, 'caption del archivo');
    const attachments = await attachmentRepository.findByMessageId(message.id);
    assert.equal(attachments.length, 2);
    assert.equal(attachments.every((row) => row.status === 'stored'), true);
  } finally {
    global.fetch = originalFetch;
    flowEngine.resolveIncomingMessage = previousResolve;
  }
});

test('DIN-439 solo imagen no ejecuta el motor y persiste una fila', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = `SM-D439-IMG-${randomUUID()}`;
  const from = `+54911${String(Date.now()).slice(-8)}`;
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-d439-'));
  const previous = {
    enabled: config.inboundMediaEnabled,
    storageDir: config.inboundMediaStorageDir,
    sid: config.twilioAccountSid,
    token: config.twilioAuthToken,
  };
  config.inboundMediaEnabled = true;
  config.inboundMediaStorageDir = storageDir;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  t.after(async () => {
    await deleteEvent(messageId);
    await deleteConversationByMessage(messageId);
    config.inboundMediaEnabled = previous.enabled;
    config.inboundMediaStorageDir = previous.storageDir;
    config.twilioAccountSid = previous.sid;
    config.twilioAuthToken = previous.token;
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    body: { async *[Symbol.asyncIterator]() { yield Buffer.from([0xff, 0xd8, 0xff, 0xd9]); } },
  });
  const previousResolve = flowEngine.resolveIncomingMessage;
  let engineCalls = 0;
  flowEngine.resolveIncomingMessage = async () => {
    engineCalls += 1;
    return { reply: 'no', flowId: 'main-menu', currentNodeId: 'fallback' };
  };
  try {
    const result = await processCanonicalTwilioInbound({
      provider: 'twilio',
      flowId: 'main-menu',
      userId: `twilio:whatsapp:${from}`,
      phone: from,
      text: '',
      messageId,
      media: [{ index: 0, url: 'https://api.twilio.com/media/jpg', contentType: 'image/jpeg', fileName: 'foto.jpg' }],
      rawPayload: {},
    });
    await inboundMediaFetchService.drain();
    assert.equal(result.kind, 'human_mode_skip');
    assert.equal(engineCalls, 0);
    const message = await conversationMessageRepository.findByProviderMessageId('twilio', messageId);
    assert.ok(message);
    assert.equal(message.body, '');
    const attachments = await attachmentRepository.findByMessageId(message.id);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].status, 'stored');
  } finally {
    global.fetch = originalFetch;
    flowEngine.resolveIncomingMessage = previousResolve;
  }
});

test('DIN-439 webhook duplicado no duplica adjuntos', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = `SM-D439-DUP-${randomUUID()}`;
  const from = `+54911${String(Date.now()).slice(-8)}`;
  config.inboundMediaEnabled = true;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  t.after(async () => {
    await deleteEvent(messageId);
    await deleteConversationByMessage(messageId);
  });
  const previousFetch = global.fetch;
  let downloads = 0;
  global.fetch = async () => {
    downloads += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/pdf' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from('%PDF-1.4'); } },
    };
  };
  const previousResolve = flowEngine.resolveIncomingMessage;
  flowEngine.resolveIncomingMessage = async () => ({ reply: null, flowId: 'main-menu', currentNodeId: 'welcome' });
  try {
    await settleTwilioInbound({
      flowId: 'main-menu',
      body: mediaBody(messageId, from, [
        { url: 'https://api.twilio.com/media/pdf', contentType: 'application/pdf', fileName: 'doc.pdf' },
      ]),
    });
    await inboundMediaFetchService.drain();
    await settleTwilioInbound({
      flowId: 'main-menu',
      body: mediaBody(messageId, from, [
        { url: 'https://api.twilio.com/media/pdf', contentType: 'application/pdf', fileName: 'doc.pdf' },
      ]),
    });
    await inboundMediaFetchService.drain();
    const message = await conversationMessageRepository.findByProviderMessageId('twilio', messageId);
    const attachments = await attachmentRepository.findByMessageId(message.id);
    assert.equal(attachments.length, 1);
    assert.equal(downloads, 1);
  } finally {
    global.fetch = previousFetch;
    flowEngine.resolveIncomingMessage = previousResolve;
  }
});