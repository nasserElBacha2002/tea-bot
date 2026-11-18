import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapMessagePublic,
  mapWhatsappDeliveryPublic,
  mapOutboundDispatchPublic,
} from './conversation-inbox.mapper.js';

test('mapWhatsappDeliveryPublic no expone campos internos extra', () => {
  const mapped = mapWhatsappDeliveryPublic({
    status: 'failed',
    errorCode: '30008',
    errorMessage: 'Unknown',
    statusAt: '2026-01-01T00:00:00.000Z',
    provider: 'twilio',
    providerMessageId: 'SM1',
  });
  assert.deepEqual(mapped, {
    status: 'failed',
    errorCode: '30008',
    errorMessage: 'Unknown',
    statusAt: '2026-01-01T00:00:00.000Z',
  });
});

test('mapMessagePublic outbound histórico sin entrega no inventa whatsappDelivery', () => {
  const msg = mapMessagePublic({
    id: 'm1',
    conversationId: 'c1',
    direction: 'outbound',
    senderType: 'agent',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: 'SM1',
    metadataJson: { outboundDelivery: { state: 'confirmed' } },
    createdAt: new Date().toISOString(),
  });
  assert.equal(msg.whatsappDelivery, undefined);
  assert.equal(msg.dispatch?.state, 'confirmed');
});

test('mapMessagePublic inbound no incluye dispatch ni whatsappDelivery', () => {
  const msg = mapMessagePublic({
    id: 'm2',
    conversationId: 'c1',
    direction: 'inbound',
    senderType: 'user',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: 'SM2',
    metadataJson: null,
    createdAt: new Date().toISOString(),
  });
  assert.equal(msg.dispatch, undefined);
  assert.equal(msg.whatsappDelivery, undefined);
});

test('mapOutboundDispatchPublic', () => {
  assert.deepEqual(mapOutboundDispatchPublic({ outboundDelivery: { state: 'uncertain', error: 'timeout' } }), {
    state: 'uncertain',
    error: 'timeout',
  });
});