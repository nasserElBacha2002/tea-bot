export type ConversationStatus =
  | 'bot'
  | 'waiting_human'
  | 'assigned'
  | 'closed'
  | 'paused';

export type ConversationChannel = 'whatsapp' | 'simulator';
export type ConversationProvider = 'twilio' | 'internal';

export interface ConversationLastMessage {
  body: string;
  direction: 'inbound' | 'outbound';
  senderType: 'user' | 'bot' | 'agent' | 'system';
  createdAt: string;
}

export interface ConversationHumanHandoff {
  id: string;
  status: string;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
  assignedAgentId?: string | null;
  assignedAt?: string | null;
  resolvedAt?: string | null;
}

export interface InboxConversationItem {
  id: string;
  channel: ConversationChannel;
  provider: ConversationProvider;
  phoneNumber: string | null;
  displayName: string | null;
  contactEmail?: string | null;
  status: ConversationStatus;
  assignedAgentId: string | null;
  currentFlowId: string | null;
  currentFlowVersion: string | null;
  currentNodeKey: string | null;
  lastMessageAt: string | null;
  startedAt: string;
  closedAt: string | null;
  lastMessage: ConversationLastMessage | null;
  humanHandoff: ConversationHumanHandoff | null;
}

export interface ConversationListResponse {
  items: InboxConversationItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConversationSessionDetail {
  id: string;
  flowId: string;
  flowVersion: string | null;
  currentNodeKey: string | null;
  status: string;
  history: string[];
  variables: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
}

export interface ConversationDetailResponse {
  conversation: Omit<InboxConversationItem, 'lastMessage' | 'humanHandoff'> & {
    lastMessageAt: string | null;
  };
  activeSession: ConversationSessionDetail | null;
  humanHandoff: ConversationHumanHandoff | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  senderType: 'user' | 'bot' | 'agent' | 'system';
  body: string;
  provider: string;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationMessagesResponse {
  items: ConversationMessage[];
  total: number;
  limit: number;
  offset: number;
  order: string;
}

export interface ConversationListFilters {
  status?: ConversationStatus | '';
  channel?: ConversationChannel | '';
  provider?: ConversationProvider | '';
  search?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}
