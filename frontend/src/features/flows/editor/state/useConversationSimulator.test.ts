// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { useConversationSimulator, stableDraftSignature } from './useConversationSimulator';

const simMocks = vi.hoisted(() => ({
  start: vi.fn(),
  message: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('../../api/simulatorApi', () => ({
  simulatorApi: {
    start: simMocks.start,
    message: simMocks.message,
    reset: simMocks.reset,
  },
}));

function minimalVm(): ConversationViewModel {
  return {
    flowId: 'f1',
    flowName: 'T',
    version: 'draft',
    status: 'draft',
    entryStepId: 'a',
    fallbackStepId: 'b',
    steps: [
      {
        uiId: 'a',
        internalId: 'a',
        title: 'Saludo',
        message: 'Hola',
        responses: [],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
    ],
    compatibilityWarnings: [],
  };
}

const baseFlow: Flow = {
  id: 'f1',
  name: 'T',
  version: 'draft',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [
    {
      id: 'a',
      type: 'message',
      message: 'Hola',
      transitions: [{ type: 'default', nextNode: 'b' }],
      ui: { position: { x: 0, y: 0 } },
    },
    { id: 'b', type: 'end', message: 'Fin', ui: { position: { x: 1, y: 1 } } },
  ],
};

describe('stableDraftSignature', () => {
  it('changes when flow nodes change', () => {
    const a = stableDraftSignature(baseFlow);
    const b = stableDraftSignature({
      ...baseFlow,
      nodes: baseFlow.nodes.map(n => (n.id === 'a' ? { ...n, message: 'Otro' } : n)),
    });
    expect(a).not.toBe(b);
  });
});

describe('useConversationSimulator', () => {
  beforeEach(() => {
    simMocks.start.mockReset();
    simMocks.message.mockReset();
    simMocks.reset.mockReset();
    simMocks.start.mockResolvedValue({
      sessionId: 's1',
      reply: 'Mensaje del bot',
      flowId: 'f1',
      currentNodeId: 'a',
      variables: {},
    });
    simMocks.message.mockResolvedValue({
      sessionId: 's1',
      reply: 'Respuesta siguiente',
      flowId: 'f1',
      currentNodeId: 'b',
      variables: { nombre: 'Ana' },
    });
    simMocks.reset.mockResolvedValue(undefined);
  });

  it('initializes with first bot message', async () => {
    const { result } = renderHook(() =>
      useConversationSimulator({ flowId: 'f1', draftFlow: baseFlow, viewModel: minimalVm() })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.started).toBe(true);
    expect(result.current.messages).toEqual([{ role: 'bot', text: 'Mensaje del bot' }]);
    expect(result.current.error).toBeNull();
    expect(simMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ flowId: 'f1', flow: baseFlow })
    );
  });

  it('sets friendly error when start fails', async () => {
    simMocks.start.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      useConversationSimulator({ flowId: 'f1', draftFlow: baseFlow, viewModel: minimalVm() })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('No se pudo probar la conversación. Intenta nuevamente.');
    expect(result.current.started).toBe(false);
  });

  it('sendMessage appends client and bot messages', async () => {
    const { result } = renderHook(() =>
      useConversationSimulator({ flowId: 'f1', draftFlow: baseFlow, viewModel: minimalVm() })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.sendMessage('hola');
    });
    expect(result.current.messages.map(m => m.role)).toEqual(['bot', 'user', 'bot']);
    expect(result.current.messages[1].text).toBe('hola');
    expect(result.current.variables).toEqual({ nombre: 'Ana' });
  });

  it('restart clears messages and starts again', async () => {
    const { result } = renderHook(() =>
      useConversationSimulator({ flowId: 'f1', draftFlow: baseFlow, viewModel: minimalVm() })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.sendMessage('x');
    });
    simMocks.start.mockResolvedValueOnce({
      sessionId: 's1',
      reply: 'Reinicio',
      flowId: 'f1',
      currentNodeId: 'a',
      variables: {},
    });
    await act(async () => {
      await result.current.restart();
    });
    expect(simMocks.reset).toHaveBeenCalled();
    expect(result.current.messages).toEqual([{ role: 'bot', text: 'Reinicio' }]);
  });
});
