import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Snackbar, Alert, Button } from '@mui/material';
import { authApi } from '../../auth/api/authApi';
import { useAuthUser } from '../../auth/context/AuthContext';
import { canAccessConversations } from '../../auth/utils/authPermissions';
import { useConversationsLiveUpdates } from '../hooks/useConversationsLiveUpdates';
import { useConversationAlerts } from '../hooks/useConversationAlerts';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import {
  ConversationLiveContext,
  type ConversationLiveContextValue,
  type ConversationLiveHandlers,
} from './conversationLiveContext';

export function ConversationLiveProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  const canListen = canAccessConversations(user?.role);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const handlersRef = useRef<ConversationLiveHandlers>({});

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    enabled: canListen,
    staleTime: 5 * 60_000,
  });

  const userContext = useMemo(
    () => ({
      currentAgentId: meQuery.data?.user?.agentId ?? null,
      operatorUsername: meQuery.data?.user?.username ?? user?.username ?? null,
    }),
    [meQuery.data?.user?.agentId, meQuery.data?.user?.username, user?.username],
  );

  const alerts = useConversationAlerts({
    enabled: canListen,
    userContext,
  });

  const registerHandlers = useCallback((handlers: ConversationLiveHandlers) => {
    handlersRef.current = handlers;
    return () => {
      if (handlersRef.current === handlers) handlersRef.current = {};
    };
  }, []);

  const onLiveEvent = useCallback(
    (event: ConversationLiveEvent) => {
      void alerts.processEvent(event);
    },
    [alerts],
  );

  const { status, markManual, reconnect } = useConversationsLiveUpdates({
    enabled: canListen,
    selectedConversationId,
    onUnread: (id) => handlersRef.current.onUnread?.(id),
    onNewConversation: (id) => handlersRef.current.onNewConversation?.(id),
    onHandoffWaiting: (id) => handlersRef.current.onHandoffWaiting?.(id),
    onLiveEvent,
  });

  const value = useMemo<ConversationLiveContextValue>(
    () => ({
      status,
      markManual,
      reconnect,
      setSelectedConversationId,
      registerHandlers,
      soundAlertsEnabled: alerts.soundEnabled,
      setSoundAlertsEnabled: alerts.setSoundEnabled,
      soundBlocked: alerts.soundBlocked,
      unlockSound: alerts.unlockSound,
    }),
    [
      status,
      markManual,
      reconnect,
      registerHandlers,
      alerts.soundEnabled,
      alerts.setSoundEnabled,
      alerts.soundBlocked,
      alerts.unlockSound,
    ],
  );

  return (
    <ConversationLiveContext.Provider value={value}>
      {children}
      {canListen ? (
        <Snackbar
          open={alerts.pendingToast != null}
          autoHideDuration={6000}
          onClose={(_, reason) => {
            if (reason === 'clickaway') return;
            alerts.dismissToast();
          }}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert
            severity="info"
            variant="filled"
            action={
              alerts.soundBlocked ? (
                <Button color="inherit" size="small" onClick={() => void alerts.unlockSound()}>
                  Activar sonido
                </Button>
              ) : (
                <Button color="inherit" size="small" onClick={alerts.dismissToast}>
                  Cerrar
                </Button>
              )
            }
          >
            {alerts.pendingToast?.message ?? 'Nuevo mensaje pendiente de atención.'}
          </Alert>
        </Snackbar>
      ) : null}
    </ConversationLiveContext.Provider>
  );
}
