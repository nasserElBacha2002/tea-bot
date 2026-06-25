// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationsLiveUpdates } from './useConversationsLiveUpdates';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  closed = false;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    void url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.simulateOpen());
  }

  simulateOpen() {
    if (this.closed) return;
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close(code = 1000, reason = '') {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(data: string) {
    this.sent.push(data);
  }
}

async function flushSocketOpen() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useConversationsLiveUpdates', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
    MockWebSocket.instances = [];
    vi.clearAllMocks();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }

  it('opens one socket on mount when enabled', async () => {
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

  it('does not open a socket when enabled is false', () => {
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

  it('does not open additional sockets on rerender with unstable callbacks', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const { rerender } = renderHook(
      ({ onUnread }) =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
          onUnread,
        }),
      {
        wrapper,
        initialProps: { onUnread: (id: string) => void id },
      },
    );

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    rerender({ onUnread: (id: string) => void `${id}-2` });
    rerender({ onUnread: (id: string) => void `${id}-3` });
    rerender({ onUnread: (id: string) => void `${id}-4` });

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('closes socket on unmount and does not reconnect', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const { unmount } = renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );

    await flushSocketOpen();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];
    unmount();
    expect(ws.closed).toBe(true);

    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('reconnects after abnormal close', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );

    await flushSocketOpen();
    expect(MockWebSocket.instances.length).toBe(1);
    const first = MockWebSocket.instances[0];

    act(() => {
      first.close(1006, 'abnormal');
    });

    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
  });

  it('manual reconnect opens a new socket', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const { result } = renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );

    await flushSocketOpen();
    act(() => {
      result.current.reconnect();
    });
    await flushSocketOpen();
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('responds to server ping with pong', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );

    await flushSocketOpen();
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'ping', occurredAt: new Date().toISOString() }),
      });
    });

    expect(ws.sent.some((s) => s.includes('pong'))).toBe(true);
  });

  it('closes and reconnects after missed heartbeat', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    renderHook(
      () =>
        useConversationsLiveUpdates({
          enabled: true,
          selectedConversationId: null,
        }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];

    await act(async () => {
      vi.advanceTimersByTime(76_000);
    });

    expect(ws.closed).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(MockWebSocket.instances.length).toBe(2);
  });
});
