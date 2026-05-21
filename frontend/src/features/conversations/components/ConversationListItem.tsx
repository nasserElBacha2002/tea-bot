import React from 'react';
import {
  ListItemButton,
  ListItemText,
  Typography,
  Stack,
  Chip,
} from '@mui/material';
import type { InboxConversationItem } from '../types/conversation.types';
import { ConversationStatusBadge } from './ConversationStatusBadge';
import { formatConversationTitle } from '../utils/conversationUiLabels';

interface Props {
  conversation: InboxConversationItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export const ConversationListItem: React.FC<Props> = ({
  conversation,
  selected,
  onSelect,
}) => {
  const title = formatConversationTitle(conversation.phoneNumber, conversation.displayName);
  const preview =
    conversation.lastMessage?.body?.trim() || 'Sin mensajes';
  const previewPrefix =
    conversation.lastMessage?.direction === 'outbound' ? 'Tú: ' : '';

  return (
    <ListItemButton
      selected={selected}
      onClick={() => onSelect(conversation.id)}
      alignItems="flex-start"
      sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ maxWidth: 180 }}>
              {title}
            </Typography>
            <ConversationStatusBadge status={conversation.status} />
          </Stack>
        }
        secondary={
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {previewPrefix}
              {preview}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Chip label={conversation.channel} size="small" variant="outlined" sx={{ height: 20 }} />
              <Chip label={conversation.provider} size="small" variant="outlined" sx={{ height: 20 }} />
              <Typography variant="caption" color="text.disabled">
                {formatTime(conversation.lastMessageAt)}
              </Typography>
            </Stack>
          </Stack>
        }
      />
    </ListItemButton>
  );
};
