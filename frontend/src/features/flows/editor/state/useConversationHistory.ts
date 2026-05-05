import { useCallback, useState } from 'react';
import axios from 'axios';
import type { Flow } from '../../types/flow.types';
import {
  useDuplicatePublishedToDraft,
  useImportJsonAsNewVersion,
  usePublishedVersions,
  useValidateFlow,
} from '../../hooks/useFlows';

export interface RestoreTarget {
  version: string;
  versionLabel: string;
  publishedAt: string;
}

export function useConversationHistory(flowId: string, options?: { enabled?: boolean }) {
  const versionsQuery = usePublishedVersions(flowId, { enabled: options?.enabled ?? true });
  const duplicateMutation = useDuplicatePublishedToDraft();
  const validateMutation = useValidateFlow();
  const importMutation = useImportJsonAsNewVersion();
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
    validateImportedFlow: (flow: Partial<Flow>) => validateMutation.mutateAsync(flow),
    importJsonAsNewVersion: (flow: Partial<Flow>, publish = false) =>
      importMutation.mutateAsync({ flowId, flow, publish }),
    isValidatingImport: validateMutation.isPending,
    isImporting: importMutation.isPending,
    lastError,
    clearError: () => setLastError(null),
  };
}
