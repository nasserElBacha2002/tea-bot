import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Paper, Stack, Typography, Alert, Chip, Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { ConversationFilters } from '../components/ConversationFilters';
import { ConversationList } from '../components/ConversationList';
import { ConversationDetail } from '../components/ConversationDetail';
import { ConversationPersistenceAlert } from '../components/ConversationPersistenceAlert';
import { ConversationLiveIndicator } from '../components/ConversationLiveIndicator';
import {
  useConversations,
  useConversationDetail,
  useConversationMessages,
  useRefreshConversations,
  useClaimConversation,
  useSendAgentMessage,
  useCloseConversation,
  useUpdateContact,
} from '../hooks/useConversations';
import { DEFAULT_CONVERSATION_CHANNEL, resolveChannelForApi } from '../constants/conversationChannels';
import { useConversationLive } from '../context/conversationLiveContext';
import { useConversationLiveHandlers } from '../hooks/useConversationLiveHandlers';
import { useConversationReadState } from '../hooks/useConversationReadState';
import type { ConversationListFilters } from '../types/conversation.types';
import { extractApiError } from '../../../utils/apiError';
import { authApi } from '../../auth/api/authApi';
import { isConversationDerivedUnread } from '../utils/conversationUnread';
import { APP_SHELL_CONTENT_HEIGHT } from '../../../components/layout/appShellLayout';

