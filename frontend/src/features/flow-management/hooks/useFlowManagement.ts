import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flowManagementApi } from '../api/flowManagementApi';

export function useFlowsCatalog() {
  return useQuery({
    queryKey: ['flow-management', 'flows'],
    queryFn: () => flowManagementApi.listFlows(),
  });
}

export function useFlowDetail(flowId: string | undefined) {
  return useQuery({
    queryKey: ['flow-management', 'flow', flowId],
    queryFn: () => flowManagementApi.getFlow(flowId!),
    enabled: Boolean(flowId),
  });
}

export function useFlowVersions(flowId: string | undefined) {
  return useQuery({
    queryKey: ['flow-management', 'versions', flowId],
    queryFn: () => flowManagementApi.listVersions(flowId!),
    enabled: Boolean(flowId),
  });
}

export function useFlowVersion(versionId: string | undefined) {
  return useQuery({
    queryKey: ['flow-management', 'version', versionId],
    queryFn: () => flowManagementApi.getVersion(versionId!),
    enabled: Boolean(versionId),
  });
}

export function useCreateDraft(flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (baseVersionId: string) => flowManagementApi.createDraft(flowId, baseVersionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management'] });
    },
  });
}

export function useValidateFlowVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => flowManagementApi.validate(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management', 'version', versionId] });
    },
  });
}

export function usePublishFlowVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => flowManagementApi.publish(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management'] });
    },
  });
}

export function useDiscardDraft(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => flowManagementApi.discardDraft(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management'] });
    },
  });
}

export function useUpdateFlowNode(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, patch }: { nodeId: string; patch: Record<string, unknown> }) =>
      flowManagementApi.updateNode(nodeId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management', 'version', versionId] });
    },
  });
}

export function useCreateTransition(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      nodeId,
      body,
    }: {
      nodeId: string;
      body: { type: string; value?: unknown; nextNodeKey: string; priority?: number };
    }) => flowManagementApi.createTransition(nodeId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management', 'version', versionId] });
    },
  });
}

export function useDeleteTransition(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transitionId: string) => flowManagementApi.deleteTransition(transitionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-management', 'version', versionId] });
    },
  });
}
