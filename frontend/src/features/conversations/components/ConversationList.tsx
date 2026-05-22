import React from 'react';
import { Box, CircularProgress, List, Typography, Alert } from '@mui/material';
import type { InboxConversationItem } from '../types/conversation.types';
import { ConversationListItem } from './ConversationListItem';

const listScrollSx = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  WebkitOverflowScrolling: 'touch',
} as const;

interface Props {
  conversations: InboxConversationItem[];
  selectedId: string | null;
  unreadIds?: Set<string>;
  unreadCounts?: Record<string, number>;
  newConversationIds?: Set<string>;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
}

export const ConversationList: React.FC<Props> = ({
  conversations,
  selectedId,
  unreadIds,
  unreadCounts,
  newConversationIds,
  onSelect,
  loading,
  error,
}) => {
  if (loading) {
    return (
      <Box sx={{ ...listScrollSx, display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={listScrollSx}>
        <Box sx={{ p: 2 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Box>
    );
  }

  if (!conversations.length) {
    return (
      <Box sx={{ ...listScrollSx, p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">No se encontraron conversaciones</Typography>
      </Box>
    );
  }

  return (
    <Box sx={listScrollSx} data-testid="conversation-list-scroll">
      <List disablePadding>
        {conversations.map((c) => (
          <ConversationListItem
            key={c.id}
            conversation={c}
            selected={c.id === selectedId}
            unread={unreadIds?.has(c.id)}
            unreadCount={unreadCounts?.[c.id] ?? 0}
            isNew={newConversationIds?.has(c.id)}
            onSelect={onSelect}
          />
        ))}
      </List>
    </Box>
  );
};
