import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTwilioConversationFields,
  buildSessionSyncPatch,
} from './conversation.service.js';

const sampleEvent = {
  provider: 'twilio',
  flowId: 'main-menu',
  userId: 'twilio:whatsapp:+5491157109151',
  phone: '+5491157109151',
  text: 'hola',
  messageId: 'SM123',
  rawPayload: {
    From: 'whatsapp:+5491157109151',
    Body: 'hola',
    MessageSid: 'SM123',
  },
};

test('buildTwilioConversationFields normaliza telefono y conserva external user id', () => {
  const fields = buildTwilioConversationFields(sampleEvent);
  assert.equal(fields.externalUserId, 'twilio:whatsapp:+5491157109151');
  assert.equal(fields.phoneNumber, '+5491157109151');
  assert.equal(fields.channel, 'whatsapp');
  assert.equal(fields.provider, 'twilio');
});

test('buildSessionSyncPatch usa resultado del motor y sesion en memoria', () => {
  const conversation = { currentFlowId: 'main-menu', currentFlowVersion: 'v20' };
  const memorySession = {
    flowId: 'main-menu',
    flowVersion: 'v21',
    currentNode: 'welcome',
    variables: { a: 1 },
    history: ['welcome'],
  };
  const engineResult = {
    flowId: 'main-menu',
    currentNodeId: 'si_menu',
    variables: { a: 1, b: 2 },
  };

  const patch = buildSessionSyncPatch(memorySession, engineResult, conversation);
  assert.equal(patch.flowId, 'main-menu');
  assert.equal(patch.flowVersion, 'v21');
  assert.equal(patch.currentNodeKey, 'si_menu');
  assert.deepEqual(patch.variablesJson, { a: 1, b: 2 });
  assert.deepEqual(patch.historyJson, ['welcome']);
});
