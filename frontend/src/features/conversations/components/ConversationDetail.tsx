import React, { useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Button,
  IconButton,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ConversationDetailResponse } from '../types/conversation.types';
import { ConversationStatusBadge } from './ConversationStatusBadge';
import { ConversationMessageTimeline } from './ConversationMessageTimeline';
import { ConversationComposer } from './ConversationComposer';
import { ContactNameEditor } from './ContactNameEditor';
import type { ConversationMessage } from '../types/conversation.types';
import {
  formatConversationTitle,
  formatListItemSecondary,
} from '../utils/conversationUiLabels';
import {
  channelLabel,
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
  savingContact?: boolean;
  contactError?: string | null;
  actionError?: string | null;
  successMessage?: string | null;
  readAt?: string | null;
  onCaughtUp?: (readThroughAt: string) => void;
  onSend: (body: string) => Promise<void>;
  onClaim: () => Promise<void>;
  onClose: () => Promise<void>;
  onUpdateContact: (name: string) => Promise<void>;
  onBack?: () => void;
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
  savingContact,
  contactError,
  actionError,
  successMessage,
  readAt = null,
  onCaughtUp,
  onSend,
  onClaim,
  onClose,
  onUpdateContact,
  onBack,
}) => {
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down('md'));
  const isCompactDetail = isMobileViewport || Boolean(onBack);
  const [closeConfirm, setCloseConfirm] = useState(false);

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
  const contactSecondary = formatListItemSecondary(
    conversation.phoneNumber,
    conversation.displayName,
    channelLabel(conversation.channel),
  );
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

  const handleClose = async () => {
    if (!closeConfirm) {
      setCloseConfirm(true);
      return;
    }
    await onClose();
    setCloseConfirm(false);
  };

  const closeButtonLabel = closeConfirm
    ? isCompactDetail
      ? 'Confirmar'
      : 'Confirmar cierre'
    : isCompactDetail
      ? 'Cerrar'
      : 'Cerrar y devolver al bot';

  const compactHeader = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{ minHeight: 44, width: '100%' }}
    >
      {onBack && (
        <IconButton
          onClick={onBack}
          aria-label="Volver a la lista"
          edge="start"
          size="small"
        >
          <ArrowBackIcon />
        </IconButton>
      )}
      <Typography
        variant="subtitle1"
        fontWeight={700}
        noWrap
        sx={{ flex: 1, minWidth: 0 }}
      >
        {title}
      </Typography>
      {closeConfirm && (
        <Button size="small" onClick={() => setCloseConfirm(false)} sx={{ flexShrink: 0 }}>
          No
        </Button>
      )}
      {canClose && (
        <Button
          size="small"
          variant={closeConfirm ? 'contained' : 'outlined'}
          color="error"
          onClick={() => void handleClose()}
          disabled={closing}
          sx={{ flexShrink: 0, minWidth: closeConfirm ? 72 : 56, px: 1 }}
        >
          {closing ? '…' : closeButtonLabel}
        </Button>
      )}
    </Stack>
  );

  const desktopHeader = (
    <>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        {onBack && (
          <IconButton
            onClick={onBack}
            aria-label="Volver a la lista"
            edge="start"
            size="small"
            sx={{ mr: 0.5 }}
          >
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h6" fontWeight={800}>
          {title}
        </Typography>
        <ContactNameEditor
          displayName={conversation.displayName}
          saving={savingContact}
          error={contactError}
          onSave={onUpdateContact}
        />
        <ConversationStatusBadge status={conversation.status} size="medium" />
      </Stack>

      {conversation.displayName?.trim() && conversation.phoneNumber && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {contactSecondary}
        </Typography>
      )}

      {conversation.contactEmail?.trim() && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Email: {conversation.contactEmail.trim()}
        </Typography>
      )}

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
            {closeButtonLabel}
          </Button>
        )}
        {closeConfirm && !isCompactDetail && (
          <Button size="small" onClick={() => setCloseConfirm(false)}>
            Cancelar
          </Button>
        )}
      </Stack>
    </>
  );

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
          maxHeight: isCompactDetail ? 'none' : '36%',
          minHeight: 0,
          overflowY: isCompactDetail ? 'visible' : 'auto',
          overflowX: 'hidden',
          px: isCompactDetail ? 1 : 2,
          py: isCompactDetail ? 0.75 : 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {isCompactDetail ? compactHeader : desktopHeader}
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
          compact={isCompactDetail}
          onSend={onSend}
          onClaim={onClaim}
        />
      </Box>
    </Box>
  );
};
