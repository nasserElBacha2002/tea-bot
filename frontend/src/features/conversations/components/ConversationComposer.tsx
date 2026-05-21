import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { ConversationStatus } from '../types/conversation.types';

interface Props {
  status: ConversationStatus;
  sending?: boolean;
  actionError?: string | null;
  successMessage?: string | null;
  onSend: (body: string) => Promise<void>;
  onClaim?: () => Promise<void>;
  claiming?: boolean;
}

export const ConversationComposer: React.FC<Props> = ({
  status,
  sending,
  actionError,
  successMessage,
  onSend,
  onClaim,
  claiming,
}) => {
  const [text, setText] = useState('');

  if (status === 'closed') {
    return (
      <Alert severity="info" sx={{ m: 2 }}>
        No se puede responder una conversación cerrada.
      </Alert>
    );
  }

  if (status === 'bot') {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        El bot está activo en esta conversación. La respuesta manual no está disponible hasta que
        el usuario sea derivado al equipo humano.
      </Alert>
    );
  }

  if (status === 'waiting_human') {
    return (
      <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Para responder, primero tomá la conversación.
        </Typography>
        <Button variant="contained" onClick={() => onClaim?.()} disabled={claiming}>
          {claiming ? 'Tomando...' : 'Tomar conversación'}
        </Button>
        {actionError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {actionError}
          </Alert>
        )}
      </Box>
    );
  }

  const handleSend = async () => {
    const body = text.trim();
    if (!body) return;
    await onSend(body);
    setText('');
  };

  return (
    <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Responder
      </Typography>
      {successMessage && (
        <Alert severity="success" sx={{ mb: 1 }}>
          {successMessage}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {actionError}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          label="Escribí una respuesta..."
          placeholder="Escribí una respuesta..."
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
          onClick={() => void handleSend()}
          disabled={sending || !text.trim()}
        >
          {sending ? 'Enviando...' : 'Enviar'}
        </Button>
      </Stack>
    </Box>
  );
};
