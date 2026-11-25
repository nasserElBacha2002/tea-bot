// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { HISTORY_MAX_ITEMS, useConversationMessagePane } from './useConversationMessagePane';

const getMessages = vi.fn();

vi.mock('../api/conversationsApi', () => ({
  conversationsApi: {
    getMessages: (...args: unknown[]) => getMessages(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

const tail200 = Array.from({ length: 200 }, (_, i) => ({
  id: `m-${i}`,
  conversationId: 'c1',
  body: `msg ${i}`,
  createdAt: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
  direction: 'inbound' as const,
  senderType: 'user' as const,
  provider: 'internal',
  providerMessageId: null,
  metadata: null,
}));

describe('useConversationMessagePane', () => {
  beforeEach(() => {
    getMessages.mockReset();
    getMessages.mockImplementation(async (_id, opts) => {
      if (opts?.tail === '1') {
        return { items: tail200, hasMoreBefore: true, mode: 'tail', limit: 200 };
      }
      if (opts?.beforeMessageId) {
        return {
          items: [{ id: 'm-old', conversationId: 'c1', body: 'old', createdAt: '2025-12-31T23:59:00.000Z', direction: 'inbound', senderType: 'user', provider: 'internal', providerMessageId: null, metadata: null }],
          hasMoreBefore: false,
          mode: 'before',
        };
      }
      return { items: [], hasMoreBefore: false, hasMoreAfter: false, mode: 'around' };
    });
  });

  it('carga tail inicial', async () => {
    const { result } = renderHook(() => useConversationMessagePane('11111111-1111-4111-8111-111111111111'), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(200));
  });

  it('returnToRecent reemplaza historial extendido por tail de 200', async () => {
    const { result } = renderHook(() => useConversationMessagePane('11111111-1111-4111-8111-111111111111'), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(200));
    await act(async () => { await result.current.loadOlder(); });
    await waitFor(() => expect(result.current.items.length).toBe(201));
    await act(async () => { await result.current.returnToRecent(); });
    await waitFor(() => expect(result.current.items.length).toBe(200));
    expect(result.current.historyPinned).toBe(false);
  });

  it('descarta jump obsoleto por requestId', async () => {
    getMessages
      .mockResolvedValueOnce({ items: tail200.slice(0, 1), hasMoreBefore: false, mode: 'tail', limit: 200 })
      .mockResolvedValueOnce({
        items: [{ id: 'm-target', conversationId: 'c1', body: 'x', createdAt: '2026-01-02T00:00:00.000Z', direction: 'inbound', senderType: 'user', provider: 'internal', providerMessageId: null, metadata: null }],
        hasMoreBefore: false,
        focusMessageId: 'm-target',
        hasMoreAfter: false,
        mode: 'around',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'm-other', conversationId: 'c1', body: 'y', createdAt: '2026-01-03T00:00:00.000Z', direction: 'inbound', senderType: 'user', provider: 'internal', providerMessageId: null, metadata: null }],
        hasMoreBefore: false,
        focusMessageId: 'm-other',
        hasMoreAfter: false,
        mode: 'around',
      });
    const { result } = renderHook(() => useConversationMessagePane('11111111-1111-4111-8111-111111111111'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    void result.current.jumpToMessage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', undefined, 'hola', 1);
    void result.current.jumpToMessage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', undefined, 'hola', 2);
    await waitFor(() => expect(result.current.scrollTargetMessageId).toBe('m-other'));
  });

  it('loadOlder preserva página antigua al superar límite de memoria', async () => {
    const many = Array.from({ length: HISTORY_MAX_ITEMS }, (_, i) => ({
      id: `bulk-${i}`,
      conversationId: 'c1',
      body: `b ${i}`,
      createdAt: `2025-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      direction: 'inbound' as const,
      senderType: 'user' as const,
      provider: 'internal',
      providerMessageId: null,
      metadata: null,
    }));
    getMessages.mockImplementation(async (_id, opts) => {
      if (opts?.tail === '1') {
        return { items: many, hasMoreBefore: true, mode: 'tail', limit: 200 };
      }
      if (opts?.beforeMessageId) {
        return {
          items: [{
            id: 'm-old',
            conversationId: 'c1',
            body: 'old',
            createdAt: '2024-12-31T23:59:00.000Z',
            direction: 'inbound',
            senderType: 'user',
            provider: 'internal',
            providerMessageId: null,
            metadata: null,
          }],
          hasMoreBefore: false,
          mode: 'before',
        };
      }
      return { items: [], hasMoreBefore: false, mode: 'tail', limit: 200 };
    });
    const { result } = renderHook(() => useConversationMessagePane('11111111-1111-4111-8111-111111111111'), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(HISTORY_MAX_ITEMS));
    await act(async () => { await result.current.loadOlder(); });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('m-old'));
    expect(result.current.items.length).toBe(HISTORY_MAX_ITEMS);
  });

  it('patchLiveMessage actualiza mensaje visible en ventana histórica', async () => {
    getMessages
      .mockResolvedValueOnce({ items: tail200.slice(0, 1), hasMoreBefore: false, mode: 'tail', limit: 200 })
      .mockResolvedValueOnce({
        items: [{
          id: 'm-visible',
          conversationId: 'c1',
          body: 'ver',
          createdAt: '2026-01-02T00:00:00.000Z',
          direction: 'outbound',
          senderType: 'agent',
          provider: 'internal',
          providerMessageId: null,
          metadata: null,
          whatsappDelivery: { status: 'sent' },
        }],
        hasMoreBefore: false,
        focusMessageId: 'm-visible',
        hasMoreAfter: false,
        mode: 'around',
      });
    const { result } = renderHook(() => useConversationMessagePane('11111111-1111-4111-8111-111111111111'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.jumpToMessage('m-visible', undefined, '', 1);
    });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('m-visible'));
    act(() => {
      result.current.patchLiveMessage({
        id: 'm-visible',
        conversationId: 'c1',
        body: 'ver',
        createdAt: '2026-01-02T00:00:00.000Z',
        direction: 'outbound',
        senderType: 'agent',
        provider: 'internal',
        providerMessageId: null,
        metadata: null,
        whatsappDelivery: { status: 'delivered' },
      });
    });
    expect(result.current.items.find((m) => m.id === 'm-visible')?.whatsappDelivery?.status).toBe('delivered');
  });
});