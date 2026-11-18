import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import monitoringService from './monitoring.service.js';
import { deliveryDeps } from '../services/twilio-message-delivery.service.js';

const savedDeps = {
  repository: deliveryDeps.repository,
  conversationMessageRepository: deliveryDeps.conversationMessageRepository,
};

test('recordDeliveryStatus registra entrega aunque MONITORING_ENABLED esté apagado', async () => {
  const prevMonitoring = config.monitoringEnabled;
  config.monitoringEnabled = false;

  let called = false;
  deliveryDeps.repository = {
    ...deliveryDeps.repository,
    applyDeliveryStatusAdvance: async () => {
      called = true;
      return { applied: true, previous: null };
    },
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => null,
  };

  try {
    const result = await monitoringService.recordDeliveryStatus({
      MessageSid: 'SM-MON-OFF',
      MessageStatus: 'sent',
    });
    assert.equal(called, true);
    assert.equal(result.applied, true);
  } finally {
    config.monitoringEnabled = prevMonitoring;
    deliveryDeps.repository = savedDeps.repository;
    deliveryDeps.conversationMessageRepository = savedDeps.conversationMessageRepository;
  }
});