import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { ConversationStatus } from '../types/conversation.types';
import { canOperatorReply } from '../utils/agentAssignment';
import { conversationUiDensity } from '../constants/conversationUiDensity';

interface Props {
  status: ConversationStatus;
  sending?: boolean;
  actionError?: string | null;
  successMessage?: string | null;
  compact?: boolean;
  canTakeover?: boolean;
  takeoverBlock?: string | null;
  assignedAgentLabel?: string | null;
  assignedAgentId?: string | null;
  currentAgentId?: string | null;
  onSend: (body: string) => Promise<void>;
  onClaim?: () => Promise<void>;
  onTakeover?: () => Promise<void>;
  claiming?: boolean;
}

function CompactNotice({
  tone,
  children,
}: {
  tone: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const Icon = tone === 'warning' ? WarningAmberOutlinedIcon : InfoOutlinedIcon;
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: conversationUiDensity.composerNoticeHeight,
        maxHeight: conversationUiDensity.composerNoticeHeight,
        px: 1.25,
        py: 0.75,
        bgcolor: tone === 'warning' ? 'warning.light' : 'info.light',
        color: 'text.primary',
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Icon fontSize="small" color={tone === 'warning' ? 'warning' : 'info'} sx={{ flexShrink: 0 }} />
      <Typography
        variant="caption"
        noWrap
        title={typeof children === 'string' ? children : undefined}
        sx={{ fontSize: '0.8125rem', lineHeight: 1.3, minWidth: 0 }}
      >
        {children}
      </Typography>
    </Box>
  );
}

export const ConversationComposer: React.FC<Props> = ({
  status,
  sending,
  actionError,
  successMessage,
  compact = false,
  onSend,
  onClaim,
  onTakeover,
  claiming,
  canTakeover = false,
  takeoverBlock = null,
  assignedAgentLabel = null,
  assignedAgentId = null,
  currentAgentId = null,
}) => {
  const [text, setText] = useState('');

  if (status === 'closed') {
    return (
      <CompactNotice tone="info">
        No se puede responder una conversación cerrada.
      </CompactNotice>
    );
  }

  if (status === 'bot') {
    return (
      <Box sx={{ flexShrink: 0 }}>
        <CompactNotice tone="warning">
          {canTakeover
            ? 'Bot activo. Tomá la conversación para responder. El composer se habilita cuando el servidor confirma la toma.'
            : 'Bot activo · La respuesta manual se habilitará al derivar a humano.'}
        </CompactNotice>
        {canTakeover && (
          <Box sx={{ p: compact ? 1 : 1.25 }}>
            {actionError && (
              <Alert severity="error" sx={{ mb: 0.75, py: 0.25 }}>
                {actionError}
              </Alert>
            )}
            <Button
              variant="contained"
              fullWidth
              size="small"
              onClick={() => void onTakeover?.()}
              disabled={claiming}
              sx={{ minHeight: conversationUiDensity.controlHeight }}
            >
              {claiming ? 'Tomando…' : 'Tomar conversación'}
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  const lostToAnotherAgent = takeoverBlock !== 'disabled'
    && Boolean(currentAgentId)
    && Boolean(assignedAgentId)
    && currentAgentId !== assignedAgentId
    && (status === 'assigned' || status === 'paused');

  if (takeoverBlock === 'owned_by_other' || lostToAnotherAgent) {
    const who = assignedAgentLabel?.trim() || 'otro agente';
    return (
      <Box sx={{ flexShrink: 0 }}>
        <CompactNotice tone="info">
          {`Bot pausado. La conversación la está atendiendo ${who}.`}
        </CompactNotice>
        {actionError && (
          <Alert severity="error" sx={{ m: 1, py: 0.25 }}>
            {actionError}
          </Alert>
        )}
      </Box>
    );
  }

  if (!canOperatorReply(status)) {
    return null;
  }

  const handleSend = async () => {
    const body = text.trim();
    if (!body) return;
    await onSend(body);
    setText('');
  };

  const exclusiveAttention = takeoverBlock != null && takeoverBlock !== 'disabled';
  const pausedNotice = exclusiveAttention && (status === 'assigned' || status === 'paused')
    ? assignedAgentLabel
      ? `Bot pausado. Atiende ${assignedAgentLabel}.`
      : 'Bot pausado. Estás atendiendo esta conversación.'
    : null;
  const showComposer = !canTakeover || status === 'assigned' || status === 'paused';

  return (
    <Box sx={{ p: compact ? 1 : 1.25, flexShrink: 0 }}>
      {pausedNotice && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {pausedNotice}
        </Typography>
      )}
      {(canTakeover || status === 'waiting_human') && (
        <Button
          variant="outlined"
          fullWidth
          size="small"
          onClick={() => void (canTakeover ? onTakeover?.() : onClaim?.())}
          disabled={claiming}
          sx={{ mb: 0.75, minHeight: conversationUiDensity.controlHeight }}
        >
          {claiming ? 'Tomando…' : 'Tomar conversación'}
        </Button>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 0.75, py: 0.25, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
          {successMessage}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 0.75, py: 0.25, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
          {actionError}
        </Alert>
      )}
      {showComposer && (
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          multiline
          minRows={1}
          maxRows={compact ? 4 : 5}
          label="Responder"
          placeholder="Escribí una respuesta…"
          size="small"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
          sx={{
            '& .MuiInputBase-root': { minHeight: conversationUiDensity.controlHeight },
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => void handleSend()}
          disabled={sending || !text.trim()}
          sx={{ flexShrink: 0, minHeight: conversationUiDensity.controlHeight }}
        >
          {sending ? '…' : 'Enviar'}
        </Button>
      </Stack>
      )}
    </Box>
  );
};
