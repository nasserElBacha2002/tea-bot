import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '../api/conversationsApi';
import type { ConversationMessage } from '../types/conversation.types';
import { conversationKeys } from './useConversations';
import { extractApiError } from '../../../utils/apiError';

type HistoryView = 'recent' | 'recent_extended' | 'anchored';

export const HISTORY_MAX_ITEMS = 3000;

/** Orden cronológico aproximado: el servidor ya ordena por created_at + UNIQUEIDENTIFIER. */
function compareMessagesLoose(a: ConversationMessage, b: ConversationMessage): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

function mergeOrderedUnique(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
  edge: 'prepend' | 'append',
): { items: ConversationMessage[]; trimmed: boolean } {
  const map = new Map<string, ConversationMessage>();
  for (const msg of [...current, ...incoming]) {
    map.set(msg.id, msg);
  }
  let items = [...map.values()].sort(compareMessagesLoose);
  if (items.length <= HISTORY_MAX_ITEMS) return { items, trimmed: false };
  if (edge === 'prepend') {
    items = items.slice(0, HISTORY_MAX_ITEMS);
  } else {
    items = items.slice(-HISTORY_MAX_ITEMS);
  }
  return { items, trimmed: true };
}

function mergeChronological(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
  edge: 'prepend' | 'append',
): ConversationMessage[] {
  return mergeOrderedUnique(current, incoming, edge).items;
}

function mergeMessageUpdate(
  items: ConversationMessage[],
  message: ConversationMessage,
): ConversationMessage[] {
  const idx = items.findIndex((m) => m.id === message.id);
  if (idx < 0) return items;
  return items.map((m) => (
    m.id === message.id
      ? {
          ...m,
          ...message,
          attachments: message.attachments ?? m.attachments,
          dispatch: Object.prototype.hasOwnProperty.call(message, 'dispatch')
            ? message.dispatch
            : m.dispatch,
          whatsappDelivery: Object.prototype.hasOwnProperty.call(message, 'whatsappDelivery')
            ? message.whatsappDelivery
            : m.whatsappDelivery,
        }
      : m
  ));
}

