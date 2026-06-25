import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
} from '@mui/material';
import type { ConversationStatus } from '../types/conversation.types';
import { canOperatorReply } from '../utils/agentAssignment';

interface Props {
  status: ConversationStatus;
  sending?: boolean;
  actionError?: string | null;
  successMessage?: string | null;
  compact?: boolean;
  onSend: (body: string) => Promise<void>;
  onClaim?: () => Promise<void>;
  claiming?: boolean;
}

export const ConversationComposer: React.FC<Props> = ({
  status,
  sending,
  actionError,
  successMessage,
  compact = false,
  onSend,
  onClaim,
  claiming,
}) => {
  const [text, setText] = useState('');

  if (status === 'closed') {
    return (
      <Alert severity="info" sx={{ m: compact ? 1 : 2, py: compact ? 0.5 : 1 }}>
        No se puede responder una conversación cerrada.
      </Alert>
    );
  }

  if (status === 'bot') {
    return (
      <Alert severity="warning" sx={{ m: compact ? 1 : 2, py: compact ? 0.5 : 1 }}>
        El bot está activo. La respuesta manual estará disponible cuando el usuario sea derivado al
        equipo humano.
      </Alert>
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

  return (
    <Box sx={{ p: compact ? 1 : 2, flexShrink: 0 }}>
      {status === 'waiting_human' && (
        <Button
          variant="outlined"
          fullWidth
          size={compact ? 'small' : 'medium'}
          onClick={() => onClaim?.()}
          disabled={claiming}
          sx={{ mb: compact ? 0.75 : 1 }}
        >
          {claiming ? 'Tomando…' : 'Tomar conversación'}
        </Button>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: compact ? 0.5 : 1, py: compact ? 0.25 : 1 }}>
          {successMessage}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: compact ? 0.5 : 1, py: compact ? 0.25 : 1 }}>
          {actionError}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          multiline
          minRows={compact ? 1 : 2}
          maxRows={compact ? 4 : 6}
          label="Responder"
          placeholder="Escribí una respuesta…"
          size={compact ? 'small' : 'medium'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          variant="contained"
          size={compact ? 'small' : 'medium'}
          onClick={() => void handleSend()}
          disabled={sending || !text.trim()}
          sx={{ flexShrink: 0 }}
        >
          {sending ? '…' : 'Enviar'}
        </Button>
      </Stack>
    </Box>
  );
};
