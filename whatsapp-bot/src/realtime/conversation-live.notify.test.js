import test from 'node:test';
import assert from 'node:assert/strict';
import { registerLiveClient, resetLiveClientsForTests } from './conversation-live.broadcaster.js';
import { notifyConversationMessageCreated } from './conversation-live.notify.js';

test('notifyConversationMessageCreated no propaga attachments crudos en extras', () => {
  resetLiveClientsForTests();
  const payloads = [];
  const ws = {
    readyState: 1,
    send(body) {
      payloads.push(JSON.parse(body));
    },
    on() {},
  };
  registerLiveClient(ws);

  const message = {
    id: 'm1',
    conversationId: 'c1',
    direction: 'inbound',
    senderType: 'user',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  const conversation = {
    id: 'c1',
    channel: 'whatsapp',
    provider: 'twilio',
    status: 'bot',
    assignedAgentId: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    closedAt: null,
  };

  notifyConversationMessageCreated(conversation, message, {
    attachments: [{
      id: 'att-1',
      ordinal: 0,
      mimeType: 'image/jpeg',
      byteSize: 10,
      originalName: 'foto.jpg',
      status: 'pending',
      storageKey: 'secret-key',
      sourceUrl: 'https://api.twilio.com/media/xyz',
      failureReason: 'download_failed',
    }],
    debugFlag: true,
  });

  assert.equal(payloads.length, 1);
  const event = payloads[0];
  assert.equal(event.data.message.attachments.length, 1);
  assert.equal(event.data.message.attachments[0].status, 'pending');
  assert.equal('storageKey' in event.data.message.attachments[0], false);
  assert.equal('sourceUrl' in event.data.message.attachments[0], false);
  assert.equal('attachments' in event.data, false);
  assert.equal(event.data.debugFlag, true);
});