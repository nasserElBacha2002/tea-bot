import test from 'node:test';
import assert from 'node:assert/strict';
import conversationService, {
  buildTwilioConversationFields,
  buildSessionSyncPatch,
} from './conversation.service.js';
import sessionService from './session.service.js';

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

test('hydrateRuntimeSessionIfNeeded no inventa welcome en first contact', async () => {
  const userId = 'test:hydrate:first-contact';
  await sessionService.resetSession(userId);
  const result = await conversationService.hydrateRuntimeSessionIfNeeded(
    userId,
    { flowId: 'main-menu', flowVersion: 'v1', currentNodeKey: null, variablesJson: {}, historyJson: [] },
    { provider: 'twilio', phone: '+5491100000000', rawPayload: {} },
    { id: 'conv-new', currentNodeKey: null },
  );
  assert.equal(result, null);
  assert.equal(sessionService.getSession(userId), null);
});

test('hydrateRuntimeSessionIfNeeded hidrata cuando el flujo ya tiene nodo', async () => {
  const userId = 'test:hydrate:resumed';
  await sessionService.resetSession(userId);
  try {
    const result = await conversationService.hydrateRuntimeSessionIfNeeded(
      userId,
      {
        flowId: 'main-menu',
        flowVersion: 'v1',
        currentNodeKey: 'welcome',
        variablesJson: {},
        historyJson: [],
      },
      { provider: 'twilio', phone: '+5491100000001', rawPayload: {} },
      { id: 'conv-old', currentNodeKey: 'welcome' },
    );
    assert.equal(result.currentNode, 'welcome');
    assert.equal(result.flowId, 'main-menu');
  } finally {
    await sessionService.resetSession(userId);
  }
});
