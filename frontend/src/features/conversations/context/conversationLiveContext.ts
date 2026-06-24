import { createContext, useContext } from 'react';
import type { LiveConnectionStatus } from '../hooks/useConversationsLiveUpdates';

export interface ConversationLiveHandlers {
  onUnread?: (conversationId: string) => void;
  onNewConversation?: (conversationId: string) => void;
  onHandoffWaiting?: (conversationId: string) => void;
}

export interface ConversationLiveContextValue {
  status: LiveConnectionStatus;
  markManual: () => void;
  reconnect: () => void;
  setSelectedConversationId: (id: string | null) => void;
  registerHandlers: (handlers: ConversationLiveHandlers) => () => void;
  soundAlertsEnabled: boolean;
  setSoundAlertsEnabled: (enabled: boolean) => void;
  soundBlocked: boolean;
  unlockSound: () => Promise<boolean>;
}

export const ConversationLiveContext = createContext<ConversationLiveContextValue | null>(null);

export function useConversationLive(): ConversationLiveContextValue {
  const ctx = useContext(ConversationLiveContext);
  if (!ctx) {
    throw new Error('useConversationLive must be used within ConversationLiveProvider');
  }
  return ctx;
}
