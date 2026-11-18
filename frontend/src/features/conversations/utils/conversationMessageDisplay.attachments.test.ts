import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../types/conversation.types';
import { messageDisplayBody, messageHasVisibleBody } from './conversationMessageDisplay';

const base: ConversationMessage = {
  id: '1',
  conversationId: 'c1',
  direction: 'inbound',
  senderType: 'user',
  body: '',
  provider: 'twilio',
  providerMessageId: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('conversationMessageDisplay attachments', () => {
  it('mensaje solo multimedia no muestra guion', () => {
    const msg = {
      ...base,
      attachments: [{
        id: 'a1',
        ordinal: 0,
        mimeType: 'image/jpeg',
        byteSize: 100,
        originalName: null,
        status: 'stored' as const,
      }],
    };
    expect(messageDisplayBody(msg)).toBe('');
    expect(messageHasVisibleBody(msg)).toBe(false);
  });

  it('mensaje con caption y adjuntos mantiene texto', () => {
    const msg = {
      ...base,
      body: 'mirá esto',
      attachments: [{
        id: 'a1',
        ordinal: 0,
        mimeType: 'application/pdf',
        byteSize: 900,
        originalName: 'doc.pdf',
        status: 'stored' as const,
      }],
    };
    expect(messageDisplayBody(msg)).toBe('mirá esto');
    expect(messageHasVisibleBody(msg)).toBe(true);
  });

  it('regresión texto sin adjuntos', () => {
    const msg = { ...base, body: 'hola' };
    expect(messageDisplayBody(msg)).toBe('hola');
    expect(messageHasVisibleBody(msg)).toBe(true);
  });
});