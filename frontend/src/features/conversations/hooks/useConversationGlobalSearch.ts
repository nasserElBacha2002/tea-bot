import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '../api/conversationsApi';
import type {
  ConversationSearchContactHit,
  ConversationGlobalSearchResponse,
  ConversationSearchMessageHit,
} from '../types/conversation.types';

const DEBOUNCE_MS = 300;

export const conversationSearchKeys = {
  global: (q: string) => ['conversations', 'search', 'global', q] as const,
  contacts: (q: string) => ['conversations', 'search', 'global', q, 'contacts'] as const,
  messages: (q: string) => ['conversations', 'search', 'global', q, 'messages'] as const,
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function dedupeContacts(items: ConversationSearchContactHit[]): ConversationSearchContactHit[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.conversationId)) return false;
    seen.add(item.conversationId);
    return true;
  });
}

function dedupeMessages(items: ConversationSearchMessageHit[]): ConversationSearchMessageHit[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.messageId)) return false;
    seen.add(item.messageId);
    return true;
  });
}

export function useConversationGlobalSearch(searchTerm: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const trimmedTerm = searchTerm.trim();
  const debouncedQ = useDebouncedValue(trimmedTerm, DEBOUNCE_MS);
  const active = enabled && debouncedQ.length >= 2;
  const pendingNewTerm = trimmedTerm !== debouncedQ;

  const contactsQuery = useInfiniteQuery({
    queryKey: conversationSearchKeys.contacts(debouncedQ),
    enabled: active,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const res = await conversationsApi.searchGlobal(
        {
          q: debouncedQ,
          cursorContact: pageParam,
          groups: 'contacts',
        },
        { signal },
      );
      return res.contacts;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const messagesQuery = useInfiniteQuery({
    queryKey: conversationSearchKeys.messages(debouncedQ),
    enabled: active,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const res = await conversationsApi.searchGlobal(
        {
          q: debouncedQ,
          cursorMessage: pageParam,
          groups: 'messages',
        },
        { signal },
      );
      return res.messages;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const data = useMemo((): ConversationGlobalSearchResponse | undefined => {
    const contactPages = contactsQuery.data?.pages ?? [];
    const messagePages = messagesQuery.data?.pages ?? [];
    if (contactPages.length === 0 && messagePages.length === 0) return undefined;
    const lastContacts = contactPages[contactPages.length - 1];
    const lastMessages = messagePages[messagePages.length - 1];
    return {
      contacts: {
        items: dedupeContacts(contactPages.flatMap((p) => p.items)),
        nextCursor: lastContacts?.nextCursor ?? null,
      },
      messages: {
        items: dedupeMessages(messagePages.flatMap((p) => p.items)),
        nextCursor: lastMessages?.nextCursor ?? null,
      },
    };
  }, [contactsQuery.data, messagesQuery.data]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['conversations', 'search', 'global'] });
  }, [queryClient]);

  const loading = active && (
    pendingNewTerm
    || contactsQuery.isFetching
    || messagesQuery.isFetching
  );

  const loadMoreContacts = useCallback(() => {
    if (contactsQuery.isFetchingNextPage || !data?.contacts.nextCursor) return;
    void contactsQuery.fetchNextPage();
  }, [contactsQuery, data?.contacts.nextCursor]);

  const loadMoreMessages = useCallback(() => {
    if (messagesQuery.isFetchingNextPage || !data?.messages.nextCursor) return;
    void messagesQuery.fetchNextPage();
  }, [messagesQuery, data?.messages.nextCursor]);

  const error = contactsQuery.error ?? messagesQuery.error;

  const refetch = useCallback(async () => {
    await Promise.all([contactsQuery.refetch(), messagesQuery.refetch()]);
  }, [contactsQuery, messagesQuery]);

  const staleResults = pendingNewTerm
    || contactsQuery.isFetching
    || messagesQuery.isFetching;

  const safeData = staleResults ? undefined : data;

  return useMemo(
    () => ({
      active,
      debouncedQ,
      resultsTerm: debouncedQ,
      pendingNewTerm,
      loading,
      error,
      data: safeData,
      refetch,
      invalidate,
      loadMoreContacts,
      loadMoreMessages,
    }),
    [
      active,
      debouncedQ,
      pendingNewTerm,
      loading,
      error,
      safeData,
      refetch,
      invalidate,
      loadMoreContacts,
      loadMoreMessages,
    ],
  );
}