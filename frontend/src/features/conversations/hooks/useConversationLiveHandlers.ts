import { useEffect } from 'react';
import { useConversationLive, type ConversationLiveHandlers } from '../context/conversationLiveContext';

/** Registers page-level unread/handoff handlers for the shared live socket. */
export function useConversationLiveHandlers(handlers: ConversationLiveHandlers): void {
  const { registerHandlers } = useConversationLive();
  const { onUnread, onNewConversation, onHandoffWaiting, onLiveEvent } = handlers;

  useEffect(() => {
    return registerHandlers({ onUnread, onNewConversation, onHandoffWaiting, onLiveEvent });
  }, [registerHandlers, onUnread, onNewConversation, onHandoffWaiting, onLiveEvent]);
}
