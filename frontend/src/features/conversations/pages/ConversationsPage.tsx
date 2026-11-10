import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Paper, Stack, Typography, Alert, Chip, Button, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
  useTakeoverConversation,
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
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { isConversationDerivedUnread } from '../utils/conversationUnread';
import { conversationUiDensity } from '../constants/conversationUiDensity';
import { useResizableSidebarWidth } from '../hooks/useResizableSidebarWidth';
import { ConversationSidebarResizeHandle } from '../components/ConversationSidebarResizeHandle';

export const ConversationsPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { conversationId: selectedId = null } = useParams<{ conversationId?: string }>();
  const isMobileInbox = useMediaQuery(theme.breakpoints.down('md'));
  const isDesktopInbox = !isMobileInbox;
  const { width: sidebarWidth, minWidth: sidebarMinWidth, maxWidth: sidebarMaxWidth, beginResize, nudgeWidth } =
    useResizableSidebarWidth(isDesktopInbox);
  const [filters, setFilters] = useState<ConversationListFilters>({
    limit: 50,
    offset: 0,
    sort: 'last_message_at_desc',
    channel: DEFAULT_CONVERSATION_CHANNEL,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [newConversationIds, setNewConversationIds] = useState<Set<string>>(() => new Set());
  const [hiddenByFilterCount, setHiddenByFilterCount] = useState(0);

  const { agentId: currentAgentId } = useCurrentAgent();
  const { markRead, getReadAt, readMap } = useConversationReadState(currentAgentId);

  const listQuery = useConversations(filters);
  const detailQuery = useConversationDetail(selectedId);
  const messagesQuery = useConversationMessages(selectedId);
  const refresh = useRefreshConversations();
  const claimMutation = useClaimConversation(filters);
  const takeoverMutation = useTakeoverConversation(filters);
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
    navigate(`/conversations/${id}`);
    setActionError(null);
    setSuccessMessage(null);
  };

  const handleBackToList = () => {
    navigate('/conversations');
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

  const detailErrorInfo = detailQuery.isError ? extractApiError(detailQuery.error) : null;
  const detailError = detailQuery.isError
    ? detailErrorInfo?.status === 404 || detailErrorInfo?.code === 'NOT_FOUND'
      ? 'Conversación no encontrada'
      : detailErrorInfo?.status === 401 || detailErrorInfo?.status === 403
        ? detailErrorInfo.message
        : detailQuery.error instanceof Error
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
      const info = extractApiError(e);
      setActionError(info.message);
      if (
        info.status === 409
        || info.code === 'CONVERSATION_OWNED'
        || info.code === 'STATUS_VERSION_CONFLICT'
        || info.code === 'IDEMPOTENCY_STALE'
      ) {
        await handleRefresh();
      }
    }
  };

  const hasActiveFilters = Boolean(
    filters.status
    || resolveChannelForApi(filters.channel) !== DEFAULT_CONVERSATION_CHANNEL
    || filters.search?.trim(),
  );

  const showSidebar = !(isMobileInbox && selectedId);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          borderRadius: 0,
          border: 'none',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: { xs: '100%', md: sidebarWidth },
            maxWidth: '100%',
            flexShrink: 0,
            height: '100%',
            minHeight: 0,
            display: showSidebar ? 'flex' : 'none',
            flexDirection: 'column',
            borderRight: { md: 'none' },
            borderColor: 'divider',
            minWidth: 0,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
          data-testid="conversation-list-panel"
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            flexWrap="nowrap"
            data-testid="conversation-sidebar-header"
            sx={{
              flexShrink: 0,
              height: conversationUiDensity.sidebarHeaderHeight,
              minHeight: conversationUiDensity.sidebarHeaderHeight,
              maxHeight: conversationUiDensity.sidebarHeaderHeight,
              px: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="subtitle2"
              fontWeight={800}
              noWrap
              sx={{ fontSize: '0.9375rem', lineHeight: 1.2 }}
            >
              Conversaciones
            </Typography>
            <ConversationLiveIndicator status={liveStatus} />
            {globalUnread.unread > 0 && (
              <Chip
                size="small"
                color="primary"
                label={`${globalUnread.unread}`}
                aria-label={`${globalUnread.unread} conversaciones sin leer`}
                sx={{ height: 22, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
              />
            )}
            {globalUnread.waiting > 0 && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={`${globalUnread.waiting}`}
                aria-label={`${globalUnread.waiting} esperando atención`}
                sx={{ height: 22, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
              />
            )}
          </Stack>

          {persistenceFailure && (
            <Box sx={{ flexShrink: 0, px: 1, pt: 0.75 }}>
              <ConversationPersistenceAlert
                error={listQuery.error}
                onRetry={() => void handleRefresh()}
                retrying={listQuery.isFetching}
              />
            </Box>
          )}

          {hiddenByFilterCount > 0 && hasActiveFilters && (
            <Alert
              severity="info"
              sx={{ mx: 1, mt: 0.75, py: 0, flexShrink: 0, '& .MuiAlert-message': { py: 0.5 } }}
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
                  Limpiar
                </Button>
              }
            >
              Actividad fuera de filtros
            </Alert>
          )}

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

        {isDesktopInbox && showSidebar && (
          <ConversationSidebarResizeHandle
            width={sidebarWidth}
            minWidth={sidebarMinWidth}
            maxWidth={sidebarMaxWidth}
            onPointerDown={beginResize}
            onKeyboardNudge={nudgeWidth}
          />
        )}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: '100%',
            width: { xs: '100%', md: 'auto' },
            display: isMobileInbox
              ? selectedId
                ? 'flex'
                : 'none'
              : 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderLeft: { md: '1px solid' },
            borderColor: 'divider',
          }}
          data-testid="conversation-detail-panel"
        >
          <ConversationDetail
            detail={detailQuery.data}
            currentAgentId={currentAgentId}
            messages={messagesQuery.data?.items ?? []}
            conversationId={selectedId}
            readAt={selectedReadAt}
            onCaughtUp={handleConversationCaughtUp}
            onBack={isMobileInbox && selectedId ? handleBackToList : undefined}
            loadingDetail={detailQuery.isLoading && Boolean(selectedId)}
            loadingMessages={messagesQuery.isLoading && Boolean(selectedId)}
            detailError={detailError}
            messagesError={messagesError}
            sending={sendMutation.isPending}
            claiming={claimMutation.isPending || takeoverMutation.isPending}
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
            onTakeover={() =>
              runAction(
                () => takeoverMutation.mutateAsync({
                  conversationId: selectedId!,
                  expectedVersion: detailQuery.data?.conversation.statusVersion,
                  clientRequestId: crypto.randomUUID(),
                }),
                'Conversación tomada. El bot quedó pausado.',
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
