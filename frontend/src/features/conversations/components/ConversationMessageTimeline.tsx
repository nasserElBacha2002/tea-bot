import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Paper, Typography, Stack, CircularProgress, Alert, Button } from '@mui/material';
import type { ConversationMessage } from '../types/conversation.types';
import { senderTypeLabel } from '../utils/conversationUiLabels';
import {
  messageDisplayBody,
  resolveMessageBubbleRole,
} from '../utils/conversationMessageDisplay';

interface Props {
  messages: ConversationMessage[];
  loading?: boolean;
  error?: string | null;
  conversationId?: string | null;
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

const SCROLL_NEAR_BOTTOM_PX = 80;

export const ConversationMessageTimeline: React.FC<Props> = ({
  messages,
  loading,
  error,
  conversationId,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showNewBanner, setShowNewBanner] = useState(false);
  const prevLenRef = useRef(0);
  const prevConvRef = useRef(conversationId);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    setShowNewBanner(false);
  }, []);

  const scrollToBottomOnly = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  useEffect(() => {
    if (conversationId !== prevConvRef.current) {
      prevConvRef.current = conversationId;
      prevLenRef.current = messages.length;
      requestAnimationFrame(() => scrollToBottomOnly('auto'));
    }
  }, [conversationId, messages.length, scrollToBottomOnly]);

  useEffect(() => {
    const grew = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    if (!grew) return;

    queueMicrotask(() => {
      if (isNearBottom()) {
        scrollToBottomOnly('smooth');
      } else {
        setShowNewBanner(true);
      }
    });
  }, [messages, isNearBottom, scrollToBottomOnly]);

  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        bgcolor: 'grey.50',
        overflow: 'hidden',
      }}
      data-testid="conversation-messages-scroll"
    >
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          p: 2,
        }}
        onScroll={() => {
          if (isNearBottom()) setShowNewBanner(false);
        }}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && sorted.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            Sin mensajes
          </Typography>
        )}

        {!loading && !error && sorted.length > 0 && (
          <Stack spacing={1.5}>
            {sorted.map((msg) => {
              const role = resolveMessageBubbleRole(msg);
              const isUser = role === 'user';
              const isSystem = role === 'system';
              const isAgent = role === 'agent';
              const align = isSystem ? 'center' : isUser ? 'flex-start' : 'flex-end';

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
                        : isUser
                          ? 'background.paper'
                          : isAgent
                            ? 'success.light'
                            : 'primary.light',
                      color:
                        isUser || isSystem ? 'text.primary' : 'primary.contrastText',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" display="block">
                      {senderTypeLabel(msg.senderType)} · {formatTime(msg.createdAt)}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                      {messageDisplayBody(msg)}
                    </Typography>
                  </Paper>
                </Box>
              );
            })}
            <div ref={bottomRef} />
          </Stack>
        )}
      </Box>

      {showNewBanner && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
          }}
        >
          <Button size="small" variant="contained" onClick={() => scrollToBottom('smooth')}>
            Nuevos mensajes
          </Button>
        </Box>
      )}
    </Box>
  );
};
