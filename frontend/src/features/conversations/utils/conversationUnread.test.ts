import { describe, expect, it } from 'vitest';
import {
  conversationMatchesFilters,
  findFirstUnreadMessage,
  isConversationDerivedUnread,
  isInboundUserLastMessage,
  isInboundUserMessageUnreadSinceRead,
  isMessageUnreadForAgent,
  listPriorityAccent,
} from './conversationUnread';
import type { ConversationMessage } from '../types/conversation.types';
import type { InboxConversationItem } from '../types/conversation.types';

const base: InboxConversationItem = {
  id: 'c1',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Test',
  status: 'bot',
  assignedAgentId: null,
  currentFlowId: null,
  currentFlowVersion: null,
  currentNodeKey: null,
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

describe('conversationUnread', () => {
  it('detecta último mensaje entrante de usuario', () => {
    expect(isInboundUserLastMessage(base)).toBe(true);
    expect(
      isInboundUserLastMessage({
        ...base,
        lastMessage: { body: 'ok', direction: 'outbound', senderType: 'bot', createdAt: '1' },
      }),
    ).toBe(false);
  });

  it('respeta filtros de lista', () => {
    expect(conversationMatchesFilters(base, { status: 'bot' })).toBe(true);
    expect(conversationMatchesFilters(base, { status: 'closed' })).toBe(false);
    expect(conversationMatchesFilters(base, { search: 'test' })).toBe(true);
    expect(conversationMatchesFilters(base, { search: 'zzz' })).toBe(false);
  });

  it('prioriza accent para waiting_human sin leer', () => {
    expect(listPriorityAccent('waiting_human', true)).toBe('high');
    expect(listPriorityAccent('closed', true)).toBe('none');
  });

  it('encuentra el primer mensaje no leído para el agente', () => {
    const msgs: ConversationMessage[] = [
      {
        id: 'm1',
        conversationId: 'c1',
        direction: 'inbound',
        senderType: 'user',
        body: 'viejo',
        provider: 'internal',
        providerMessageId: null,
        metadata: null,
        createdAt: '2026-05-22T10:00:00.000Z',
      },
      {
        id: 'm2',
        conversationId: 'c1',
        direction: 'outbound',
        senderType: 'bot',
        body: 'ok',
        provider: 'internal',
        providerMessageId: null,
        metadata: null,
        createdAt: '2026-05-22T10:01:00.000Z',
      },
      {
        id: 'm3',
        conversationId: 'c1',
        direction: 'inbound',
        senderType: 'user',
        body: 'nuevo',
        provider: 'internal',
        providerMessageId: null,
        metadata: null,
        createdAt: '2026-05-22T10:06:00.000Z',
      },
    ];
    const readAt = '2026-05-22T10:05:00.000Z';
    expect(isMessageUnreadForAgent(msgs[0], readAt)).toBe(false);
    expect(isMessageUnreadForAgent(msgs[1], readAt)).toBe(false);
    expect(isMessageUnreadForAgent(msgs[2], readAt)).toBe(true);
    expect(findFirstUnreadMessage(msgs, readAt)?.id).toBe('m3');
    expect(findFirstUnreadMessage(msgs, readAt)?.body).toBe('nuevo');
  });

  it('respeta readAt al derivar sin leer', () => {
    const readAt = '2026-05-22T10:05:00.000Z';
    expect(isConversationDerivedUnread(base, readAt)).toBe(false);
    expect(
      isConversationDerivedUnread(
        {
          ...base,
          lastMessage: {
            body: 'nuevo',
            direction: 'inbound',
            senderType: 'user',
            createdAt: '2026-05-22T10:06:00.000Z',
          },
        },
        readAt,
      ),
    ).toBe(true);
    expect(
      isInboundUserMessageUnreadSinceRead(
        { body: 'ok', direction: 'outbound', senderType: 'bot', createdAt: '2026-05-22T11:00:00.000Z' },
        null,
      ),
    ).toBe(false);
  });
});
