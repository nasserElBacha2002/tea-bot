import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyConversationLiveEvent, appendMessageIfNew } from './applyConversationLiveEvent';
import { conversationKeys } from '../hooks/useConversations';
import type { ConversationMessagesResponse } from '../types/conversation.types';

describe('applyConversationLiveEvent', () => {
  it('agrega mensaje sin duplicar por id', () => {
    const items = [
      { id: 'm1', conversationId: 'c1', direction: 'inbound' as const, senderType: 'user' as const, body: 'a', provider: 'internal', providerMessageId: null, metadata: null, createdAt: '1' },
    ];
    const next = appendMessageIfNew(items, {
      id: 'm1',
      conversationId: 'c1',
      direction: 'inbound',
      senderType: 'user',
      body: 'a',
      provider: 'internal',
      providerMessageId: null,
      metadata: null,
      createdAt: '1',
    });
    expect(next).toHaveLength(1);
  });

  it('actualiza mensajes de conversación seleccionada', () => {
    const qc = new QueryClient();
    const msgKey = conversationKeys.messages('c1');
    qc.setQueryData<ConversationMessagesResponse>(msgKey, {
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.message.created',
        conversationId: 'c1',
        occurredAt: new Date().toISOString(),
        data: {
          message: {
            id: 'm2',
            conversationId: 'c1',
            direction: 'inbound',
            senderType: 'user',
            body: 'hola',
            provider: 'internal',
            providerMessageId: null,
            metadata: null,
            createdAt: '2',
          },
        },
      },
      'c1',
    );

    const data = qc.getQueryData<ConversationMessagesResponse>(msgKey);
    expect(data?.items).toHaveLength(1);
    expect(data?.items[0]?.id).toBe('m2');
  });

  it('invalida lista si message.created llega sin conversation summary', () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.message.created',
        conversationId: 'c-new',
        occurredAt: new Date().toISOString(),
        data: {
          message: {
            id: 'm9',
            conversationId: 'c-new',
            direction: 'inbound',
            senderType: 'user',
            body: 'hola',
            provider: 'internal',
            providerMessageId: null,
            metadata: null,
            createdAt: '1',
          },
        },
      },
      null,
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: conversationKeys.all });
  });

  it('marca unread si el mensaje es de otra conversación', () => {
    const qc = new QueryClient();
    const result = applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.message.created',
        conversationId: 'c2',
        occurredAt: new Date().toISOString(),
        data: {
          message: {
            id: 'm3',
            conversationId: 'c2',
            direction: 'inbound',
            senderType: 'user',
            body: 'nuevo',
            provider: 'internal',
            providerMessageId: null,
            metadata: null,
            createdAt: '3',
          },
        },
      },
      'c1',
    );
    expect(result.unreadConversationId).toBe('c2');
  });

  it('no marca unread para mensaje de bot en otra conversación', () => {
    const qc = new QueryClient();
    const result = applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.message.created',
        conversationId: 'c2',
        occurredAt: new Date().toISOString(),
        data: {
          message: {
            id: 'm-bot',
            conversationId: 'c2',
            direction: 'outbound',
            senderType: 'bot',
            body: 'respuesta',
            provider: 'internal',
            providerMessageId: null,
            metadata: null,
            createdAt: '3',
          },
        },
      },
      'c1',
    );
    expect(result.unreadConversationId).toBeUndefined();
  });

  it('marca nueva conversación cuando llega created', () => {
    const qc = new QueryClient();
    const result = applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.created',
        conversationId: 'c-new',
        occurredAt: new Date().toISOString(),
        data: {
          conversation: {
            id: 'c-new',
            channel: 'simulator',
            provider: 'internal',
            phoneNumber: null,
            displayName: 'Nueva',
            status: 'bot',
            assignedAgentId: null,
            currentFlowId: null,
            currentFlowVersion: null,
            currentNodeKey: null,
            lastMessageAt: '2026-05-22T10:00:00.000Z',
            startedAt: '2026-05-22T10:00:00.000Z',
            closedAt: null,
            lastMessage: null,
            humanHandoff: null,
          },
        },
      },
      null,
    );
    expect(result.newConversationId).toBe('c-new');
  });
});
