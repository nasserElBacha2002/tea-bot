import { describe, expect, it } from 'vitest';
import { resolveOutboundDeliveryUi } from './outboundDeliveryUi';
import type { ConversationMessage } from '../types/conversation.types';

const baseOutbound: ConversationMessage = {
  id: 'm1',
  conversationId: 'c1',
  direction: 'outbound',
  senderType: 'agent',
  body: 'hola',
  provider: 'twilio',
  providerMessageId: 'SM1',
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveOutboundDeliveryUi', () => {
  it('pendiente de despacho', () => {
    expect(resolveOutboundDeliveryUi({
      ...baseOutbound,
      providerMessageId: null,
      dispatch: { state: 'pending' },
    }).visual).toBe('pending');
  });

  it('entregado y leído', () => {
    expect(resolveOutboundDeliveryUi({
      ...baseOutbound,
      whatsappDelivery: { status: 'delivered' },
    }).visual).toBe('delivered');
    expect(resolveOutboundDeliveryUi({
      ...baseOutbound,
      whatsappDelivery: { status: 'read' },
    }).visual).toBe('read');
  });

  it('no retrocede a enviado si ya hay entregado en cache', () => {
    const ui = resolveOutboundDeliveryUi({
      ...baseOutbound,
      whatsappDelivery: { status: 'delivered' },
    });
    expect(ui.visual).toBe('delivered');
  });

  it('fallido Twilio muestra mensaje seguro', () => {
    const ui = resolveOutboundDeliveryUi({
      ...baseOutbound,
      whatsappDelivery: {
        status: 'failed',
        errorCode: '30008',
        errorMessage: 'Unknown error',
      },
    });
    expect(ui.visual).toBe('failed');
    expect(ui.errorMessage).toBe('Unknown error');
  });

  it('incierto sin reenvío', () => {
    expect(resolveOutboundDeliveryUi({
      ...baseOutbound,
      dispatch: { state: 'uncertain', error: 'dispatch_lease_expired' },
    }).visual).toBe('uncertain');
  });

  it('histórico sin estado', () => {
    expect(resolveOutboundDeliveryUi({
      ...baseOutbound,
      providerMessageId: null,
    }).visual).toBe('none');
  });
});