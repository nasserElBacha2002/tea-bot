import { describe, expect, it } from 'vitest';
import {
  isInboundUserMessage,
  messageDisplayBody,
  resolveMessageBubbleRole,
} from './conversationMessageDisplay';
import type { ConversationMessage } from '../types/conversation.types';

function msg(partial: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    direction: 'inbound',
    senderType: 'user',
    body: '1',
    provider: 'internal',
    providerMessageId: null,
    metadata: null,
    createdAt: '2026-05-22T10:00:00.000Z',
    ...partial,
  };
}

describe('conversationMessageDisplay', () => {
  it('trata opciones numéricas como usuario', () => {
    expect(resolveMessageBubbleRole(msg({ body: '1' }))).toBe('user');
    expect(resolveMessageBubbleRole(msg({ body: '2' }))).toBe('user');
    expect(resolveMessageBubbleRole(msg({ body: 'humano' }))).toBe('user');
    expect(resolveMessageBubbleRole(msg({ body: 'menú' }))).toBe('user');
  });

  it('prioriza direction inbound sobre sender legacy', () => {
    expect(
      resolveMessageBubbleRole(
        msg({ senderType: 'system' as ConversationMessage['senderType'], direction: 'inbound' }),
      ),
    ).toBe('user');
  });

  it('no marca bot outbound como usuario', () => {
    expect(
      isInboundUserMessage(
        msg({ direction: 'outbound', senderType: 'bot', body: 'Hola' }),
      ),
    ).toBe(false);
  });

  it('muestra body aunque el rol sea unknown', () => {
    expect(
      messageDisplayBody(
        msg({ direction: 'outbound', senderType: 'system', body: 'alerta' }),
      ),
    ).toBe('alerta');
  });
});
