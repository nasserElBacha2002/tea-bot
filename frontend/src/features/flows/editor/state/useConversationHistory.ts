import { useCallback, useState } from 'react';
import axios from 'axios';
import {
  useDuplicatePublishedToDraft,
  usePublishedVersions,
} from '../../hooks/useFlows';

export interface RestoreTarget {
  version: string;
  versionLabel: string;
  publishedAt: string;
}

export function useConversationHistory(flowId: string) {
  const versionsQuery = usePublishedVersions(flowId);
  const duplicateMutation = useDuplicatePublishedToDraft();
  const [lastError, setLastError] = useState<string | null>(null);

  const restoreVersionToDraft = useCallback(
    async (target: RestoreTarget) => {
      setLastError(null);
      try {
        await duplicateMutation.mutateAsync({
          flowId,
          version: target.version,
          overwriteDraft: true,
        });
        return { ok: true as const };
      } catch (e: unknown) {
        if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === 'object') {
          const msg = (e.response.data as { error?: string }).error;
          setLastError(msg || e.message);
        } else {
          setLastError(e instanceof Error ? e.message : 'No se pudo traer esa versión al borrador.');
        }
        return { ok: false as const };
      }
    },
    [duplicateMutation, flowId]
  );

  return {
    versionsQuery,
    restoreVersionToDraft,
    isRestoring: duplicateMutation.isPending,
    lastError,
    clearError: () => setLastError(null),
  };
}
