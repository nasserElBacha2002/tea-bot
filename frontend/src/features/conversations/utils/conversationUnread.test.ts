import { describe, expect, it } from 'vitest';
import {
  conversationMatchesFilters,
  isInboundUserLastMessage,
  listPriorityAccent,
} from './conversationUnread';
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
});
