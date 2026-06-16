import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '../api/conversationsApi';
import type { ConversationListFilters, InboxConversationItem } from '../types/conversation.types';

export const conversationKeys = {
  all: ['conversations'] as const,
  list: (filters: ConversationListFilters) => [...conversationKeys.all, 'list', filters] as const,
  detail: (id: string) => [...conversationKeys.all, 'detail', id] as const,
  messages: (id: string) => [...conversationKeys.all, 'messages', id] as const,
};

export function useConversations(filters: ConversationListFilters) {
  return useQuery({
    queryKey: conversationKeys.list(filters),
    queryFn: () => conversationsApi.list(filters),
  });
}

export function useConversationDetail(conversationId: string | null) {
  return useQuery({
    queryKey: conversationKeys.detail(conversationId ?? ''),
    queryFn: () => conversationsApi.getDetail(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: conversationKeys.messages(conversationId ?? ''),
    queryFn: () => conversationsApi.getMessages(conversationId!, { limit: 200, order: 'asc' }),
    enabled: Boolean(conversationId),
  });
}

export function useRefreshConversations() {
  const queryClient = useQueryClient();
  return async (conversationId?: string | null) => {
    await queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    if (conversationId) {
      await queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      await queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    }
  };
}

export function useClaimConversation(filters: ConversationListFilters) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => conversationsApi.claim(conversationId),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(filters) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
    },
  });
}

export function useSendAgentMessage(filters: ConversationListFilters) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body }: { conversationId: string; body: string }) =>
      conversationsApi.sendMessage(conversationId, body),
    onSuccess: (_data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(filters) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    },
  });
}

export function useCloseConversation(filters: ConversationListFilters) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      resolutionNote,
    }: {
      conversationId: string;
      resolutionNote?: string;
    }) => conversationsApi.close(conversationId, resolutionNote),
    onSuccess: (_data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(filters) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    },
  });
}

export function useUpdateContact(filters: ConversationListFilters) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, name }: { conversationId: string; name: string }) =>
      conversationsApi.updateContact(conversationId, name),
    onSuccess: (data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(filters) });
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      const detailKey = conversationKeys.detail(conversationId);
      const prev = queryClient.getQueryData(detailKey);
      if (prev && data.conversation) {
        queryClient.setQueryData(detailKey, {
          ...prev,
          conversation: {
            ...(prev as { conversation: InboxConversationItem }).conversation,
            ...data.conversation,
            displayName: data.contactName,
          },
        });
      }
    },
  });
}
