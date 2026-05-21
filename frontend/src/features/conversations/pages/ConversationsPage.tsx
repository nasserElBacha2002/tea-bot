import React, { useMemo, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { ConversationFilters } from '../components/ConversationFilters';
import { ConversationList } from '../components/ConversationList';
import { ConversationDetail } from '../components/ConversationDetail';
import { ConversationPersistenceAlert } from '../components/ConversationPersistenceAlert';
import {
  useConversations,
  useConversationDetail,
  useConversationMessages,
  useRefreshConversations,
  useClaimConversation,
  useSendAgentMessage,
  useCloseConversation,
  useReturnToBot,
} from '../hooks/useConversations';
import type { ConversationListFilters } from '../types/conversation.types';
import { extractApiError } from '../../../utils/apiError';

export const ConversationsPage: React.FC = () => {
  const [filters, setFilters] = useState<ConversationListFilters>({
    limit: 50,
    offset: 0,
    sort: 'last_message_at_desc',
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const listQuery = useConversations(filters);
  const detailQuery = useConversationDetail(selectedId);
  const messagesQuery = useConversationMessages(selectedId);
  const refresh = useRefreshConversations();
  const claimMutation = useClaimConversation(filters);
  const sendMutation = useSendAgentMessage(filters);
  const closeMutation = useCloseConversation(filters);
  const returnMutation = useReturnToBot(filters);

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
  };

  const handleRefresh = async () => {
    await refresh(selectedId);
    await listQuery.refetch();
    if (selectedId) {
      await detailQuery.refetch();
      await messagesQuery.refetch();
    }
  };

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

  const runAction = async (fn: () => Promise<void>, success: string) => {
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

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2 }}>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 2 }}>
        Conversaciones
      </Typography>

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
          display: 'flex',
          minHeight: 0,
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: { xs: '100%', md: 380 },
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: { md: '1px solid' },
            borderColor: 'divider',
            minHeight: 0,
          }}
        >
          <ConversationFilters
            filters={stableFilters}
            onChange={handleFilterChange}
            onRefresh={handleRefresh}
            refreshing={listQuery.isFetching}
          />
          <ConversationList
            conversations={listQuery.data?.items ?? []}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setActionError(null);
              setSuccessMessage(null);
            }}
            loading={listQuery.isLoading && !persistenceFailure}
            error={listError}
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            display: { xs: selectedId ? 'flex' : 'none', md: 'flex' },
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <ConversationDetail
            detail={detailQuery.data}
            messages={messagesQuery.data?.items ?? []}
            loadingDetail={detailQuery.isLoading && Boolean(selectedId)}
            loadingMessages={messagesQuery.isLoading && Boolean(selectedId)}
            detailError={detailError}
            messagesError={messagesError}
            sending={sendMutation.isPending}
            claiming={claimMutation.isPending}
            closing={closeMutation.isPending}
            returning={returnMutation.isPending}
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
            onReturnToBot={() =>
              runAction(
                () => returnMutation.mutateAsync(selectedId!),
                'Conversación devuelta al bot.',
              )
            }
          />
        </Box>
      </Paper>
    </Box>
  );
};
