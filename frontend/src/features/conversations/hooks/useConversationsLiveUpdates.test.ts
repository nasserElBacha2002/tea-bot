// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationsLiveUpdates } from './useConversationsLiveUpdates';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    void url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  close(code = 1000, reason = '') {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  send() {}
}

describe('useConversationsLiveUpdates', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    MockWebSocket.instances = [];
    vi.clearAllMocks();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  it('abre conexión al montar con enabled', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
  });

  it('no abre socket si enabled es false', () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: false,
          selectedConversationId: null,
        }),
      { wrapper },
    );
    expect(MockWebSocket.instances.length).toBe(0);
  });
});
