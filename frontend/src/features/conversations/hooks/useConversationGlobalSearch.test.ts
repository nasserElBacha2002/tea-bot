// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationGlobalSearch } from './useConversationGlobalSearch';

const searchGlobal = vi.fn();

vi.mock('../api/conversationsApi', () => ({
  conversationsApi: {
    searchGlobal: (...args: unknown[]) => searchGlobal(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

function contact(id: string) {
  return { conversationId: id, displayName: id, phoneNumber: null, matchKind: 'name' as const, lastMessageAt: null };
}

function message(id: string) {
  return {
    conversationId: 'c1',
    messageId: id,
    displayName: null,
    phoneNumber: null,
    direction: 'inbound' as const,
    senderType: 'user' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    snippet: 'hola',
    highlightStart: 0,
    highlightEnd: 4,
  };
}

describe('useConversationGlobalSearch', () => {
  beforeEach(() => {
    searchGlobal.mockReset();
    searchGlobal.mockImplementation(async (body: { groups?: string; cursorContact?: string | null }) => {
      if (body.groups === 'messages') {
        return {
          contacts: { items: [], nextCursor: null },
          messages: { items: [message('m1')], nextCursor: null },
        };
      }
      if (body.cursorContact) {
        return {
          contacts: { items: [contact('c3')], nextCursor: null },
          messages: { items: [], nextCursor: null },
        };
      }
      return {
        contacts: { items: [contact('c1'), contact('c2')], nextCursor: 'cur-c' },
        messages: { items: [], nextCursor: null },
      };
    });
  });

  it('acumula contactos en páginas sin perder la primera', async () => {
    const { result } = renderHook(
      () => useConversationGlobalSearch('tea', true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.contacts.items).toHaveLength(2), { timeout: 5000 });
    act(() => { result.current.loadMoreContacts(); });
    await waitFor(() => expect(result.current.data?.contacts.items).toHaveLength(3), { timeout: 5000 });
    expect(result.current.data?.contacts.items.map((c) => c.conversationId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('no expone data mientras el término está en debounce', async () => {
    const { result, rerender } = renderHook(
      ({ q }) => useConversationGlobalSearch(q, true),
      { wrapper, initialProps: { q: 'tea' } },
    );
    await waitFor(() => expect(result.current.data?.contacts.items).toHaveLength(2), { timeout: 5000 });
    rerender({ q: 'teatime' });
    expect(result.current.pendingNewTerm).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('resetea al cambiar término', async () => {
    const { rerender } = renderHook(
      ({ q }) => useConversationGlobalSearch(q, true),
      { wrapper, initialProps: { q: 'tea' } },
    );
    await waitFor(() => expect(searchGlobal.mock.calls.some((c) => c[0]?.q === 'tea')).toBe(true), { timeout: 5000 });
    rerender({ q: 'otro' });
    await waitFor(() => expect(searchGlobal.mock.calls.some((c) => c[0]?.q === 'otro')).toBe(true), { timeout: 5000 });
  });
});