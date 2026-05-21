import React from 'react';
import { Box, CircularProgress, List, Typography, Alert } from '@mui/material';
import type { InboxConversationItem } from '../types/conversation.types';
import { ConversationListItem } from './ConversationListItem';

interface Props {
  conversations: InboxConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
}

export const ConversationList: React.FC<Props> = ({
  conversations,
  selectedId,
  onSelect,
  loading,
  error,
}) => {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!conversations.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">No se encontraron conversaciones</Typography>
      </Box>
    );
  }

  return (
    <List disablePadding sx={{ overflow: 'auto', flex: 1 }}>
      {conversations.map((c) => (
        <ConversationListItem
          key={c.id}
          conversation={c}
          selected={c.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </List>
  );
};
