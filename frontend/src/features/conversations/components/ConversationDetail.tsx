import React, { useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import type { ConversationDetailResponse } from '../types/conversation.types';
import { ConversationStatusBadge } from './ConversationStatusBadge';
import { ConversationMessageTimeline } from './ConversationMessageTimeline';
import { ConversationComposer } from './ConversationComposer';
import { ConversationTechnicalDetails } from './ConversationTechnicalDetails';
import type { ConversationMessage } from '../types/conversation.types';
import { formatConversationTitle } from '../utils/conversationUiLabels';
import {
  formatAssignmentLabel,
  formatDetailSubtitle,
  handoffReasonHumanText,
} from '../utils/conversationDisplay';

interface Props {
  detail: ConversationDetailResponse | undefined;
  messages: ConversationMessage[];
  conversationId?: string | null;
  currentAgentId?: string | null;
  loadingDetail?: boolean;
  loadingMessages?: boolean;
  detailError?: string | null;
  messagesError?: string | null;
  sending?: boolean;
  claiming?: boolean;
  closing?: boolean;
  returning?: boolean;
  actionError?: string | null;
  successMessage?: string | null;
  readAt?: string | null;
  onCaughtUp?: (readThroughAt: string) => void;
  onSend: (body: string) => Promise<void>;
  onClaim: () => Promise<void>;
  onClose: () => Promise<void>;
  onReturnToBot: () => Promise<void>;
}

export const ConversationDetail: React.FC<Props> = ({
  detail,
  messages,
  conversationId,
  currentAgentId,
  loadingDetail,
  loadingMessages,
  detailError,
  messagesError,
  sending,
  claiming,
  closing,
  returning,
  actionError,
  successMessage,
  readAt = null,
  onCaughtUp,
  onSend,
  onClaim,
  onClose,
  onReturnToBot,
}) => {
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [returnConfirm, setReturnConfirm] = useState(false);

  if (loadingDetail) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (detailError) {
    return <Alert severity="error" sx={{ m: 2 }}>{detailError}</Alert>;
  }

  if (!detail) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Typography color="text.secondary" textAlign="center">
          Seleccioná una conversación para ver el detalle
        </Typography>
      </Box>
    );
  }

  const { conversation, humanHandoff } = detail;
  const title = formatConversationTitle(conversation.phoneNumber, conversation.displayName);
  const subtitle = formatDetailSubtitle(
    conversation.channel,
    conversation.provider,
    conversation.status,
    conversation.lastMessageAt,
  );
  const assignment = formatAssignmentLabel(conversation.assignedAgentId, currentAgentId);
  const motivo =
    handoffReasonHumanText(humanHandoff?.reason)
    ?? (conversation.status === 'waiting_human'
      ? 'Esperando que un operador tome la conversación.'
      : null);

  const canClose = conversation.status !== 'closed';
  const canReturn =
    conversation.status === 'waiting_human'
    || conversation.status === 'assigned'
    || conversation.status === 'paused';

  const handleClose = async () => {
    if (!closeConfirm) {
      setCloseConfirm(true);
      return;
    }
    await onClose();
    setCloseConfirm(false);
  };

  const handleReturn = async () => {
    if (!returnConfirm) {
      setReturnConfirm(true);
      return;
    }
    await onReturnToBot();
    setReturnConfirm(false);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          maxHeight: { xs: '40vh', md: '36%' },
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="h6" fontWeight={800}>
            {title}
          </Typography>
          <ConversationStatusBadge status={conversation.status} size="medium" />
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {subtitle}
        </Typography>

        {assignment && (
          <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600 }}>
            {assignment}
          </Typography>
        )}

        {motivo && (
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            <strong>Motivo:</strong> {motivo}
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap">
          {conversation.status === 'waiting_human' && !conversation.assignedAgentId && (
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => void onClaim()}
              disabled={claiming}
            >
              {claiming ? 'Tomando…' : 'Tomar conversación'}
            </Button>
          )}
          {canClose && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={() => void handleClose()}
              disabled={closing}
            >
              {closeConfirm ? 'Confirmar cierre' : 'Cerrar conversación'}
            </Button>
          )}
          {canReturn && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void handleReturn()}
              disabled={returning}
            >
              {returnConfirm ? 'Confirmar devolución' : 'Devolver al bot'}
            </Button>
          )}
          {closeConfirm && (
            <Button size="small" onClick={() => setCloseConfirm(false)}>
              Cancelar
            </Button>
          )}
          {returnConfirm && (
            <Button size="small" onClick={() => setReturnConfirm(false)}>
              Cancelar
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1 }}>
          <ConversationTechnicalDetails detail={detail} />
        </Box>
      </Box>

      <ConversationMessageTimeline
        key={conversationId ?? conversation.id}
        messages={messages}
        loading={loadingMessages}
        error={messagesError}
        conversationId={conversationId ?? conversation.id}
        readAt={readAt}
        onCaughtUp={onCaughtUp}
      />

      <Box
        sx={{
          flexShrink: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <ConversationComposer
          status={conversation.status}
          assignedToCurrentAgent={
            Boolean(
              currentAgentId
              && conversation.assignedAgentId
              && conversation.assignedAgentId === currentAgentId,
            )
          }
          sending={sending}
          claiming={claiming}
          actionError={actionError}
          successMessage={successMessage}
          onSend={onSend}
          onClaim={onClaim}
        />
      </Box>
    </Box>
  );
};
