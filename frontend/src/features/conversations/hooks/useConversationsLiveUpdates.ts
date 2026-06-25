import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resolveWebSocketOrigin } from '../../../utils/apiOrigin';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import { applyConversationLiveEvent } from '../utils/applyConversationLiveEvent';

export type LiveConnectionStatus = 'live' | 'reconnecting' | 'manual' | 'disconnected';

const DEV_LOG = import.meta.env.DEV;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const LIVE_WS_PATH = '/api/conversations/live';

function devLog(...args: unknown[]) {
  if (DEV_LOG) console.log('[conversations-live]', ...args);
}

function backoffWithJitter(baseMs: number): number {
  const jitter = Math.floor(Math.random() * 250);
  return baseMs + jitter;
}

export interface ConversationLiveCallbacks {
  onUnread?: (conversationId: string) => void;
  onNewConversation?: (conversationId: string) => void;
  onHandoffWaiting?: (conversationId: string) => void;
  onLiveEvent?: (event: ConversationLiveEvent) => void;
}

export interface UseConversationsLiveUpdatesOptions {
  enabled: boolean;
  selectedConversationId: string | null;
  onUnread?: (conversationId: string) => void;
  onNewConversation?: (conversationId: string) => void;
  onHandoffWaiting?: (conversationId: string) => void;
  onLiveEvent?: (event: ConversationLiveEvent) => void;
}

export function useConversationsLiveUpdates({
  enabled,
  selectedConversationId,
  onUnread,
  onNewConversation,
  onHandoffWaiting,
  onLiveEvent,
}: UseConversationsLiveUpdatesOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveConnectionStatus>('manual');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const selectedIdRef = useRef(selectedConversationId);
  const lastHeartbeatAtRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const callbacksRef = useRef<ConversationLiveCallbacks>({});

  callbacksRef.current = { onUnread, onNewConversation, onHandoffWaiting, onLiveEvent };

  useEffect(() => {
    selectedIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(
    (reason = 'component_unmount') => {
      clearReconnectTimer();
      clearHeartbeatTimer();
      const ws = socketRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          intentionalCloseRef.current = true;
          ws.close(1000, reason);
        }
        socketRef.current = null;
        devLog('disconnected', reason);
      }
    },
    [clearReconnectTimer, clearHeartbeatTimer],
  );

  const touchHeartbeat = useCallback(() => {
    lastHeartbeatAtRef.current = Date.now();
  }, []);

  const startHeartbeat = useCallback(
    (ws: WebSocket) => {
      clearHeartbeatTimer();
      touchHeartbeat();
      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const elapsed = Date.now() - lastHeartbeatAtRef.current;
        if (elapsed > HEARTBEAT_TIMEOUT_MS) {
          devLog('heartbeat timeout, closing socket');
          ws.close(4000, 'heartbeat_timeout');
          return;
        }
        try {
          ws.send(JSON.stringify({ type: 'ping', occurredAt: new Date().toISOString() }));
        } catch {
          devLog('heartbeat send failed');
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    [clearHeartbeatTimer, touchHeartbeat],
  );

  const dispatchEvent = useCallback(
    (event: ConversationLiveEvent) => {
      if (event.type === 'ping' || event.type === 'pong') return;

      if (event.type === 'connected') {
        setStatus('live');
        return;
      }

      const { unreadConversationId, newConversationId, handoffConversationId } =
        applyConversationLiveEvent(queryClient, event, selectedIdRef.current);

      const cb = callbacksRef.current;
      if (unreadConversationId) cb.onUnread?.(unreadConversationId);
      if (newConversationId) cb.onNewConversation?.(newConversationId);
      if (handoffConversationId) cb.onHandoffWaiting?.(handoffConversationId);
      cb.onLiveEvent?.(event);
    },
    [queryClient],
  );

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !enabled || intentionalCloseRef.current) return;
    setStatus('reconnecting');
    const delay = backoffWithJitter(backoffRef.current);
    reconnectAttemptRef.current += 1;
    devLog('reconnect scheduled', {
      attempt: reconnectAttemptRef.current,
      delayMs: delay,
    });
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && enabled && !intentionalCloseRef.current) {
        connectRef.current();
      }
    }, delay);
  }, [enabled, clearReconnectTimer]);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    const existing = socketRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      devLog('skip connect, socket already active', existing.readyState);
      return;
    }

    intentionalCloseRef.current = false;
    clearReconnectTimer();
    clearHeartbeatTimer();

    const url = `${resolveWebSocketOrigin()}${LIVE_WS_PATH}`;
    devLog('connecting', url);
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current || !enabled || intentionalCloseRef.current) {
        ws.close(1000, 'stale_connect');
        return;
      }
      backoffRef.current = INITIAL_BACKOFF_MS;
      reconnectAttemptRef.current = 0;
      setStatus('live');
      touchHeartbeat();
      startHeartbeat(ws);
      devLog('connected');
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as ConversationLiveEvent & { type: string };
        if (parsed.type === 'ping') {
          touchHeartbeat();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', occurredAt: new Date().toISOString() }));
          }
          return;
        }
        if (parsed.type === 'pong') {
          touchHeartbeat();
          return;
        }
        touchHeartbeat();
        dispatchEvent(parsed);
      } catch {
        devLog('invalid message');
      }
    };

    ws.onerror = () => {
      devLog('error');
    };

    ws.onclose = (ev) => {
      clearHeartbeatTimer();
      if (socketRef.current === ws) socketRef.current = null;

      if (intentionalCloseRef.current || !mountedRef.current || !enabled) {
        setStatus('manual');
        devLog('closed intentionally', ev.code, ev.reason);
        return;
      }

      if (ev.code === 1008 || ev.code === 4001) {
        setStatus('disconnected');
        devLog('auth closed, no reconnect');
        return;
      }

      backoffRef.current = Math.min(
        backoffRef.current <= 0 ? INITIAL_BACKOFF_MS : backoffRef.current * 2,
        MAX_BACKOFF_MS,
      );
      scheduleReconnect();
    };
  }, [
    enabled,
    clearReconnectTimer,
    clearHeartbeatTimer,
    dispatchEvent,
    scheduleReconnect,
    startHeartbeat,
    touchHeartbeat,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    intentionalCloseRef.current = false;

    if (enabled) {
      connectRef.current();
    } else {
      closeSocket('disabled');
      queueMicrotask(() => setStatus('manual'));
    }

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      closeSocket('component_unmount');
      queueMicrotask(() => setStatus('manual'));
    };
    // Only reconnect when enabled toggles — not when callback identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const onOnline = () => {
      if (!enabled || intentionalCloseRef.current) return;
      const ws = socketRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        devLog('browser online, reconnecting');
        backoffRef.current = INITIAL_BACKOFF_MS;
        connectRef.current();
      }
    };

    const onOffline = () => {
      devLog('browser offline');
      clearReconnectTimer();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, clearReconnectTimer]);

  const markManual = useCallback(() => {
    setStatus('manual');
  }, []);

  const reconnect = useCallback(() => {
    intentionalCloseRef.current = false;
    backoffRef.current = INITIAL_BACKOFF_MS;
    closeSocket('manual_reconnect');
    connectRef.current();
  }, [closeSocket]);

  return { status, markManual, reconnect };
}
