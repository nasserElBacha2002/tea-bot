import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaService from './inbound-media.service.js';
import { config } from '../config.js';

const conversation = { id: 'conv-sim', channel: 'simulator', provider: 'internal' };
const message = {
  id: 'msg-sim',
  conversationId: 'conv-sim',
  direction: 'inbound',
  senderType: 'user',
  body: '',
  provider: 'internal',
};

test('storeSimulatorUpload persiste PNG sin Twilio', async () => {
  const prevDir = config.inboundMediaStorageDir;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-sim-media-'));
  config.inboundMediaStorageDir = tmp;
  const prev = attachmentRepository.upsertPending;
  attachmentRepository.upsertPending = async (data) => ({
    id: 'att-sim',
    messageId: data.messageId,
    conversationId: data.conversationId,
    ordinal: data.ordinal,
    mimeType: data.mimeType,
    originalName: data.originalName,
    status: 'pending',
    retryCount: 0,
    storageKey: null,
  });
  attachmentRepository.tryAcquireForDownload = async () => ({
    id: 'att-sim',
    messageId: message.id,
    conversationId: conversation.id,
    ordinal: 0,
    status: 'downloading',
    retryCount: 1,
  });
  attachmentRepository.markStored = async (id, patch) => ({
    id,
    messageId: message.id,
    conversationId: conversation.id,
    ordinal: 0,
    mimeType: patch.mimeType,
    byteSize: patch.byteSize,
    originalName: 'captura.png',
    status: 'stored',
    storageKey: patch.storageKey,
  });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  try {
    const stored = await inboundMediaService.storeSimulatorUpload({
      conversation,
      message,
      buffer: png,
      mimeType: 'image/png',
      originalName: 'captura.png',
    });
    assert.equal(stored.status, 'stored');
  } finally {
    attachmentRepository.upsertPending = prev;
    config.inboundMediaStorageDir = prevDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('storeSimulatorUpload rechaza mime inválido', async () => {
  await assert.rejects(
    () => inboundMediaService.storeSimulatorUpload({
      conversation,
      message,
      buffer: Buffer.from('plain-text'),
      mimeType: 'text/plain',
      originalName: 'x.txt',
    }),
    (err) => err.message === 'mime_not_allowed',
  );
});