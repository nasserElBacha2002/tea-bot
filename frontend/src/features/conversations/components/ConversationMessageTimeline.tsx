import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Stack, CircularProgress, Alert, Button } from '@mui/material';
import type { ConversationMessage } from '../types/conversation.types';
import { highlightTermInPlainText } from '../utils/searchHighlight';
import { messageEventLabel, senderTypeLabel } from '../utils/conversationUiLabels';
import {
  messageDisplayBody,
  messageHasVisibleBody,
  messageIsAttachmentOnly,
  resolveMessageBubbleRole,
  type MessageBubbleRole,
} from '../utils/conversationMessageDisplay';
import { MessageInboundAttachments } from './MessageInboundAttachments';
import { MessageOutboundDelivery } from './MessageOutboundDelivery';
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
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  loadingOlder?: boolean;
  loadingNewer?: boolean;
  onLoadOlder?: () => Promise<boolean | void>;
  onLoadNewer?: () => Promise<boolean | void>;
  scrollTargetMessageId?: string | null;
  onConsumeScrollTarget?: () => void;
  highlightedMessageId?: string | null;
  intraSearchTerm?: string;
  historyPinned?: boolean;
  onReturnToRecent?: () => void;
  onCaughtUpWhenPinned?: boolean;
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
  hasMoreBefore,
  hasMoreAfter,
  loadingOlder,
  loadingNewer,
  onLoadOlder,
  onLoadNewer,
  scrollTargetMessageId = null,
  onConsumeScrollTarget,
  highlightedMessageId = null,
  intraSearchTerm = '',
  historyPinned = false,
  onReturnToRecent,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadOlderLockRef = useRef(false);
  const loadNewerLockRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const scrollRestoreConvRef = useRef<string | null>(null);
  const scrollTargetRafRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showNewBanner, setShowNewBanner] = useState(false);
  const prevLenRef = useRef(0);
  const prevConvRef = useRef(conversationId);
  const initialAnchorDoneRef = useRef(false);

  const sorted = useMemo(() => {
    if (messages.length <= 1) return messages;
    for (let i = 1; i < messages.length; i += 1) {
      const prev = Date.parse(messages[i - 1].createdAt);
      const cur = Date.parse(messages[i].createdAt);
      if (cur < prev) {
        return [...messages].sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
        );
      }
    }
    return messages;
  }, [messages]);

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

  useEffect(() => {
    if (!scrollTargetMessageId) return;
    if (scrollTargetRafRef.current != null) {
      cancelAnimationFrame(scrollTargetRafRef.current);
    }
    scrollTargetRafRef.current = requestAnimationFrame(() => {
      scrollTargetRafRef.current = null;
      const el = messageRefs.current[scrollTargetMessageId];
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
      onConsumeScrollTarget?.();
    });
    return () => {
      if (scrollTargetRafRef.current != null) {
        cancelAnimationFrame(scrollTargetRafRef.current);
        scrollTargetRafRef.current = null;
      }
    };
  }, [scrollTargetMessageId, onConsumeScrollTarget]);

  const runInitialAnchor = useCallback(() => {
    if (scrollTargetMessageId || historyPinned) return;
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
  }, [sorted, readAt, scrollToFirstUnread, scrollToBottomOnly, notifyCaughtUp, scrollTargetMessageId, historyPinned]);

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
    if (historyPinned || scrollTargetMessageId) return;
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
  }, [sorted, loading, isNearBottom, scrollToBottomOnly, notifyCaughtUp, historyPinned, scrollTargetMessageId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (
      el
      && el.scrollTop < 48
      && hasMoreBefore
      && onLoadOlder
      && !loadOlderLockRef.current
      && !loadingOlder
    ) {
      loadOlderLockRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      scrollRestoreConvRef.current = conversationId ?? null;
      void onLoadOlder()
        .then((applied) => {
          if (!applied) return;
          requestAnimationFrame(() => {
            const target = scrollRef.current;
            if (!target || scrollRestoreConvRef.current !== conversationId) return;
            target.scrollTop = target.scrollHeight - prevScrollHeightRef.current;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          loadOlderLockRef.current = false;
        });
    }
    if (
      el
      && hasMoreAfter
      && onLoadNewer
      && !loadNewerLockRef.current
      && !loadingNewer
    ) {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 96) {
        loadNewerLockRef.current = true;
        void onLoadNewer()
          .catch(() => undefined)
          .finally(() => {
            loadNewerLockRef.current = false;
          });
      }
    }
    if (historyPinned) return;
    if (!isNearBottom()) return;
    setShowNewBanner(false);
    notifyCaughtUp();
  }, [isNearBottom, notifyCaughtUp, hasMoreBefore, hasMoreAfter, onLoadOlder, onLoadNewer, loadingOlder, loadingNewer, historyPinned]);

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

        {(loadingOlder || loadingNewer) && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={18} />
          </Box>
        )}

        {historyPinned && onReturnToRecent && (
          <Box sx={{ pb: 1, textAlign: 'center' }}>
            <Button size="small" variant="outlined" onClick={onReturnToRecent}>
              Volver a mensajes recientes
            </Button>
          </Box>
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
                    {messageEventLabel(firstMsg.metadata) ?? senderTypeLabel(firstMsg.senderType)} · {formatTime(firstMsg.createdAt)}
                  </Typography>
                  {group.messages.map((msg, index) => {
                    const isLastInGroup = index === group.messages.length - 1;
                    const isFocus = highlightedMessageId === msg.id;
                    const attachmentOnly = messageIsAttachmentOnly(msg);
                    const neutralAttachmentBubble =
                      attachmentOnly && !isUser && !isSystem;
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
                            outline: isFocus ? '2px solid' : undefined,
                            outlineColor: isFocus ? 'warning.main' : undefined,
                            px: neutralAttachmentBubble ? 0.75 : conversationUiDensity.bubblePaddingX,
                            py: neutralAttachmentBubble ? 0.5 : conversationUiDensity.bubblePaddingY,
                            maxWidth: neutralAttachmentBubble ? 'min(78%, 360px)' : '78%',
                            width: 'fit-content',
                            bgcolor: isSystem
                              ? 'grey.200'
                              : neutralAttachmentBubble || isUser
                                ? 'background.paper'
                                : isAgent
                                  ? 'success.light'
                                  : 'primary.light',
                            color:
                              neutralAttachmentBubble || isUser || isSystem
                                ? 'text.primary'
                                : 'primary.contrastText',
                            border: neutralAttachmentBubble ? 'none' : '1px solid',
                            borderColor: 'divider',
                            boxShadow: neutralAttachmentBubble ? 1 : 0,
                            borderBottomLeftRadius: isUser && !isLastInGroup ? 6 : undefined,
                            borderBottomRightRadius: !isUser && !isSystem && !isLastInGroup ? 6 : undefined,
                          }}
                        >
                          {messageHasVisibleBody(msg) && (
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.45 }}>
                              {intraSearchTerm.trim().length >= 2
                                ? highlightTermInPlainText(messageDisplayBody(msg), intraSearchTerm)
                                : messageDisplayBody(msg)}
                            </Typography>
                          )}
                          <MessageInboundAttachments message={msg} />
                          {!isUser && !isSystem && <MessageOutboundDelivery message={msg} />}
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
