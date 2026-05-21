import React, { useEffect, useRef } from 'react';
import { Box, Paper, Typography, Stack, CircularProgress, Alert } from '@mui/material';
import type { ConversationMessage } from '../types/conversation.types';
import { senderTypeLabel } from '../utils/conversationUiLabels';

interface Props {
  messages: ConversationMessage[];
  loading?: boolean;
  error?: string | null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const ConversationMessageTimeline: React.FC<Props> = ({
  messages,
  loading,
  error,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }

  if (!messages.length) {
    return (
      <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
        Sin mensajes
      </Typography>
    );
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
      <Stack spacing={1.5}>
        {messages.map((msg) => {
          const isInbound = msg.direction === 'inbound';
          const isSystem = msg.senderType === 'system';
          const align = isSystem ? 'center' : isInbound ? 'flex-start' : 'flex-end';

          return (
            <Box key={msg.id} sx={{ display: 'flex', justifyContent: align }}>
              <Paper
                elevation={0}
                sx={{
                  px: 1.5,
                  py: 1,
                  maxWidth: '78%',
                  bgcolor: isSystem
                    ? 'grey.200'
                    : isInbound
                      ? 'background.paper'
                      : 'primary.light',
                  color: isInbound || isSystem ? 'text.primary' : 'primary.contrastText',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary" display="block">
                  {senderTypeLabel(msg.senderType)} · {formatTime(msg.createdAt)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                  {msg.body || '—'}
                </Typography>
              </Paper>
            </Box>
          );
        })}
        <div ref={bottomRef} />
      </Stack>
    </Box>
  );
};
