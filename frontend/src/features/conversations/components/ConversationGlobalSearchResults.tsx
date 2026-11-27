import React, { useMemo } from 'react';
import { Box, Button, CircularProgress, List, Typography } from '@mui/material';
import type {
  ConversationGlobalSearchResponse,
  ConversationSearchMessageHit,
  InboxConversationItem,
} from '../types/conversation.types';
import { renderHighlightedText } from '../utils/searchHighlight';
import { contactHitToInboxItem, messageHitToInboxItem } from '../utils/globalSearchListMapping';
import { ConversationListItem } from './ConversationListItem';
import { conversationListScrollSx } from './conversationListScrollSx';
import { lastMessagePreviewPrefix } from '../utils/conversationDisplay';

interface Props {
  loading?: boolean;
  pendingNewTerm?: boolean;
  error?: string | null;
  data?: ConversationGlobalSearchResponse;
  selectedId: string | null;
  inboxById?: Map<string, InboxConversationItem>;
  unreadIds?: Set<string>;
  unreadCounts?: Record<string, number>;
  newConversationIds?: Set<string>;
  onOpenConversation: (conversationId: string) => void;
  onOpenMessage: (hit: ConversationSearchMessageHit) => void;
  onLoadMoreContacts?: () => void;
  onLoadMoreMessages?: () => void;
  hasMoreContacts?: boolean;
  hasMoreMessages?: boolean;
}

export const ConversationGlobalSearchResults: React.FC<Props> = ({
  loading,
  pendingNewTerm,
  error,
  data,
  selectedId,
  inboxById,
  unreadIds,
  unreadCounts,
  newConversationIds,
  onOpenConversation,
  onOpenMessage,
  onLoadMoreContacts,
  onLoadMoreMessages,
  hasMoreContacts,
  hasMoreMessages,
}) => {
  const inboxLookup = useMemo(
    () => inboxById ?? new Map<string, InboxConversationItem>(),
    [inboxById],
  );

  const contactRows = useMemo(() => {
    if (!data) return [];
    return data.contacts.items.map((hit) => ({
      hit,
      conversation: contactHitToInboxItem(hit, inboxLookup.get(hit.conversationId)),
    }));
  }, [data, inboxLookup]);

  const messageRows = useMemo(() => {
    if (!data) return [];
    return data.messages.items.map((hit) => ({
      hit,
      conversation: messageHitToInboxItem(hit, inboxLookup.get(hit.conversationId)),
    }));
  }, [data, inboxLookup]);

  if ((loading || pendingNewTerm) && !data) {
    return (
      <Box sx={{ ...conversationListScrollSx, display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={conversationListScrollSx}>
        <Typography variant="body2" color="error" sx={{ px: 1.5, py: 2 }}>
          {error}
        </Typography>
      </Box>
    );
  }

  if (!data) return null;

  const empty = contactRows.length === 0 && messageRows.length === 0;
  const itemDisabled = Boolean(pendingNewTerm);

  return (
    <Box data-testid="conversation-global-search-results" sx={conversationListScrollSx}>
      {empty && !loading && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 3, textAlign: 'center' }}>
          Sin resultados
        </Typography>
      )}

      {contactRows.length > 0 && (
        <>
          <List disablePadding>
            {contactRows.map(({ hit, conversation }) => (
              <ConversationListItem
                key={hit.conversationId}
                conversation={conversation}
                selected={conversation.id === selectedId}
                unread={unreadIds?.has(conversation.id)}
                unreadCount={unreadCounts?.[conversation.id] ?? 0}
                isNew={newConversationIds?.has(conversation.id)}
                onSelect={onOpenConversation}
                disabled={itemDisabled}
              />
            ))}
          </List>
          {hasMoreContacts && onLoadMoreContacts && (
            <Box sx={{ px: 1.25, py: 0.5 }}>
              <Button size="small" onClick={onLoadMoreContacts}>
                Más contactos
              </Button>
            </Box>
          )}
        </>
      )}

      {messageRows.length > 0 && (
        <>
          <List disablePadding>
            {messageRows.map(({ hit, conversation }) => {
              const prefix = lastMessagePreviewPrefix(hit.direction, hit.senderType);
              const previewSlot = (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.35 }}
                >
                  {prefix}
                  {renderHighlightedText(hit.snippet, hit.highlightStart, hit.highlightEnd)}
                </Typography>
              );
              return (
                <ConversationListItem
                  key={`${hit.conversationId}-${hit.messageId}`}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  unread={unreadIds?.has(conversation.id)}
                  unreadCount={unreadCounts?.[conversation.id] ?? 0}
                  isNew={newConversationIds?.has(conversation.id)}
                  onSelect={onOpenConversation}
                  onItemClick={() => onOpenMessage(hit)}
                  previewSlot={previewSlot}
                  metaTimeAt={hit.createdAt}
                  disabled={itemDisabled}
                />
              );
            })}
          </List>
          {hasMoreMessages && onLoadMoreMessages && (
            <Box sx={{ px: 1.25, py: 0.5 }}>
              <Button size="small" onClick={onLoadMoreMessages}>
                Más mensajes
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};