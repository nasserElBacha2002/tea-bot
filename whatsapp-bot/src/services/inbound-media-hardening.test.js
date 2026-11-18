import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaService from './inbound-media.service.js';

function withRepo(stubs, fn) {
  const prev = {};
  for (const [key, fnImpl] of Object.entries(stubs)) {
    prev[key] = attachmentRepository[key];
    attachmentRepository[key] = fnImpl;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      attachmentRepository[key] = value;
    }
  });
}

test('fallo transitorio programa retry y luego almacena', async () => {
  config.inboundMediaEnabled = true;
  config.inboundMediaMaxRetries = 3;
  config.twilioAccountSid = 'AC';
  config.twilioAuthToken = 'tok';
  let attempts = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    attempts += 1;
    if (attempts === 1) {
      return { status: 503, ok: false, headers: { get: () => null }, body: null };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]); } },
    };
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-media-hardening-'));
  config.inboundMediaStorageDir = dir;
  const row = {
    id: 'att-retry',
    status: 'pending',
    retryCount: 0,
    mimeType: 'image/png',
    sourceUrl: 'https://api.twilio.com/media/png',
  };
  try {
    await withRepo({
      tryAcquireForDownload: async () => ({ ...row, status: 'downloading', retryCount: 1 }),
      markFailed: async (id, reason, opts) => ({
        ...row,
        status: 'failed',
        failureReason: reason,
        retryCount: 1,
        nextRetryAt: opts?.retryAt || null,
      }),
      markStored: async (id, patch) => ({
        ...row,
        status: 'stored',
        storageKey: patch.storageKey,
        mimeType: patch.mimeType,
      }),
      findById: async () => row,
    }, async () => {
      const failed = await inboundMediaService.processAttachmentRow(row);
      assert.equal(failed.failureReason, 'download_http_503');
      const stored = await inboundMediaService.processAttachmentRow({
        ...row,
        status: 'failed',
        failureReason: 'download_http_503',
        retryCount: 1,
        nextRetryAt: null,
      });
      assert.equal(stored.status, 'stored');
      assert.equal(attempts, 2);
    });
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('dos adquisiciones concurrentes: solo una gana', async () => {
  let acquisitions = 0;
  const row = {
    id: '00000000-0000-4000-8000-000000000101',
    status: 'pending',
    retryCount: 0,
    mimeType: 'image/jpeg',
    sourceUrl: 'https://api.twilio.com/x',
  };
  config.inboundMediaEnabled = true;
  await withRepo({
    tryAcquireForDownload: async () => {
      acquisitions += 1;
      if (acquisitions > 1) return null;
      return { ...row, status: 'downloading', retryCount: 1 };
    },
    markFailed: async (_id, reason) => ({ ...row, status: 'failed', failureReason: reason }),
    findById: async () => row,
  }, async () => {
    global.fetch = async () => ({ ok: false, status: 503, headers: { get: () => null }, body: null });
    const [a, b] = await Promise.all([
      inboundMediaService.processAttachmentRow(row),
      inboundMediaService.processAttachmentRow(row),
    ]);
    assert.equal(acquisitions, 2);
    assert.ok(a.status === 'failed' || a.status === 'pending');
    assert.ok(b.status === 'failed' || b.status === 'pending');
  });
});