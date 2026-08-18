import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Stack, CircularProgress, Alert, Button } from '@mui/material';
import type { ConversationMessage } from '../types/conversation.types';
import { senderTypeLabel } from '../utils/conversationUiLabels';
import {
  messageDisplayBody,
  resolveMessageBubbleRole,
  type MessageBubbleRole,
} from '../utils/conversationMessageDisplay';
import {
  findFirstUnreadMessage,
  getReadThroughAt,
  hasUnreadMessagesForAgent,
} from '../utils/conversationUnread';
import { conversationUiDensity } from '../constants/conversationUiDensity';

interface Props {
  messages: ConversationMessage[];
  loading?: boolean;
  error?: string | null;
  conversationId?: string | null;
  readAt?: string | null;
  onCaughtUp?: (readThroughAt: string) => void;
  scrollFooter?: React.ReactNode;
}

interface MessageGroup {
  role: MessageBubbleRole;
  messages: ConversationMessage[];
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

function groupMessages(messages: ConversationMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const role = resolveMessageBubbleRole(msg);
    const last = groups[groups.length - 1];
    if (last && last.role === role && role !== 'system') {
      last.messages.push(msg);
    } else {
      groups.push({ role, messages: [msg] });
    }
  }
  return groups;
}

const SCROLL_NEAR_BOTTOM_PX = 80;

export const ConversationMessageTimeline: React.FC<Props> = ({
  messages,
  loading,
  error,
  conversationId,
  readAt = null,
  onCaughtUp,
  scrollFooter,
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

  const groups = useMemo(() => groupMessages(sorted), [sorted]);

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
        data-testid="conversation-messages-scroll-region"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          px: conversationUiDensity.messageAreaPaddingX,
          py: conversationUiDensity.messageAreaPaddingY,
        }}
        onScroll={handleScroll}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && sorted.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }} variant="body2">
            Sin mensajes
          </Typography>
        )}

        {!loading && !error && sorted.length > 0 && (
          <Stack spacing={conversationUiDensity.messageGapGroup}>
            {groups.map((group) => {
              const isUser = group.role === 'user';
              const isSystem = group.role === 'system';
              const isAgent = group.role === 'agent';
              const align = isSystem ? 'center' : isUser ? 'flex-start' : 'flex-end';
              const firstMsg = group.messages[0];

              return (
                <Stack
                  key={firstMsg.id}
                  spacing={conversationUiDensity.messageGapSameSender}
                  sx={{ width: '100%' }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      px: 0.5,
                      textAlign: isSystem ? 'center' : isUser ? 'left' : 'right',
                      fontSize: '0.75rem',
                    }}
                  >
                    {senderTypeLabel(firstMsg.senderType)} · {formatTime(firstMsg.createdAt)}
                  </Typography>
                  {group.messages.map((msg, index) => {
                    const isLastInGroup = index === group.messages.length - 1;
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
                            px: conversationUiDensity.bubblePaddingX,
                            py: conversationUiDensity.bubblePaddingY,
                            maxWidth: '78%',
                            width: 'fit-content',
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
                            borderBottomLeftRadius: isUser && !isLastInGroup ? 6 : undefined,
                            borderBottomRightRadius: !isUser && !isSystem && !isLastInGroup ? 6 : undefined,
                          }}
                        >
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.45 }}>
                            {messageDisplayBody(msg)}
                          </Typography>
                        </Paper>
                      </Box>
                    );
                  })}
                </Stack>
              );
            })}
            {scrollFooter}
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
