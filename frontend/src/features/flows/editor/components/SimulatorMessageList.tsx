import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import type { SimulatorChatMessage } from '../state/useConversationSimulator';

export interface SimulatorMessageListProps {
  messages: SimulatorChatMessage[];
  emptyHint?: string;
  showEmptyHint?: boolean;
}

export const SimulatorMessageList: React.FC<SimulatorMessageListProps> = ({
  messages,
  emptyHint = 'Prueba aquí cómo respondería el bot',
  showEmptyHint,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: 120,
        px: 0.5,
      }}
    >
      {showEmptyHint && messages.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3, px: 1 }}>
          {emptyHint}
        </Typography>
      )}
      {messages.map((m, i) => (
        <Box key={i} sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
          <Box
            sx={{
              maxWidth: '90%',
              px: 1.25,
              py: 1,
              borderRadius: 2,
              bgcolor: m.role === 'user' ? 'primary.main' : 'grey.100',
              color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {m.text}
            </Typography>
          </Box>
        </Box>
      ))}
      <div ref={bottomRef} />
    </Box>
  );
};
