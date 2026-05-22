import axios from 'axios';
import { toUserFacingError } from '../../../utils/apiError';
import type {
  ConversationDetailResponse,
  ConversationListFilters,
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  InboxConversationItem,
} from '../types/conversation.types';

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
  if (filters.channel) params.channel = filters.channel;
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
    options: { limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
  ): Promise<ConversationMessagesResponse> => {
    const { data } = await client.get(`/${conversationId}/messages`, { params: options });
    return data.data;
  },

  claim: async (conversationId: string): Promise<{ conversation: InboxConversationItem }> => {
    const { data } = await client.post(`/${conversationId}/claim`);
    return data.data;
  },

  sendMessage: async (
    conversationId: string,
    body: string,
  ): Promise<SendMessageResponse> => {
    const { data } = await client.post(`/${conversationId}/messages`, { body });
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

  returnToBot: async (
    conversationId: string,
  ): Promise<{ conversation: InboxConversationItem }> => {
    const { data } = await client.post(`/${conversationId}/return-to-bot`);
    return data.data;
  },
};
