// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversationAlerts, CONVERSATION_ALERT_THROTTLE_MS } from './useConversationAlerts';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import * as preferences from '../utils/conversationAlertPreferences';
import * as sound from '../utils/conversationAlertSound';

vi.mock('../utils/conversationAlertSound', () => ({
  isConversationAlertSoundBlocked: vi.fn(() => false),
  playConversationAlertSound: vi.fn(async () => 'played' as const),
  unlockConversationAlertSound: vi.fn(async () => true),
}));

vi.mock('../utils/conversationAlertPreferences', () => ({
  getConversationAlertsEnabled: vi.fn(() => true),
  setConversationAlertsEnabled: vi.fn(),
}));

const inboundHumanEvent = (): ConversationLiveEvent => ({
  type: 'conversation.message.created',
  conversationId: 'c1',
  occurredAt: '2026-06-16T10:00:00.000Z',
  data: {
    conversation: {
      id: 'c1',
      channel: 'whatsapp',
      provider: 'twilio',
      phoneNumber: null,
      displayName: null,
      status: 'waiting_human',
      assignedAgentId: null,
      currentFlowId: null,
      currentFlowVersion: null,
      currentNodeKey: null,
      lastMessageAt: '2026-06-16T10:00:00.000Z',
      startedAt: '2026-06-16T09:00:00.000Z',
      closedAt: null,
      lastMessage: null,
      humanHandoff: null,
    },
    message: {
      id: 'm1',
      conversationId: 'c1',
      direction: 'inbound',
      senderType: 'user',
      body: 'hola',
      provider: 'twilio',
      providerMessageId: null,
      metadata: null,
      createdAt: '2026-06-16T10:00:00.000Z',
    },
  },
});

describe('useConversationAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(preferences.getConversationAlertsEnabled).mockReturnValue(true);
    vi.mocked(sound.playConversationAlertSound).mockResolvedValue('played');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reproduce sonido para mensaje entrante que requiere humano', async () => {
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
    });

    expect(sound.playConversationAlertSound).toHaveBeenCalledTimes(1);
  });

  it('no reproduce sonido para mensaje de bot', async () => {
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    const event = inboundHumanEvent();
    event.data!.conversation!.status = 'bot';

    await act(async () => {
      await result.current.processEvent(event);
    });

    expect(sound.playConversationAlertSound).not.toHaveBeenCalled();
  });

  it('no reproduce sonido duplicado para el mismo mensaje', async () => {
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
      await result.current.processEvent(inboundHumanEvent());
    });

    expect(sound.playConversationAlertSound).toHaveBeenCalledTimes(1);
  });

  it('respeta preferencia desactivada', async () => {
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    act(() => {
      result.current.setSoundEnabled(false);
    });

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
    });

    expect(sound.playConversationAlertSound).not.toHaveBeenCalled();
  });

  it('no inicializa alertas si enabled es false', async () => {
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: false,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
    });

    expect(sound.playConversationAlertSound).not.toHaveBeenCalled();
  });

  it('limita alertas repetidas por throttle', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
    });

    const second = inboundHumanEvent();
    second.data!.message!.id = 'm2';

    await act(async () => {
      await result.current.processEvent(second);
    });
    expect(sound.playConversationAlertSound).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(CONVERSATION_ALERT_THROTTLE_MS + 1);
      await result.current.processEvent(second);
    });
    expect(sound.playConversationAlertSound).toHaveBeenCalledTimes(2);
  });

  it('muestra toast si el navegador bloquea el sonido', async () => {
    vi.mocked(sound.playConversationAlertSound).mockResolvedValue('blocked');
    const { result } = renderHook(() =>
      useConversationAlerts({
        enabled: true,
        userContext: { currentAgentId: 'agent-1' },
      }),
    );

    await act(async () => {
      await result.current.processEvent(inboundHumanEvent());
    });

    expect(result.current.pendingToast).not.toBeNull();
    expect(result.current.soundBlocked).toBe(true);
  });
});
