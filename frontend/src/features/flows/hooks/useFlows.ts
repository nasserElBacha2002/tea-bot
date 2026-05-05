import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Flow, FlowSummary } from '../types/flow.types';
import { flowsApi } from '../api/flowsApi';

// ─── Keys ────────────────────────────────────────────────────────────────────
export const flowKeys = {
  all: ['flows'] as const,
  lists: () => [...flowKeys.all, 'list'] as const,
  detail: (id: string) => [...flowKeys.all, 'detail', id] as const,
};

export const flowVersionKeys = {
  list: (id: string) => [...flowKeys.all, 'versions', id] as const,
  publishedDetail: (id: string, v: string) =>
    [...flowKeys.all, 'publishedVersion', id, v] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────
export const useFlows = () =>
  useQuery<FlowSummary[]>({
    queryKey: flowKeys.lists(),
    queryFn: flowsApi.list,
  });

export const useFlow = (flowId: string) =>
  useQuery<Flow>({
    queryKey: flowKeys.detail(flowId),
    queryFn: () => flowsApi.get(flowId),
    enabled: !!flowId,
  });

// ─── Mutations ───────────────────────────────────────────────────────────────
export const useCreateFlow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flow: Partial<Flow>) => flowsApi.create(flow),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
};

export const useUpdateFlow = (flowId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flow: Partial<Flow>) => flowsApi.update(flowId, flow),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: flowKeys.lists() });
      qc.invalidateQueries({ queryKey: flowKeys.detail(flowId) });
    },
  });
};

export const usePublishFlow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flowId: string) => flowsApi.publish(flowId),
    onSuccess: (_d, flowId) => {
      qc.invalidateQueries({ queryKey: flowKeys.lists() });
      qc.invalidateQueries({ queryKey: flowKeys.detail(flowId) });
      qc.invalidateQueries({ queryKey: flowVersionKeys.list(flowId) });
    },
  });
};

export const useValidateFlow = () =>
  useMutation({
    mutationFn: (flow: Partial<Flow>) => flowsApi.validate(flow),
  });

export const useDuplicateFlow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, newId }: { flowId: string; newId: string }) =>
      flowsApi.duplicate(flowId, newId),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
};

export const useArchiveFlow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flowId: string) => flowsApi.archive(flowId),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
};

export const usePublishedVersions = (flowId: string, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: flowVersionKeys.list(flowId),
    queryFn: () => flowsApi.listVersions(flowId),
    enabled: !!flowId && (options?.enabled ?? true),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

export const usePublishedVersionDetail = (
  flowId: string,
  version: string | null,
  enabled: boolean
) =>
  useQuery({
    queryKey: flowVersionKeys.publishedDetail(flowId, version || ''),
    queryFn: () => flowsApi.getPublishedVersion(flowId, version!),
    enabled: !!flowId && !!version && enabled,
  });

export const useDuplicatePublishedToDraft = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      flowId,
      version,
      overwriteDraft,
    }: {
      flowId: string;
      version: string;
      overwriteDraft: boolean;
    }) => flowsApi.duplicatePublishedToDraft(flowId, version, overwriteDraft),
    onSuccess: (_d, { flowId }) => {
      qc.invalidateQueries({ queryKey: flowKeys.detail(flowId) });
      qc.invalidateQueries({ queryKey: flowVersionKeys.list(flowId) });
      qc.invalidateQueries({ queryKey: flowKeys.lists() });
    },
  });
};

export const useImportJsonAsNewVersion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      flowId,
      flow,
      publish,
    }: {
      flowId: string;
      flow: Partial<Flow>;
      publish?: boolean;
    }) => flowsApi.importJsonAsNewVersion(flowId, flow, publish),
    onSuccess: (_d, { flowId }) => {
      qc.invalidateQueries({ queryKey: flowVersionKeys.list(flowId) });
      qc.invalidateQueries({ queryKey: flowKeys.detail(flowId) });
      qc.invalidateQueries({ queryKey: flowKeys.lists() });
    },
  });
};
