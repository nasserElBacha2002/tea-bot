import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaService, { downloadTwilioMedia } from './inbound-media.service.js';

function withMockedRepo(methods, fn) {
  const previous = {};
  for (const [key, impl] of Object.entries(methods)) {
    previous[key] = attachmentRepository[key];
    attachmentRepository[key] = impl;
  }
  return fn().finally(() => {
    for (const [key, impl] of Object.entries(previous)) {
      attachmentRepository[key] = impl;
    }
  });
}

test('downloadTwilioMedia respeta el tope de bytes', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(1024, 1);
        yield Buffer.alloc(1024, 2);
      },
    },
  });
  try {
    await assert.rejects(
      () => downloadTwilioMedia('https://api.twilio.com/media/x', {
        authHeader: 'Basic x',
        timeoutMs: 1000,
        maxBytes: 1500,
      }),
      /size_limit_exceeded/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('ensureInboundAttachmentRows no descarga en el webhook', async () => {
  let fetched = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetched += 1;
    throw new Error('no fetch in webhook');
  };
  config.inboundMediaEnabled = true;
  try {
    await withMockedRepo({
      findByMessageIdAndOrdinal: async () => null,
      upsertPending: async (data) => ({
        id: 'att-1',
        messageId: data.messageId,
        status: 'pending',
        sourceUrl: data.sourceUrl,
      }),
    }, async () => {
      const rows = await inboundMediaService.ensureInboundAttachmentRows({
        conversation: { id: 'conv-1' },
        message: { id: 'msg-1' },
        event: {
          media: [{
            index: 0,
            url: 'https://api.twilio.com/media/jpg',
            contentType: 'image/jpeg',
          }],
        },
      });
      assert.equal(rows[0].status, 'pending');
      assert.equal(fetched, 0);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('proceso almacena JPEG con validación de contenido', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-inbound-media-'));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    body: { async *[Symbol.asyncIterator]() { yield jpeg; } },
  });
  config.inboundMediaEnabled = true;
  config.inboundMediaStorageDir = dir;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  const row = {
    id: 'att-1',
    status: 'pending',
    retryCount: 0,
    mimeType: 'image/jpeg',
    sourceUrl: 'https://api.twilio.com/media/jpg',
  };
  try {
    await withMockedRepo({
      tryAcquireForDownload: async () => ({ ...row, status: 'downloading', retryCount: 1 }),
      markStored: async (_id, patch) => ({ ...row, status: 'stored', storageKey: patch.storageKey, mimeType: patch.mimeType }),
      findById: async () => row,
    }, async () => {
      const stored = await inboundMediaService.processAttachmentRow(row);
      assert.equal(stored.status, 'stored');
      const files = await fs.readdir(path.join(dir, stored.storageKey.slice(0, 2)));
      assert.ok(files.some((name) => name.endsWith('.jpg')));
    });
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MIME gif se rechaza al procesar', async () => {
  config.inboundMediaEnabled = true;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  const row = {
    id: 'att-bad',
    status: 'pending',
    retryCount: 0,
    mimeType: 'image/gif',
    sourceUrl: 'https://api.twilio.com/media/x',
  };
  await withMockedRepo({
    tryAcquireForDownload: async () => ({ ...row, status: 'downloading', retryCount: 1 }),
    markFailed: async (_id, reason) => ({ ...row, status: 'failed', failureReason: reason }),
    findById: async () => row,
  }, async () => {
    const failed = await inboundMediaService.processAttachmentRow(row);
    assert.equal(failed.failureReason, 'mime_not_allowed');
  });
});

test('HTTP 403 permanece failed sin retry útil', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, headers: { get: () => null }, body: null });
  config.inboundMediaEnabled = true;
  config.twilioAccountSid = 'AC_test';
  config.twilioAuthToken = 'secret';
  const row = {
    id: 'att-dl',
    status: 'pending',
    retryCount: 0,
    mimeType: 'image/png',
    sourceUrl: 'https://api.twilio.com/media/denied',
  };
  try {
    await withMockedRepo({
      tryAcquireForDownload: async () => ({ ...row, status: 'downloading', retryCount: 1 }),
      markFailed: async (_id, reason) => ({ ...row, status: 'failed', failureReason: reason }),
      findById: async () => row,
    }, async () => {
      const failed = await inboundMediaService.processAttachmentRow(row);
      assert.equal(failed.failureReason, 'download_http_403');
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('stored existente no vuelve a descargar', async () => {
  let fetched = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetched += 1;
    throw new Error('must not refetch');
  };
  config.inboundMediaEnabled = true;
  const row = {
    id: 'att-stored',
    status: 'stored',
    storageKey: 'abcd1234.jpg',
    retryCount: 1,
    sourceUrl: 'https://api.twilio.com/media/x',
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-inbound-media-'));
  config.inboundMediaStorageDir = dir;
  await writeFixture(dir, 'abcd1234.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    const same = await inboundMediaService.processAttachmentRow(row);
    assert.equal(same.status, 'stored');
    assert.equal(fetched, 0);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function writeFixture(root, key, buffer) {
  const rel = path.join(key.slice(0, 2), key.slice(2));
  const absolute = path.join(root, rel);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, buffer);
}