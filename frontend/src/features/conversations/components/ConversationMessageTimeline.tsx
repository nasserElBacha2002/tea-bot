import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Stack, CircularProgress, Alert, Button } from '@mui/material';
import type { ConversationMessage } from '../types/conversation.types';
import { senderTypeLabel } from '../utils/conversationUiLabels';
import {
  messageDisplayBody,
  resolveMessageBubbleRole,
} from '../utils/conversationMessageDisplay';
import {
  findFirstUnreadMessage,
  getReadThroughAt,
  hasUnreadMessagesForAgent,
} from '../utils/conversationUnread';

interface Props {
  messages: ConversationMessage[];
  loading?: boolean;
  error?: string | null;
  conversationId?: string | null;
  readAt?: string | null;
  onCaughtUp?: (readThroughAt: string) => void;
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
  readAt = null,
  onCaughtUp,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showNewBanner, setShowNewBanner] = useState(false);
  const prevLenRef = useRef(0);
  const prevConvRef = useRef(conversationId);
  const initialAnchorDoneRef = useRef(false);

  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );

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

  const notifyCaughtUp = useCallback(() => {
    if (!sorted.length) return;
    onCaughtUp?.(getReadThroughAt(sorted));
  }, [onCaughtUp, sorted]);

  const scrollToFirstUnread = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const first = findFirstUnreadMessage(sorted, readAt);
      if (!first) return false;
      const el = messageRefs.current[first.id];
      if (el) {
        el.scrollIntoView({ behavior, block: 'start' });
        const last = sorted[sorted.length - 1];
        setShowNewBanner(Boolean(last && last.id !== first.id));
        return true;
      }
      return false;
    },
    [sorted, readAt],
  );

  const runInitialAnchor = useCallback(() => {
    if (!sorted.length) {
      setShowNewBanner(false);
      return;
    }
    const hasUnread = hasUnreadMessagesForAgent(sorted, readAt);
    if (hasUnread) {
      const anchored = scrollToFirstUnread('auto');
      if (!anchored) scrollToBottomOnly('auto');
    } else {
      scrollToBottomOnly('auto');
      setShowNewBanner(false);
      notifyCaughtUp();
    }
  }, [sorted, readAt, scrollToFirstUnread, scrollToBottomOnly, notifyCaughtUp]);

  useEffect(() => {
    if (conversationId !== prevConvRef.current) {
      prevConvRef.current = conversationId;
      prevLenRef.current = 0;
      initialAnchorDoneRef.current = false;
      setShowNewBanner(false);
      messageRefs.current = {};
    }
  }, [conversationId]);

  useEffect(() => {
    if (loading || !conversationId) return;
    if (sorted.length === 0) return;
    const needsAnchor = !initialAnchorDoneRef.current || prevLenRef.current === 0;
    if (!needsAnchor) return;
    initialAnchorDoneRef.current = true;
    prevLenRef.current = sorted.length;
    requestAnimationFrame(() => runInitialAnchor());
  }, [loading, conversationId, sorted.length, runInitialAnchor]);

  useEffect(() => {
    if (!initialAnchorDoneRef.current || loading) return;
    const prevLen = prevLenRef.current;
    const grew = sorted.length > prevLen;
    prevLenRef.current = sorted.length;
    if (!grew || prevLen === 0) return;

    queueMicrotask(() => {
      if (isNearBottom()) {
        scrollToBottomOnly('smooth');
        setShowNewBanner(false);
        notifyCaughtUp();
      } else {
        setShowNewBanner(true);
      }
    });
  }, [sorted, loading, isNearBottom, scrollToBottomOnly, notifyCaughtUp]);

  const handleScroll = useCallback(() => {
    if (!isNearBottom()) return;
    setShowNewBanner(false);
    notifyCaughtUp();
  }, [isNearBottom, notifyCaughtUp]);

  const handleJumpToLatest = useCallback(() => {
    scrollToBottom('smooth');
    notifyCaughtUp();
  }, [scrollToBottom, notifyCaughtUp]);

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
        onScroll={handleScroll}
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
                <Box
                  key={msg.id}
                  ref={(el: HTMLDivElement | null) => {
                    messageRefs.current[msg.id] = el;
                  }}
                  sx={{ display: 'flex', justifyContent: align }}
                >
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
          <Button size="small" variant="contained" onClick={handleJumpToLatest}>
            Ir al final
          </Button>
        </Box>
      )}
    </Box>
  );
};
