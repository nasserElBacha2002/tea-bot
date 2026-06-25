// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { useConversationPublish } from './useConversationPublish';

const publishMutate = vi.fn();

vi.mock('../../hooks/useFlows', () => ({
  usePublishFlow: () => ({
    mutateAsync: publishMutate,
    isPending: false,
  }),
  usePublishedVersions: () => ({
    data: { flowId: 'f1', activeVersion: null, lastPublishedAt: null, updatedAt: null, versions: [] },
    isLoading: false,
  }),
  usePublishedVersionDetail: () => ({
    data: undefined,
    isLoading: false,
  }),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const baseFlow: Flow = {
  id: 'f1',
  name: 'F',
  version: 'draft',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [],
};

const draftVm: ConversationViewModel = {
  flowId: 'f1',
  flowName: 'F',
  version: 'draft',
  status: 'draft',
  entryStepId: 'a',
  fallbackStepId: 'b',
  steps: [
    {
      uiId: 'a',
      internalId: 'a',
      title: 'A',
      message: 'm',
      responses: [
        { uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'b', displayOrder: 0 },
      ],
      metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
    },
    {
      uiId: 'b',
      internalId: 'b',
      title: 'B',
      message: 'Respaldo',
      responses: [
        { uiId: 'r2', kind: 'fallback', values: [], destinationStepId: 'a', displayOrder: 0 },
      ],
      metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
    },
  ],
  compatibilityWarnings: [],
};

describe('useConversationPublish', () => {
  beforeEach(() => {
    publishMutate.mockReset();
    publishMutate.mockResolvedValue({ flowId: 'f1', version: 'v1', publishedAt: '2024-01-01' });
  });

  it('opens review step', () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useConversationPublish({
          flowId: 'f1',
          draftVm,
          baseFlow,
          editorDirty: false,
          saveDraft,
        }),
      { wrapper: createWrapper() }
    );
    act(() => result.current.startPublishFlow());
    expect(result.current.step).toBe('review');
  });

  it('confirmPublish saves then publishes', async () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useConversationPublish({
          flowId: 'f1',
          draftVm,
          baseFlow,
          editorDirty: true,
          saveDraft,
        }),
      { wrapper: createWrapper() }
    );
    await act(async () => {
      const ok = await result.current.confirmPublish();
      expect(ok).toBe(true);
    });
    expect(saveDraft).toHaveBeenCalled();
    expect(publishMutate).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(result.current.step).toBe('closed'));
  });

  it('surfaces detailed validation errors from the publish API', async () => {
    const axiosError = new axios.AxiosError('bad request');
    axiosError.response = {
      status: 400,
      data: {
        ok: false,
        error: 'FLOW_PUBLISH_VALIDATION_FAILED',
        message: 'No se puede publicar el borrador porque tiene errores de validación.',
        details: {
          valid: false,
          errors: [
            {
              code: 'FLOW_TRANSITION_VALUE_INVALID',
              message: 'Node `si_cursos_menu`, transition priority 3: `value` is required for transition type `match` (expected string, received undefined).',
            },
          ],
        },
      },
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
    };
    publishMutate.mockRejectedValueOnce(axiosError);
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useConversationPublish({
          flowId: 'f1',
          draftVm,
          baseFlow,
          editorDirty: false,
          saveDraft,
        }),
      { wrapper: createWrapper() }
    );
    await act(async () => {
      const ok = await result.current.confirmPublish();
      expect(ok).toBe(false);
    });
    expect(result.current.publishError).toMatch(/si_cursos_menu/);
  });

  it('sets friendly error and keeps flow open on failure', async () => {
    publishMutate.mockRejectedValueOnce(new Error('network'));
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useConversationPublish({
          flowId: 'f1',
          draftVm,
          baseFlow,
          editorDirty: false,
          saveDraft,
        }),
      { wrapper: createWrapper() }
    );
    await act(async () => {
      const ok = await result.current.confirmPublish();
      expect(ok).toBe(false);
    });
    expect(result.current.publishError).toBe('network');
  });
});
