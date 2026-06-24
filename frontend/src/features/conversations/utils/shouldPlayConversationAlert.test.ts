import { describe, expect, it } from 'vitest';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import {
  buildConversationAlertEventId,
  shouldPlayConversationAlert,
} from './shouldPlayConversationAlert';

const ctx = { currentAgentId: 'agent-1', operatorUsername: 'operator' };

function messageEvent(
  overrides: Partial<ConversationLiveEvent> & {
    status: 'waiting_human' | 'assigned' | 'bot' | 'closed' | 'paused';
    direction?: 'inbound' | 'outbound';
    senderType?: 'user' | 'bot' | 'agent' | 'system';
  },
): ConversationLiveEvent {
  const {
    status,
    direction = 'inbound',
    senderType = 'user',
    ...rest
  } = overrides;
  return {
    type: 'conversation.message.created',
    conversationId: 'c1',
    occurredAt: '2026-06-16T10:00:00.000Z',
    data: {
      conversation: {
        id: 'c1',
        channel: 'whatsapp',
        provider: 'twilio',
        phoneNumber: '+54911',
        displayName: null,
        status,
        assignedAgentId: null,
        currentFlowId: null,
        currentFlowVersion: null,
        currentNodeKey: null,
        lastMessageAt: '2026-06-16T10:00:00.000Z',
        startedAt: '2026-06-16T09:00:00.000Z',
        closedAt: status === 'closed' ? '2026-06-16T10:00:00.000Z' : null,
        lastMessage: null,
        humanHandoff: null,
      },
      message: {
        id: 'm1',
        conversationId: 'c1',
        direction,
        senderType,
        body: 'hola',
        provider: 'twilio',
        providerMessageId: null,
        metadata: null,
        createdAt: '2026-06-16T10:00:00.000Z',
      },
    },
    ...rest,
  };
}

describe('shouldPlayConversationAlert', () => {
  it('dispara alerta para mensaje entrante en conversación humana', () => {
    expect(shouldPlayConversationAlert(messageEvent({ status: 'waiting_human' }), ctx)).toBe(true);
    expect(shouldPlayConversationAlert(messageEvent({ status: 'assigned' }), ctx)).toBe(true);
    expect(shouldPlayConversationAlert(messageEvent({ status: 'paused' }), ctx)).toBe(true);
  });

  it('no dispara para conversación manejada por bot', () => {
    expect(shouldPlayConversationAlert(messageEvent({ status: 'bot' }), ctx)).toBe(false);
  });

  it('no dispara para mensaje saliente u operador', () => {
    expect(
      shouldPlayConversationAlert(
        messageEvent({ status: 'assigned', direction: 'outbound', senderType: 'agent' }),
        ctx,
      ),
    ).toBe(false);
    expect(
      shouldPlayConversationAlert(
        messageEvent({ status: 'assigned', direction: 'outbound', senderType: 'bot' }),
        ctx,
      ),
    ).toBe(false);
  });

  it('no dispara para conversación cerrada', () => {
    expect(shouldPlayConversationAlert(messageEvent({ status: 'closed' }), ctx)).toBe(false);
    expect(
      shouldPlayConversationAlert(
        {
          type: 'conversation.closed',
          conversationId: 'c1',
          occurredAt: '2026-06-16T10:00:00.000Z',
          data: { conversation: messageEvent({ status: 'closed' }).data?.conversation },
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('dispara cuando la conversación pasa a waiting_human', () => {
    const event: ConversationLiveEvent = {
      type: 'conversation.updated',
      conversationId: 'c1',
      occurredAt: '2026-06-16T10:00:00.000Z',
      data: {
        conversation: messageEvent({ status: 'waiting_human' }).data!.conversation!,
        humanHandoff: {
          id: 'h1',
          status: 'pending',
          reason: null,
          requestedBy: 'bot',
          requestedAt: '2026-06-16T10:00:00.000Z',
        },
      },
    };
    expect(shouldPlayConversationAlert(event, ctx)).toBe(true);
    expect(buildConversationAlertEventId(event)).toBe('handoff:h1');
  });

  it('no dispara en returned_to_bot', () => {
    const event: ConversationLiveEvent = {
      type: 'conversation.returned_to_bot',
      conversationId: 'c1',
      occurredAt: '2026-06-16T10:00:00.000Z',
      data: {
        conversation: {
          ...messageEvent({ status: 'bot' }).data!.conversation!,
          status: 'bot',
        },
      },
    };
    expect(shouldPlayConversationAlert(event, ctx)).toBe(false);
  });

  it('deduplica por id de mensaje', () => {
    const event = messageEvent({ status: 'waiting_human' });
    expect(buildConversationAlertEventId(event)).toBe('message:m1');
  });
});