export const ConversationsPage: React.FC = () => {
  const [filters, setFilters] = useState<ConversationListFilters>({
    limit: 50,
    offset: 0,
    sort: 'last_message_at_desc',
    channel: DEFAULT_CONVERSATION_CHANNEL,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [newConversationIds, setNewConversationIds] = useState<Set<string>>(() => new Set());
  const [hiddenByFilterCount, setHiddenByFilterCount] = useState(0);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60_000,
  });
  const currentAgentId = meQuery.data?.user?.agentId ?? null;
  const { markRead, getReadAt, readMap } = useConversationReadState(currentAgentId);

  const listQuery = useConversations(filters);
  const detailQuery = useConversationDetail(selectedId);
  const messagesQuery = useConversationMessages(selectedId);
  const refresh = useRefreshConversations();
  const claimMutation = useClaimConversation(filters);
  const sendMutation = useSendAgentMessage(filters);
  const closeMutation = useCloseConversation(filters);
  const updateContactMutation = useUpdateContact(filters);

  const listItems = listQuery.data?.items ?? [];
  const listIdSet = useMemo(() => new Set(listItems.map((i) => i.id)), [listItems]);

  const clearUnreadFor = useCallback(
    (id: string, readThroughAt?: string) => {
      markRead(id, readThroughAt);
      setUnreadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setUnreadCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setNewConversationIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [markRead],
  );

  const bumpUnread = useCallback(
    (conversationId: string) => {
      if (selectedId === conversationId) return;
      if (!listIdSet.has(conversationId)) {
        setHiddenByFilterCount((n) => n + 1);
        return;
      }
      setUnreadIds((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
      setUnreadCounts((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] ?? 0) + 1,
      }));
    },
    [listIdSet, selectedId],
  );

  const markNewConversation = useCallback(
    (conversationId: string) => {
      if (!listIdSet.has(conversationId)) {
        setHiddenByFilterCount((n) => n + 1);
        return;
      }
      setNewConversationIds((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
    },
    [listIdSet],
  );

  const markHandoffWaiting = useCallback(
    (conversationId: string) => {
      if (selectedId === conversationId) return;
      if (!listIdSet.has(conversationId)) {
        setHiddenByFilterCount((n) => n + 1);
        return;
      }
      setNewConversationIds((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
      setUnreadIds((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
    },
    [listIdSet, selectedId],
  );

  const handleConversationCaughtUp = useCallback(
    (readThroughAt: string) => {
      if (!selectedId) return;
      clearUnreadFor(selectedId, readThroughAt);
    },
    [selectedId, clearUnreadFor],
  );

  const { status: liveStatus, markManual, setSelectedConversationId } = useConversationLive();

  useEffect(() => {
    setSelectedConversationId(selectedId);
  }, [selectedId, setSelectedConversationId]);

  useConversationLiveHandlers({
    onUnread: bumpUnread,
    onNewConversation: markNewConversation,
    onHandoffWaiting: markHandoffWaiting,
  });

  const stableFilters = useMemo(() => filters, [
    filters.status,
    filters.channel,
    filters.search,
    filters.limit,
    filters.offset,
    filters.sort,
  ]);

  const handleFilterChange = (patch: Partial<ConversationListFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch, offset: 0 }));
    setHiddenByFilterCount(0);
  };

  const handleRefresh = async () => {
    markManual();
    await refresh(selectedId);
    await listQuery.refetch();
    if (selectedId) {
      await detailQuery.refetch();
      await messagesQuery.refetch();
    }
  };

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setActionError(null);
    setSuccessMessage(null);
  };

  const selectedReadAt = selectedId ? getReadAt(selectedId) : null;

  const derivedUnreadIds = useMemo(() => {
    const next = new Set(unreadIds);
    for (const item of listItems) {
      if (item.status === 'closed') continue;
      if (selectedId === item.id) continue;
      if ((unreadCounts[item.id] ?? 0) > 0 || unreadIds.has(item.id)) {
        next.add(item.id);
        continue;
      }
      if (isConversationDerivedUnread(item, getReadAt(item.id))) {
        next.add(item.id);
      }
    }
    return next;
  }, [listItems, unreadIds, unreadCounts, selectedId, getReadAt, readMap]);

  const globalUnread = useMemo(() => {
    let unread = 0;
    let waiting = 0;
    for (const item of listItems) {
      const count = unreadCounts[item.id] ?? 0;
      const isUnread =
        count > 0 || derivedUnreadIds.has(item.id) || newConversationIds.has(item.id);
      if (!isUnread || item.status === 'closed') continue;
      unread += count > 0 ? count : 1;
      if (item.status === 'waiting_human') waiting += 1;
    }
    return { unread, waiting };
  }, [listItems, unreadCounts, derivedUnreadIds, newConversationIds]);

  const listApiError = listQuery.isError ? extractApiError(listQuery.error) : null;
  const persistenceFailure =
    listApiError != null
    && (listApiError.code === 'CONVERSATION_PERSISTENCE_UNAVAILABLE'
      || listApiError.code === 'DB_CONNECTION_FAILED'
      || listApiError.code === 'DB_ENV_MISSING'
      || listApiError.status === 503);

  const listError =
    listQuery.isError && !persistenceFailure
      ? listQuery.error instanceof Error
        ? listQuery.error.message
        : 'Error al cargar conversaciones'
      : null;

  const detailError =
    detailQuery.isError
      ? detailQuery.error instanceof Error
        ? detailQuery.error.message
        : 'Error al cargar detalle'
      : null;

  const messagesError =
    messagesQuery.isError
      ? messagesQuery.error instanceof Error
        ? messagesQuery.error.message
        : 'Error al cargar mensajes'
      : null;

  const runAction = async (fn: () => Promise<unknown>, success: string) => {
    setActionError(null);
    setSuccessMessage(null);
    try {
      await fn();
      setSuccessMessage(success);
      await handleRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error en la operación');
    }
  };

  const hasActiveFilters = Boolean(
    filters.status
    || resolveChannelForApi(filters.channel) !== DEFAULT_CONVERSATION_CHANNEL
    || filters.search?.trim(),
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: APP_SHELL_CONTENT_HEIGHT,
        maxHeight: APP_SHELL_CONTENT_HEIGHT,
        overflow: 'hidden',
        p: 2,
        boxSizing: 'border-box',
        bgcolor: 'background.default',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1, flexShrink: 0 }}
        flexWrap="wrap"
      >
        <Typography variant="h5" fontWeight={800}>
          Conversaciones
        </Typography>
        <ConversationLiveIndicator status={liveStatus} />
        {globalUnread.unread > 0 && (
          <Chip
            size="small"
            color="primary"
            label={`${globalUnread.unread} sin leer`}
            aria-label={`${globalUnread.unread} conversaciones sin leer`}
          />
        )}
        {globalUnread.waiting > 0 && (
          <Chip
            size="small"
            color="error"
            variant="outlined"
            label={`${globalUnread.waiting} esperando atención`}
          />
        )}
      </Stack>

      {hiddenByFilterCount > 0 && hasActiveFilters && (
        <Alert
          severity="info"
          sx={{ mb: 1, flexShrink: 0 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() =>
                handleFilterChange({
                  status: undefined,
                  channel: DEFAULT_CONVERSATION_CHANNEL,
                  search: '',
                })
              }
            >
              Limpiar filtros
            </Button>
          }
        >
          Hay actividad nueva en conversaciones fuera de los filtros actuales.
        </Alert>
      )}

      {persistenceFailure && (
        <ConversationPersistenceAlert
          error={listQuery.error}
          onRetry={() => void handleRefresh()}
          retrying={listQuery.isFetching}
        />
      )}

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: { xs: '100%', md: 380 },
            maxWidth: '100%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: { md: '1px solid' },
            borderColor: 'divider',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <ConversationFilters
            filters={stableFilters}
            onChange={handleFilterChange}
            onRefresh={handleRefresh}
            refreshing={listQuery.isFetching}
          />
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ConversationList
              conversations={listItems}
              selectedId={selectedId}
              unreadIds={derivedUnreadIds}
              unreadCounts={unreadCounts}
              newConversationIds={newConversationIds}
              onSelect={handleSelectConversation}
              loading={listQuery.isLoading && !persistenceFailure}
              error={listError}
            />
          </Box>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: { xs: selectedId ? 'flex' : 'none', md: 'flex' },
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <ConversationDetail
            detail={detailQuery.data}
            messages={messagesQuery.data?.items ?? []}
            conversationId={selectedId}
            readAt={selectedReadAt}
            onCaughtUp={handleConversationCaughtUp}
            currentAgentId={currentAgentId}
            loadingDetail={detailQuery.isLoading && Boolean(selectedId)}
            loadingMessages={messagesQuery.isLoading && Boolean(selectedId)}
            detailError={detailError}
            messagesError={messagesError}
            sending={sendMutation.isPending}
            claiming={claimMutation.isPending}
            closing={closeMutation.isPending}
            savingContact={updateContactMutation.isPending}
            contactError={
              updateContactMutation.isError
                ? extractApiError(updateContactMutation.error).message
                : null
            }
            actionError={actionError}
            successMessage={successMessage}
            onSend={(body) =>
              runAction(
                () => sendMutation.mutateAsync({ conversationId: selectedId!, body }),
                'Mensaje enviado correctamente.',
              )
            }
            onClaim={() =>
              runAction(
                () => claimMutation.mutateAsync(selectedId!),
                'Conversación tomada correctamente.',
              )
            }
            onClose={() =>
              runAction(
                () => closeMutation.mutateAsync({ conversationId: selectedId! }),
                'Conversación cerrada correctamente.',
              )
            }
            onUpdateContact={(name) =>
              runAction(
                () => updateContactMutation.mutateAsync({ conversationId: selectedId!, name }),
                'Nombre del contacto actualizado.',
              )
            }
          />
        </Box>
      </Paper>
    </Box>
  );
};
