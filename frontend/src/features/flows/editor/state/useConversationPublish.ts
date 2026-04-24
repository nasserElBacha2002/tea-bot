import { useCallback, useMemo, useState } from 'react';
import type { Flow } from '../../types/flow.types';
import {
  usePublishFlow,
  usePublishedVersionDetail,
  usePublishedVersions,
} from '../../hooks/useFlows';
import { conversationViewModelToFlow, flowToConversationViewModel } from '../model/conversationAdapters';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { validateConversationViewModel } from '../model/conversationValidation';
import { buildPublishChangeSummary, flowFingerprintForPublish } from '../model/publishSummary';
import { buildPublishWarnings } from '../model/publishWarnings';

export type PublishDialogStep = 'closed' | 'review' | 'confirm' | 'risky';

export interface UseConversationPublishParams {
  flowId: string;
  draftVm: ConversationViewModel;
  baseFlow: Flow;
  editorDirty: boolean;
  /** Debe persistir el borrador actual; puede ser no-op si no hay cambios sin guardar. */
  saveDraft: () => Promise<void>;
}

export function useConversationPublish({
  flowId,
  draftVm,
  baseFlow,
  editorDirty,
  saveDraft,
}: UseConversationPublishParams) {
  const [step, setStep] = useState<PublishDialogStep>('closed');
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishFlow = usePublishFlow();
  const { data: versions, isLoading: versionsLoading } = usePublishedVersions(flowId);
  const activeVersion = versions?.activeVersion ?? null;
  const { data: publishedDetail, isLoading: publishedLoading } = usePublishedVersionDetail(
    flowId,
    activeVersion,
    Boolean(activeVersion)
  );

  const baselineVm = useMemo(() => {
    if (!publishedDetail?.flow) return null;
    return flowToConversationViewModel(publishedDetail.flow);
  }, [publishedDetail]);

  const changeSummary = useMemo(
    () => buildPublishChangeSummary(draftVm, baselineVm),
    [draftVm, baselineVm]
  );

  const validationIssues = useMemo(() => validateConversationViewModel(draftVm), [draftVm]);

  const { blocking: blockingWarnings, nonBlocking: nonBlockingWarnings } = useMemo(
    () =>
      buildPublishWarnings(draftVm, validationIssues, {
        hasUnsavedChanges: editorDirty,
        isFirstPublish: activeVersion == null,
      }),
    [draftVm, validationIssues, editorDirty, activeVersion]
  );

  const draftFlow = useMemo(() => conversationViewModelToFlow(draftVm, baseFlow), [draftVm, baseFlow]);

  const baselineFingerprint = useMemo(
    () => (publishedDetail?.flow ? flowFingerprintForPublish(publishedDetail.flow) : null),
    [publishedDetail]
  );
  const draftFingerprint = useMemo(() => flowFingerprintForPublish(draftFlow), [draftFlow]);

  const hasChangesToPublish = useMemo(() => {
    if (activeVersion == null) return true;
    return draftFingerprint !== baselineFingerprint || editorDirty;
  }, [activeVersion, draftFingerprint, baselineFingerprint, editorDirty]);

  const baselineLoading = versionsLoading || (Boolean(activeVersion) && publishedLoading);

  const canOpenPublish = Boolean(flowId) && hasChangesToPublish && !baselineLoading;

  const startPublishFlow = useCallback(() => {
    setPublishError(null);
    setStep('review');
  }, []);

  const closePublishFlow = useCallback(() => {
    setStep('closed');
    setPublishError(null);
  }, []);

  const goConfirm = useCallback(() => {
    setPublishError(null);
    setStep('confirm');
  }, []);

  const goRisky = useCallback(() => {
    setPublishError(null);
    setStep('risky');
  }, []);

  const runPublish = useCallback(async (): Promise<boolean> => {
    if (!flowId) return false;
    setPublishError(null);
    try {
      await saveDraft();
      await publishFlow.mutateAsync(flowId);
      setStep('closed');
      return true;
    } catch {
      setPublishError('No se pudo poner en vivo la conversación. Intenta nuevamente.');
      return false;
    }
  }, [saveDraft, publishFlow, flowId]);

  const confirmPublish = useCallback(async (): Promise<boolean> => runPublish(), [runPublish]);

  const confirmRiskyPublish = useCallback(async (): Promise<boolean> => runPublish(), [runPublish]);

  return {
    step,
    changeSummary,
    blockingWarnings,
    nonBlockingWarnings,
    canOpenPublish,
    baselineLoading,
    hasBlockingWarnings: blockingWarnings.length > 0,
    isPublishing: publishFlow.isPending,
    publishError,
    startPublishFlow,
    closePublishFlow,
    goConfirm,
    goRisky,
    confirmPublish,
    confirmRiskyPublish,
    clearPublishError: () => setPublishError(null),
  };
}