export function useConversationMessagePane(conversationId: string | null) {
  const queryClient = useQueryClient();
  const conversationSessionRef = useRef(0);
  const windowGenRef = useRef(0);
  const jumpAbortRef = useRef<AbortController | null>(null);
  const olderAbortRef = useRef<AbortController | null>(null);
  const newerAbortRef = useRef<AbortController | null>(null);
  const jumpRequestIdRef = useRef<number | null>(null);

  const [historyView, setHistoryView] = useState<HistoryView>('recent');
  const [items, setItems] = useState<ConversationMessage[]>([]);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [hasMoreAfter, setHasMoreAfter] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [highlightTerm, setHighlightTerm] = useState('');
  const [scrollTargetMessageId, setScrollTargetMessageId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);

  const cancelInFlight = useCallback(() => {
    jumpAbortRef.current?.abort();
    olderAbortRef.current?.abort();
    newerAbortRef.current?.abort();
    jumpAbortRef.current = null;
    olderAbortRef.current = null;
    newerAbortRef.current = null;
  }, []);

  const invalidateWindow = useCallback(() => {
    windowGenRef.current += 1;
    cancelInFlight();
    return windowGenRef.current;
  }, [cancelInFlight]);

  const tailQuery = useQuery({
    queryKey: [...conversationKeys.messages(conversationId ?? ''), 'tail'],
    queryFn: () => conversationsApi.getMessages(conversationId!, { limit: 200, order: 'asc', tail: '1' }),
    enabled: Boolean(conversationId),
  });

  useEffect(() => {
    conversationSessionRef.current += 1;
    invalidateWindow();
    setHistoryView('recent');
    setItems([]);
    setHasMoreBefore(false);
    setHasMoreAfter(false);
    setHighlightedMessageId(null);
    setHighlightTerm('');
    setScrollTargetMessageId(null);
    setJumpError(null);
    setPaginationError(null);
    setLoadingOlder(false);
    setLoadingNewer(false);
  }, [conversationId, invalidateWindow]);

  useEffect(() => {
    if (!conversationId || !tailQuery.data || historyView !== 'recent') return;
    setItems(tailQuery.data.items);
    setHasMoreBefore(Boolean(tailQuery.data.hasMoreBefore));
    setHasMoreAfter(false);
  }, [conversationId, tailQuery.data, historyView]);

  const loading = tailQuery.isLoading && historyView === 'recent';
  const historyPinned = historyView !== 'recent';

  const consumeScrollTarget = useCallback(() => {
    setScrollTargetMessageId(null);
  }, []);

  const jumpToMessage = useCallback(
    async (
      messageId: string,
      _snippetHighlight?: { start: number; end: number },
      term?: string,
      requestId?: number,
    ) => {
      if (!conversationId) return;
      const conversationSession = conversationSessionRef.current;
      const windowGen = invalidateWindow();
      const controller = new AbortController();
      jumpAbortRef.current = controller;
      setJumpError(null);
      if (requestId != null) jumpRequestIdRef.current = requestId;
      try {
        const data = await conversationsApi.getMessages(
          conversationId,
          { aroundMessageId: messageId, before: 40, after: 40 },
          { signal: controller.signal },
        );
        if (conversationSession !== conversationSessionRef.current) return;
        if (windowGen !== windowGenRef.current) return;
        if (requestId != null && jumpRequestIdRef.current !== requestId) return;
        setItems(data.items);
        setHasMoreBefore(Boolean(data.hasMoreBefore));
        setHasMoreAfter(Boolean(data.hasMoreAfter));
        const focusId = data.focusMessageId ?? messageId;
        setHighlightedMessageId(focusId);
        setHighlightTerm(term?.trim() ?? '');
        setScrollTargetMessageId(focusId);
        setHistoryView('anchored');
      } catch (error) {
        if (controller.signal.aborted || conversationSession !== conversationSessionRef.current) return;
        if (windowGen !== windowGenRef.current) return;
        const info = extractApiError(error);
        setJumpError(info.message || 'No se pudo abrir el mensaje');
        throw error;
      } finally {
        if (jumpAbortRef.current === controller) jumpAbortRef.current = null;
      }
    },
    [conversationId, invalidateWindow],
  );

  const loadOlder = useCallback(async (): Promise<boolean> => {
    if (!conversationId || loadingOlder) return false;
    if (!hasMoreBefore) return false;
    const oldest = items[0];
    if (!oldest) return false;
    const conversationSession = conversationSessionRef.current;
    const windowGen = windowGenRef.current;
    setLoadingOlder(true);
    setPaginationError(null);
    olderAbortRef.current?.abort();
    const controller = new AbortController();
    olderAbortRef.current = controller;
    try {
      const data = await conversationsApi.getMessages(
        conversationId,
        { beforeMessageId: oldest.id, limit: 50 },
        { signal: controller.signal },
      );
      if (conversationSession !== conversationSessionRef.current || windowGen !== windowGenRef.current) {
        return false;
      }
      if (controller.signal.aborted) return false;
      setHistoryView((prev) => (prev === 'recent' ? 'recent_extended' : prev));
      const merged = mergeOrderedUnique(data.items, items, 'prepend');
      setItems(merged.items);
      if (merged.trimmed) setHasMoreAfter(true);
      setHasMoreBefore(Boolean(data.hasMoreBefore));
      return true;
    } catch (error) {
      if (controller.signal.aborted || conversationSession !== conversationSessionRef.current) return false;
      if (windowGen !== windowGenRef.current) return false;
      const info = extractApiError(error);
      setPaginationError(info.message || 'No se pudieron cargar mensajes anteriores');
      return false;
    } finally {
      if (olderAbortRef.current === controller) olderAbortRef.current = null;
      if (conversationSession === conversationSessionRef.current) setLoadingOlder(false);
    }
  }, [conversationId, hasMoreBefore, items, loadingOlder]);

  const loadNewer = useCallback(async (): Promise<boolean> => {
    if (!conversationId || loadingNewer) return false;
    if (!hasMoreAfter) return false;
    const newest = items[items.length - 1];
    if (!newest) return false;
    const conversationSession = conversationSessionRef.current;
    const windowGen = windowGenRef.current;
    setLoadingNewer(true);
    setPaginationError(null);
    newerAbortRef.current?.abort();
    const controller = new AbortController();
    newerAbortRef.current = controller;
    try {
      const data = await conversationsApi.getMessages(
        conversationId,
        { afterMessageId: newest.id, limit: 50 },
        { signal: controller.signal },
      );
      if (conversationSession !== conversationSessionRef.current || windowGen !== windowGenRef.current) {
        return false;
      }
      if (controller.signal.aborted) return false;
      const merged = mergeOrderedUnique(items, data.items, 'append');
      setItems(merged.items);
      if (merged.trimmed) setHasMoreBefore(true);
      setHasMoreAfter(Boolean(data.hasMoreAfter));
      return true;
    } catch (error) {
      if (controller.signal.aborted || conversationSession !== conversationSessionRef.current) return false;
      if (windowGen !== windowGenRef.current) return false;
      const info = extractApiError(error);
      setPaginationError(info.message || 'No se pudieron cargar mensajes posteriores');
      return false;
    } finally {
      if (newerAbortRef.current === controller) newerAbortRef.current = null;
      if (conversationSession === conversationSessionRef.current) setLoadingNewer(false);
    }
  }, [conversationId, hasMoreAfter, items, loadingNewer]);

  const returnToRecent = useCallback(async () => {
    if (!conversationId) return;
    const windowGen = invalidateWindow();
    setHistoryView('recent');
    setHighlightedMessageId(null);
    setHighlightTerm('');
    setScrollTargetMessageId(null);
    setHasMoreAfter(false);
    setJumpError(null);
    setPaginationError(null);
    await queryClient.invalidateQueries({
      queryKey: [...conversationKeys.messages(conversationId), 'tail'],
    });
    const result = await tailQuery.refetch();
    if (windowGen !== windowGenRef.current) return;
    if (result.data) {
      setItems(result.data.items);
      setHasMoreBefore(Boolean(result.data.hasMoreBefore));
      setHasMoreAfter(false);
    }
  }, [conversationId, queryClient, tailQuery, invalidateWindow]);

  const appendLiveMessage = useCallback((message: ConversationMessage) => {
    if (historyView !== 'recent') return;
    setItems((prev) => mergeChronological(prev, [message], 'append'));
  }, [historyView]);

  const patchLiveMessage = useCallback((message: ConversationMessage) => {
    setItems((prev) => mergeMessageUpdate(prev, message));
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlightedMessageId(null);
    setHighlightTerm('');
    setScrollTargetMessageId(null);
  }, []);

  return useMemo(
    () => ({
      items,
      loading,
      error: tailQuery.error
        ?? (jumpError ? new Error(jumpError) : paginationError ? new Error(paginationError) : null),
      hasMoreBefore,
      hasMoreAfter,
      highlightedMessageId,
      highlightTerm,
      scrollTargetMessageId,
      consumeScrollTarget,
      historyPinned,
      mode: historyView === 'anchored' ? 'around' as const : 'tail' as const,
      loadingOlder,
      loadingNewer,
      jumpToMessage,
      loadOlder,
      loadNewer,
      returnToRecent,
      appendLiveMessage,
      patchLiveMessage,
      clearHighlights,
      cancelInFlight,
      refetchTail: tailQuery.refetch,
    }),
    [
      items,
      loading,
      tailQuery.error,
      jumpError,
      paginationError,
      hasMoreBefore,
      hasMoreAfter,
      highlightedMessageId,
      highlightTerm,
      scrollTargetMessageId,
      consumeScrollTarget,
      historyPinned,
      historyView,
      loadingOlder,
      loadingNewer,
      jumpToMessage,
      loadOlder,
      loadNewer,
      returnToRecent,
      appendLiveMessage,
      patchLiveMessage,
      clearHighlights,
      cancelInFlight,
      tailQuery.refetch,
    ],
  );
}