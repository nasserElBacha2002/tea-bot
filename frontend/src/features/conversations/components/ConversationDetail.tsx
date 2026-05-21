import React, { useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Divider,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import type { ConversationDetailResponse } from '../types/conversation.types';
import { ConversationStatusBadge } from './ConversationStatusBadge';
import { ConversationMessageTimeline } from './ConversationMessageTimeline';
import { ConversationComposer } from './ConversationComposer';
import type { ConversationMessage } from '../types/conversation.types';
import {
  formatConversationTitle,
  handoffStatusLabel,
} from '../utils/conversationUiLabels';

interface Props {
  detail: ConversationDetailResponse | undefined;
  messages: ConversationMessage[];
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
  onSend: (body: string) => Promise<void>;
  onClaim: () => Promise<void>;
  onClose: () => Promise<void>;
  onReturnToBot: () => Promise<void>;
}

export const ConversationDetail: React.FC<Props> = ({
  detail,
  messages,
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
  onSend,
  onClaim,
  onClose,
  onReturnToBot,
}) => {
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [returnConfirm, setReturnConfirm] = useState(false);

  if (loadingDetail) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
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

  const { conversation, activeSession, humanHandoff } = detail;
  const title = formatConversationTitle(conversation.phoneNumber, conversation.displayName);
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
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="h6" fontWeight={800}>
            {title}
          </Typography>
          <ConversationStatusBadge status={conversation.status} size="medium" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {conversation.channel} · {conversation.provider}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap">
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

        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          <Typography variant="body2">
            <strong>Flujo actual:</strong> {conversation.currentFlowId ?? '—'}
          </Typography>
          <Typography variant="body2">
            <strong>Versión:</strong> {conversation.currentFlowVersion ?? '—'}
          </Typography>
          <Typography variant="body2">
            <strong>Nodo actual:</strong> {conversation.currentNodeKey ?? '—'}
          </Typography>
          {conversation.assignedAgentId && (
            <Typography variant="body2">
              <strong>Agente asignado:</strong> {conversation.assignedAgentId}
            </Typography>
          )}
          {humanHandoff && (
            <>
              <Typography variant="body2">
                <strong>Estado de atención:</strong>{' '}
                {handoffStatusLabel(humanHandoff.status)}
              </Typography>
              {humanHandoff.reason && (
                <Typography variant="body2">
                  <strong>Motivo de derivación:</strong> {humanHandoff.reason}
                </Typography>
              )}
            </>
          )}
          {activeSession && (
            <Typography variant="caption" color="text.secondary">
              Sesión {activeSession.status} · {activeSession.flowId} (
              {activeSession.flowVersion ?? 'sin versión'})
            </Typography>
          )}
        </Stack>
      </Box>

      <ConversationMessageTimeline
        messages={messages}
        loading={loadingMessages}
        error={messagesError}
      />

      <ConversationComposer
        status={conversation.status}
        sending={sending}
        claiming={claiming}
        actionError={actionError}
        successMessage={successMessage}
        onSend={onSend}
        onClaim={onClaim}
      />
    </Box>
  );
};
