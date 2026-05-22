import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resolveWebSocketOrigin } from '../../../utils/apiOrigin';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import { applyConversationLiveEvent } from '../utils/applyConversationLiveEvent';

export type LiveConnectionStatus = 'live' | 'reconnecting' | 'manual' | 'disconnected';

const DEV_LOG = import.meta.env.DEV;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

function devLog(...args: unknown[]) {
  if (DEV_LOG) console.log('[conversations-live]', ...args);
}

export interface UseConversationsLiveUpdatesOptions {
  enabled: boolean;
  selectedConversationId: string | null;
  onUnread?: (conversationId: string) => void;
  onNewConversation?: (conversationId: string) => void;
}

export function useConversationsLiveUpdates({
  enabled,
  selectedConversationId,
  onUnread,
  onNewConversation,
}: UseConversationsLiveUpdatesOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveConnectionStatus>('manual');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const mountedRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});
  const selectedIdRef = useRef(selectedConversationId);

  useEffect(() => {
    selectedIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearReconnectTimer();
    const ws = socketRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'component_unmount');
      }
      socketRef.current = null;
      devLog('disconnected');
    }
  }, [clearReconnectTimer]);

  const handleEvent = useCallback(
    (event: ConversationLiveEvent) => {
      if (event.type === 'connected') {
        setStatus('live');
        return;
      }
      const { unreadConversationId, newConversationId } = applyConversationLiveEvent(
        queryClient,
        event,
        selectedIdRef.current,
      );
      if (unreadConversationId) onUnread?.(unreadConversationId);
      if (newConversationId) onNewConversation?.(newConversationId);
    },
    [queryClient, onUnread, onNewConversation],
  );

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;
    closeSocket();

    const url = `${resolveWebSocketOrigin()}/api/conversations/live`;
    devLog('connecting', url);
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current || !enabled) {
        ws.close();
        return;
      }
      backoffRef.current = INITIAL_BACKOFF_MS;
      setStatus('live');
      devLog('connected');
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as ConversationLiveEvent;
        handleEvent(parsed);
      } catch {
        devLog('invalid message');
      }
    };

    ws.onerror = () => {
      devLog('error');
    };

    ws.onclose = (ev) => {
      if (socketRef.current === ws) socketRef.current = null;
      if (!mountedRef.current || !enabled) {
        setStatus('manual');
        devLog('cleanup');
        return;
      }
      if (ev.code === 1000 && ev.reason === 'component_unmount') {
        setStatus('manual');
        return;
      }
      if (ev.code === 1008 || ev.code === 4001) {
        setStatus('disconnected');
        devLog('auth closed, no reconnect');
        return;
      }
      setStatus('reconnecting');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      devLog('reconnect scheduled', delay);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && enabled) connectRef.current();
      }, delay);
    };
  }, [enabled, closeSocket, handleEvent, clearReconnectTimer]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      connect();
    } else {
      closeSocket();
      queueMicrotask(() => setStatus('manual'));
    }
    return () => {
      mountedRef.current = false;
      devLog('cleanup');
      closeSocket();
      queueMicrotask(() => setStatus('manual'));
    };
  }, [enabled, connect, closeSocket]);

  const markManual = useCallback(() => {
    setStatus('manual');
  }, []);

  return { status, markManual, reconnect: connect };
}
