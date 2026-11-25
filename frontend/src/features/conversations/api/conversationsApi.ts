import axios from 'axios';
import { toUserFacingError } from '../../../utils/apiError';
import type {
  ConversationDetailResponse,
  ConversationListFilters,
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  ConversationGlobalSearchResponse,
  ConversationIntraSearchResponse,
  InboxConversationItem,
} from '../types/conversation.types';
import { resolveChannelForApi } from '../constants/conversationChannels';

import { resolveApiOrigin } from '../../../utils/apiOrigin';

const API_ORIGIN = resolveApiOrigin();

const client = axios.create({
  baseURL: `${API_ORIGIN}/api/conversations`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toUserFacingError(error)),
);

function buildParams(filters: ConversationListFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (filters.status) params.status = filters.status;
  const channel = resolveChannelForApi(filters.channel);
  if (channel) params.channel = channel;
  if (filters.provider) params.provider = filters.provider;
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.limit != null) params.limit = filters.limit;
  if (filters.offset != null) params.offset = filters.offset;
  if (filters.sort) params.sort = filters.sort;
  return params;
}

export interface SendMessageResponse {
  message: ConversationMessage;
  conversation: InboxConversationItem;
  idempotent?: boolean;
}

export interface AgentOutboundAttachment {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface OutboundAttachmentItem extends AgentOutboundAttachment {
  clientRequestId: string;
  includeBody?: boolean;
}

export interface SendAgentMessageInput {
  body?: string;
  attachment?: AgentOutboundAttachment;
  attachments?: OutboundAttachmentItem[];
  clientRequestId?: string;
  batchClientRequestId?: string;
}

export interface SendMessageBatchResponse {
  results: Array<{
    clientRequestId: string;
    ok: boolean;
    message?: ConversationMessage;
    error?: { code?: string; message?: string };
    deliveryState?: string;
    idempotent?: boolean;
  }>;
  partial: boolean;
  allSucceeded: boolean;
  conversation: InboxConversationItem;
}

export function conversationAttachmentContentUrl(
  conversationId: string,
  messageId: string,
  attachmentId: string,
  options: { download?: boolean } = {},
): string {
  const base = `${API_ORIGIN}/api/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}/content`;
  if (options.download) return `${base}?download=1`;
  return base;
}

export const conversationsApi = {
  list: async (filters: ConversationListFilters = {}): Promise<ConversationListResponse> => {
    const { data } = await client.get('/', { params: buildParams(filters) });
    return data.data;
  },

  getDetail: async (conversationId: string): Promise<ConversationDetailResponse> => {
    const { data } = await client.get(`/${conversationId}`);
    return data.data;
  },

  getMessages: async (
    conversationId: string,
    options: {
      limit?: number;
      offset?: number;
      order?: 'asc' | 'desc';
      tail?: string;
      aroundMessageId?: string;
      beforeMessageId?: string;
      afterMessageId?: string;
      before?: number;
      after?: number;
    } = {},
    requestConfig: { signal?: AbortSignal } = {},
  ): Promise<ConversationMessagesResponse> => {
    const { data } = await client.get(`/${conversationId}/messages`, {
      params: options,
      signal: requestConfig.signal,
    });
    return data.data;
  },

  searchGlobal: async (
    body: {
      q: string;
      limit?: number;
      cursorContact?: string | null;
      cursorMessage?: string | null;
      groups?: 'both' | 'contacts' | 'messages';
    },
    requestConfig: { signal?: AbortSignal } = {},
  ): Promise<ConversationGlobalSearchResponse> => {
    const { data } = await client.post('/search', body, { signal: requestConfig.signal });
    return data.data;
  },

  searchMessagesInConversation: async (
    conversationId: string,
    body: { q: string; limit?: number; cursor?: string | null },
    requestConfig: { signal?: AbortSignal } = {},
  ): Promise<ConversationIntraSearchResponse> => {
    const { data } = await client.post(`/${conversationId}/messages/search`, body, {
      signal: requestConfig.signal,
    });
    return data.data;
  },

  claim: async (conversationId: string): Promise<{ conversation: InboxConversationItem }> => {
    const { data } = await client.post(`/${conversationId}/claim`);
    return data.data;
  },

  takeover: async (
    conversationId: string,
    body: { reason?: string; expectedVersion?: number | null; clientRequestId?: string } = {},
  ): Promise<{ conversation: InboxConversationItem; idempotent?: boolean; assignedAgentLabel?: string | null }> => {
    const { data } = await client.post(`/${conversationId}/takeover`, body);
    return data.data;
  },

  sendMessage: async (
    conversationId: string,
    input: SendAgentMessageInput,
  ): Promise<SendMessageResponse | SendMessageBatchResponse> => {
    const { data } = await client.post(`/${conversationId}/messages`, {
      body: input.body ?? '',
      attachment: input.attachment,
      attachments: input.attachments,
      clientRequestId: input.clientRequestId,
      batchClientRequestId: input.batchClientRequestId,
    });
    return data.data;
  },

  close: async (
    conversationId: string,
    resolutionNote?: string,
  ): Promise<{ conversation: InboxConversationItem }> => {
    const { data } = await client.post(`/${conversationId}/close`, {
      resolutionNote: resolutionNote || undefined,
    });
    return data.data;
  },

  updateContact: async (
    conversationId: string,
    name: string,
  ): Promise<{
    conversationId: string;
    phone: string | null;
    contactName: string | null;
    displayName: string | null;
    conversation: InboxConversationItem;
  }> => {
    const { data } = await client.patch(`/${conversationId}/contact`, { name });
    return data.data;
  },
};
