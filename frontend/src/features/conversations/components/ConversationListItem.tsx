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
import { formatListItemPrimary, formatListItemSecondary } from '../utils/conversationUiLabels';
import {
  channelLabel,
  formatShortDateTime,
  lastMessagePreviewPrefix,
} from '../utils/conversationDisplay';
import { listPriorityAccent } from '../utils/conversationUnread';

interface Props {
  conversation: InboxConversationItem;
  selected: boolean;
  unread?: boolean;
  unreadCount?: number;
  isNew?: boolean;
  onSelect: (id: string) => void;
}

function listItemBadge(
  status: string,
  unread: boolean,
  unreadCount: number,
  isNew: boolean,
): { label: string; color: 'primary' | 'warning' | 'error' | 'default' } | null {
  if (status === 'waiting_human' && unread) {
    return { label: unreadCount > 1 ? String(unreadCount) : 'Esperando', color: 'error' };
  }
  if (unreadCount > 1) return { label: String(unreadCount), color: 'primary' };
  if (isNew) return { label: 'Nuevo', color: 'primary' };
  if (unread) return { label: 'Sin leer', color: 'primary' };
  return null;
}

export const ConversationListItem: React.FC<Props> = ({
  conversation,
  selected,
  unread = false,
  unreadCount = 0,
  isNew = false,
  onSelect,
}) => {
  const title = formatListItemPrimary(conversation.phoneNumber, conversation.displayName);
  const listCaption = formatListItemSecondary(
    conversation.phoneNumber,
    conversation.displayName,
    channelLabel(conversation.channel),
  );
  const preview =
    conversation.lastMessage?.body?.trim() || 'Sin mensajes';
  const prefix = lastMessagePreviewPrefix(
    conversation.lastMessage?.direction,
    conversation.lastMessage?.senderType,
  );
  const time = formatShortDateTime(conversation.lastMessageAt);
  const accent = listPriorityAccent(conversation.status, unread || unreadCount > 0);
  const badge = listItemBadge(conversation.status, unread, unreadCount, isNew);
  const highlight = (unread || isNew) && !selected && conversation.status !== 'closed';

  const ariaLabel = [
    title,
    unreadCount > 0 ? `sin leer con ${unreadCount} mensajes nuevos` : unread ? 'sin leer' : '',
    isNew ? 'nueva conversación' : '',
    conversation.status === 'waiting_human' ? 'esperando atención humana' : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ListItemButton
      selected={selected}
      onClick={() => onSelect(conversation.id)}
      alignItems="flex-start"
      aria-label={ariaLabel}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: highlight
          ? accent === 'high'
            ? 'error.light'
            : 'action.selected'
          : undefined,
        borderLeft: highlight ? '4px solid' : '4px solid transparent',
        borderLeftColor: highlight
          ? conversation.status === 'waiting_human'
            ? 'error.main'
            : 'primary.main'
          : 'transparent',
        opacity: conversation.status === 'closed' ? 0.85 : 1,
      }}
    >
      <ListItemText
        primaryTypographyProps={{ component: 'div' }}
        secondaryTypographyProps={{ component: 'div' }}
        primary={
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography
              variant="subtitle2"
              fontWeight={highlight ? 800 : 600}
              noWrap
              sx={{ flex: 1 }}
            >
              {title}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
              {badge && (
                <Chip
                  size="small"
                  label={badge.label}
                  color={badge.color}
                  sx={{ height: 22, fontWeight: 700 }}
                />
              )}
              <ConversationStatusBadge status={conversation.status} />
            </Stack>
          </Stack>
        }
        secondary={
          <Stack spacing={0.35} sx={{ mt: 0.5 }}>
            <Typography
              variant="body2"
              color={highlight ? 'text.primary' : 'text.secondary'}
              noWrap
              fontWeight={highlight ? 700 : 400}
            >
              {prefix}
              {preview}
            </Typography>
            <Typography
              variant="caption"
              color={highlight ? 'text.secondary' : 'text.disabled'}
              fontWeight={highlight ? 600 : 400}
            >
              {time ? `${time} · ` : ''}
              {listCaption}
            </Typography>
          </Stack>
        }
      />
    </ListItemButton>
  );
};
