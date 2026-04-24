// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
      responses: [],
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
    expect(result.current.publishError).toBe('No se pudo poner en vivo la conversación. Intenta nuevamente.');
  });
});
