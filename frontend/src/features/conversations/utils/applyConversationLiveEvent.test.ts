import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyConversationLiveEvent, appendMessageIfNew } from './applyConversationLiveEvent';
import { conversationKeys } from '../hooks/useConversations';
import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationMessagesResponse,
  InboxConversationItem,
} from '../types/conversation.types';

const baseListItem: InboxConversationItem = {
  id: 'c1',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Test',
  status: 'bot',
  assignedAgentId: null,
  currentFlowId: 'main-menu',
  currentFlowVersion: 'v1',
  currentNodeKey: 'welcome',
  lastMessageAt: '2026-05-22T10:00:00.000Z',
  startedAt: '2026-05-22T09:00:00.000Z',
  closedAt: null,
  lastMessage: {
    body: 'hola',
    direction: 'inbound',
    senderType: 'user',
    createdAt: '2026-05-22T10:00:00.000Z',
  },
  humanHandoff: null,
};

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

  it('actualiza status a waiting_human en lista y detalle sin borrar lastMessage', () => {
    const qc = new QueryClient();
    const listKey = conversationKeys.list({ limit: 50, offset: 0, sort: 'last_message_at_desc' });
    qc.setQueryData<ConversationListResponse>(listKey, {
      items: [baseListItem],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const detailKey = conversationKeys.detail('c1');
    qc.setQueryData<ConversationDetailResponse>(detailKey, {
      conversation: {
        id: 'c1',
        channel: 'simulator',
        provider: 'internal',
        phoneNumber: null,
        displayName: 'Test',
        status: 'bot',
        assignedAgentId: null,
        currentFlowId: 'main-menu',
        currentFlowVersion: 'v1',
        currentNodeKey: 'welcome',
        lastMessageAt: '2026-05-22T10:00:00.000Z',
        startedAt: '2026-05-22T09:00:00.000Z',
        closedAt: null,
      },
      activeSession: null,
      humanHandoff: null,
    });

    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.updated',
        conversationId: 'c1',
        occurredAt: new Date().toISOString(),
        data: {
          conversation: {
            ...baseListItem,
            status: 'waiting_human',
            assignedAgentId: null,
            currentNodeKey: 'human_handoff',
          },
          humanHandoff: {
            id: 'h1',
            status: 'pending',
            reason: 'human_handoff',
            requestedBy: 'bot',
            requestedAt: '2026-05-22T10:01:00.000Z',
            assignedAgentId: null,
          },
        },
      },
      'c1',
    );

    const list = qc.getQueryData<ConversationListResponse>(listKey);
    expect(list?.items[0]?.status).toBe('waiting_human');
    expect(list?.items[0]?.lastMessage?.body).toBe('hola');
    expect(list?.items[0]?.humanHandoff?.status).toBe('pending');

    const detail = qc.getQueryData<ConversationDetailResponse>(detailKey);
    expect(detail?.conversation.status).toBe('waiting_human');
    expect(detail?.humanHandoff?.reason).toBe('human_handoff');
  });

  it('marca handoff cuando la conversación pasa a waiting_human y no está seleccionada', () => {
    const qc = new QueryClient();
    const listKey = conversationKeys.list({ limit: 50, offset: 0, sort: 'last_message_at_desc' });
    qc.setQueryData<ConversationListResponse>(listKey, {
      items: [baseListItem],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const result = applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.updated',
        conversationId: 'c1',
        occurredAt: new Date().toISOString(),
        data: {
          conversation: {
            ...baseListItem,
            status: 'waiting_human',
            currentNodeKey: 'human_handoff',
          },
        },
      },
      null,
    );

    expect(result.handoffConversationId).toBe('c1');
    expect(result.unreadConversationId).toBe('c1');
  });

  it('invalida lista si conversation.updated llega sin summary', () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.updated',
        conversationId: 'c-missing',
        occurredAt: new Date().toISOString(),
      },
      null,
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: conversationKeys.all });
  });

  it('no duplica conversación en created + updated', () => {
    const qc = new QueryClient();
    const listKey = conversationKeys.list({ limit: 50, offset: 0, sort: 'last_message_at_desc' });
    qc.setQueryData<ConversationListResponse>(listKey, {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    const createdItem = { ...baseListItem, id: 'c-dup' };
    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.created',
        conversationId: 'c-dup',
        occurredAt: new Date().toISOString(),
        data: { conversation: createdItem },
      },
      null,
    );
    applyConversationLiveEvent(
      qc,
      {
        type: 'conversation.updated',
        conversationId: 'c-dup',
        occurredAt: new Date().toISOString(),
        data: {
          conversation: { ...createdItem, status: 'waiting_human', currentNodeKey: 'human_handoff' },
        },
      },
      null,
    );

    const list = qc.getQueryData<ConversationListResponse>(listKey);
    expect(list?.items.filter((i) => i.id === 'c-dup')).toHaveLength(1);
    expect(list?.items[0]?.status).toBe('waiting_human');
  });
});
