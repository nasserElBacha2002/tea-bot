import http from 'node:http';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../create-app.js';
import { closePool, isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import { createSignedSessionToken } from './admin-auth.service.js';
import { config } from '../config.js';
import { writeInboundMediaObject } from '../utils/inbound-media-storage.js';
import { ROLES } from '../auth/roles.js';

const OPERATOR_USER = 'tb-att-operator';

async function skipReason() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const { rows } = await query(
    `SELECT OBJECT_ID(N'dbo.conversation_message_attachments', N'U') AS attachments_table`,
  );
  if (!rows[0]?.attachments_table) return 'Migration 011 is not applied on the test database';
  return null;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(server, { method = 'GET', path: reqPath, cookie, body }) {
  const payload = body == null ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: reqPath,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body != null
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: res.headers['content-type']?.includes('application/json')
              ? JSON.parse(raw.toString('utf8') || 'null')
              : raw,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookie(username, role = ROLES.ADMIN) {
  const token = createSignedSessionToken(username, config.sessionSecret, role);
  return `tea_session=${token}`;
}

async function createConversationWithAttachment() {
  const conv = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    phoneNumber: `+54911${Date.now().toString().slice(-7)}`,
    externalUserId: `wa-att-${Date.now()}`,
    status: 'waiting_human',
  });

  const message = await conversationMessageRepository.createMessage({
    conversationId: conv.id,
    direction: 'inbound',
    senderType: 'user',
    body: 'con foto',
    provider: 'twilio',
    providerMessageId: `SM-att-${Date.now()}`,
    metadataJson: {},
  });

  const pending = await attachmentRepository.upsertPending({
    messageId: message.id,
    conversationId: conv.id,
    ordinal: 0,
    providerMediaIndex: 0,
    mimeType: 'image/png',
    originalName: 'captura.png',
    sourceUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME1',
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-att-http-'));
  const prevDir = config.inboundMediaStorageDir;
  config.inboundMediaStorageDir = tmp;
  const storageKey = 'cd'.repeat(32);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  await writeInboundMediaObject(tmp, storageKey, png);

  await query(
    `UPDATE dbo.conversation_message_attachments
     SET status = N'stored',
         storage_key = $2,
         byte_size = $3,
         mime_type = N'image/png',
         failure_reason = NULL
     WHERE id = $1`,
    [pending.id, storageKey, png.length],
  );

  return {
    conv,
    message,
    attachmentId: pending.id,
    cleanup: async () => {
      config.inboundMediaStorageDir = prevDir;
      await fs.rm(tmp, { recursive: true, force: true });
      await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conv.id]);
      await query('DELETE FROM dbo.conversations WHERE id = $1', [conv.id]);
    },
  };
}

test('DIN-439 fase 2 API attachments — auth y descarga', { timeout: 120_000 }, async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const app = createApp();
  const server = await listen(app);
  t.after(async () => {
    await closeServer(server);
    await closePool();
  });

  const { conv, message, attachmentId, cleanup } = await createConversationWithAttachment();
  t.after(cleanup);

  const contentPath =
    `/api/conversations/${conv.id}/messages/${message.id}/attachments/${attachmentId}/content`;

  const anonList = await request(server, {
    path: `/api/conversations/${conv.id}/messages`,
  });
  assert.equal(anonList.status, 401);

  const cookie = sessionCookie(OPERATOR_USER, ROLES.CONVERSATIONS_ONLY);
  const list = await request(server, { path: `/api/conversations/${conv.id}/messages`, cookie });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const item = list.body?.data?.items?.find((row) => row.id === message.id);
  assert.ok(item);
  assert.equal(item.attachments?.length, 1);
  assert.equal(item.attachments[0].mimeType, 'image/png');
  assert.equal(item.attachments[0].status, 'stored');
  assert.equal('storageKey' in (item.attachments[0] || {}), false);

  const download = await request(server, { path: contentPath, cookie });
  assert.equal(download.status, 200);
  assert.match(String(download.headers['content-type']), /image\/png/);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.ok(Buffer.isBuffer(download.body));

  const wrongConv = await request(server, {
    path: `/api/conversations/${'00000000-0000-0000-0000-000000000099'}/messages/${message.id}/attachments/${attachmentId}/content`,
    cookie,
  });
  assert.equal(wrongConv.status, 404);

  await query(
    `UPDATE dbo.conversation_message_attachments SET status = N'pending', storage_key = NULL WHERE id = $1`,
    [attachmentId],
  );
  const pending = await request(server, { path: contentPath, cookie });
  assert.equal(pending.status, 404);
});