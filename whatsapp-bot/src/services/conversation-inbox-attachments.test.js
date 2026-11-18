import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import conversationInboxService from './conversation-inbox.service.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import { config } from '../config.js';
import { writeInboundMediaObject } from '../utils/inbound-media-storage.js';

const sampleConversation = {
  id: 'conv-1',
  channel: 'whatsapp',
  provider: 'twilio',
};

const sampleMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  direction: 'inbound',
  senderType: 'user',
  body: '',
  provider: 'twilio',
  providerMessageId: null,
  metadataJson: null,
  createdAt: new Date('2026-05-21T10:00:00Z'),
};

function stubRepo(repo, patch) {
  const restore = {};
  for (const [key, fn] of Object.entries(patch)) {
    restore[key] = repo[key];
    repo[key] = fn;
  }
  return () => {
    for (const [key, value] of Object.entries(restore)) {
      repo[key] = value;
    }
  };
}

test('getConversationMessages incluye attachments en items', async () => {
  const undo = stubRepo(conversationRepository, {
    getConversationById: async (id) => (id === 'conv-1' ? sampleConversation : null),
  });
  const undoMsg = stubRepo(conversationMessageRepository, {
    listByConversationId: async () => [sampleMessage],
    countByConversationId: async () => 1,
  });
  const undoAtt = stubRepo(attachmentRepository, {
    findByMessageIds: async () => [{
      id: 'att-1',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      ordinal: 0,
      mimeType: 'image/png',
      byteSize: 512,
      originalName: 'img.png',
      status: 'stored',
    }],
  });
  const undoReady = conversationInboxService.ensureReady;
  conversationInboxService.ensureReady = async () => {};
  try {
    const data = await conversationInboxService.getConversationMessages('conv-1', { order: 'asc' });
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].attachments.length, 1);
    assert.equal(data.items[0].attachments[0].status, 'stored');
  } finally {
    conversationInboxService.ensureReady = undoReady;
    undoAtt();
    undoMsg();
    undo();
  }
});

test('openMessageAttachmentContent resuelve archivo stored', async () => {
  const prevDir = config.inboundMediaStorageDir;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-att-open-'));
  config.inboundMediaStorageDir = tmp;
  const storageKey = 'ab'.repeat(32);
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  await writeInboundMediaObject(tmp, storageKey, buffer);

  const undo = stubRepo(conversationRepository, {
    getConversationById: async () => sampleConversation,
  });
  const undoAtt = stubRepo(attachmentRepository, {
    findById: async () => ({
      id: 'att-1',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      ordinal: 0,
      mimeType: 'image/jpeg',
      byteSize: buffer.length,
      originalName: 'foto.jpg',
      storageKey,
      status: 'stored',
    }),
  });
  const undoReady = conversationInboxService.ensureReady;
  conversationInboxService.ensureReady = async () => {};

  try {
    const file = await conversationInboxService.openMessageAttachmentContent(
      'conv-1',
      'msg-1',
      'att-1',
      { download: false },
    );
    assert.equal(file.mimeType, 'image/jpeg');
    assert.equal(file.disposition, 'inline');
    assert.equal(file.byteSize, buffer.length);
  } finally {
    conversationInboxService.ensureReady = undoReady;
    undoAtt();
    undo();
    config.inboundMediaStorageDir = prevDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('openMessageAttachmentContent 404 si status no es stored', async () => {
  const undo = stubRepo(conversationRepository, {
    getConversationById: async () => sampleConversation,
  });
  const undoAtt = stubRepo(attachmentRepository, {
    findById: async () => ({
      id: 'att-pending',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      ordinal: 0,
      mimeType: 'image/jpeg',
      byteSize: null,
      originalName: null,
      storageKey: null,
      status: 'pending',
    }),
  });
  const undoReady = conversationInboxService.ensureReady;
  conversationInboxService.ensureReady = async () => {};
  try {
    await assert.rejects(
      () => conversationInboxService.openMessageAttachmentContent('conv-1', 'msg-1', 'att-pending'),
      (err) => err.code === 'ATTACHMENT_NOT_AVAILABLE',
    );
  } finally {
    conversationInboxService.ensureReady = undoReady;
    undoAtt();
    undo();
  }
});