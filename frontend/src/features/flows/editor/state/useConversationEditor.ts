import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Flow } from '../../types/flow.types';
import type {
  ConversationResponse,
  ConversationResponseKind,
  ConversationViewModel,
} from '../model/conversationViewModel';
import { conversationViewModelToFlow } from '../model/conversationAdapters';
import { validateConversationViewModel } from '../model/conversationValidation';
import { shouldApplyServerHydration } from './conversationHydrationPolicy';
import { conversationEditorReducer, newInternalStepId } from './conversationEditorReducer';

export interface UseConversationEditorOptions {
  /** View-model derivado del servidor (React Query); puede cambiar de referencia en cada refetch. */
  serverViewModel: ConversationViewModel | null;
  remoteFlowId: string;
  onCreatedStep?: (internalId: string) => void;
}

export function useConversationEditor({
  serverViewModel,
  remoteFlowId,
  onCreatedStep,
}: UseConversationEditorOptions) {
  const [state, dispatch] = useReducer(conversationEditorReducer, {
    viewModel: null as ConversationViewModel | null,
    dirty: false,
  });

  const dirtyRef = useRef(false);
  const lastHydratedFlowIdRef = useRef<string | null>(null);

  useEffect(() => {
    dirtyRef.current = state.dirty;
  }, [state.dirty]);

  useEffect(() => {
    if (!serverViewModel || !remoteFlowId) return;

    const allow = shouldApplyServerHydration({
      incomingFlowId: remoteFlowId,
      lastHydratedFlowId: lastHydratedFlowIdRef.current,
      editorDirty: dirtyRef.current,
    });

    if (!allow) return;

    dispatch({ type: 'HYDRATE', payload: serverViewModel });
    lastHydratedFlowIdRef.current = remoteFlowId;
  }, [serverViewModel, remoteFlowId]);

  const hydrateFromServer = useCallback((vm: ConversationViewModel) => {
    lastHydratedFlowIdRef.current = vm.flowId;
    dispatch({ type: 'HYDRATE', payload: vm });
  }, []);

  const buildSavePayload = useCallback(
    (base: Flow): Flow => {
      if (!state.viewModel) {
        throw new Error('Conversation editor has no view model to save');
      }
      return conversationViewModelToFlow(state.viewModel, base);
    },
    [state.viewModel]
  );

  const viewModel = state.viewModel;
  const dirty = state.dirty;

  const validationIssues = useMemo(
    () => (viewModel ? validateConversationViewModel(viewModel) : []),
    [viewModel]
  );

  const updateFlowInfo = useCallback((flowName: string, description: string) => {
    dispatch({ type: 'UPDATE_FLOW_INFO', flowName, description });
  }, []);

  const updateStepTitle = useCallback((stepId: string, title: string) => {
    dispatch({ type: 'UPDATE_STEP_TITLE', stepId, title });
  }, []);

  const updateStepMessage = useCallback((stepId: string, message: string) => {
    dispatch({ type: 'UPDATE_STEP_MESSAGE', stepId, message });
  }, []);

  const addStep = useCallback(() => {
    dispatch({ type: 'ADD_STEP' });
  }, []);

  const deleteStep = useCallback((stepId: string) => {
    dispatch({ type: 'DELETE_STEP', stepId });
  }, []);

  const duplicateStep = useCallback((stepId: string) => {
    dispatch({ type: 'DUPLICATE_STEP', stepId });
  }, []);

  const reorderSteps = useCallback((sourceIndex: number, targetIndex: number) => {
    dispatch({ type: 'REORDER_STEPS', fromIndex: sourceIndex, toIndex: targetIndex });
  }, []);

  const addResponse = useCallback((stepId: string, kind: ConversationResponseKind) => {
    dispatch({ type: 'ADD_RESPONSE', stepId, kind });
  }, []);

  const updateResponse = useCallback(
    (stepId: string, responseUiId: string, patch: Partial<Pick<ConversationResponse, 'values' | 'kind'>>) => {
      dispatch({ type: 'UPDATE_RESPONSE', stepId, responseUiId, patch });
    },
    []
  );

  const deleteResponse = useCallback((stepId: string, responseUiId: string) => {
    dispatch({ type: 'DELETE_RESPONSE', stepId, responseUiId });
  }, []);

  const setResponseDestination = useCallback(
    (stepId: string, responseUiId: string, targetStepId: string) => {
      dispatch({ type: 'SET_RESPONSE_DESTINATION', stepId, responseUiId, targetStepId });
    },
    []
  );

  const createStepAndAssignDestination = useCallback(
    (stepId: string, responseUiId: string) => {
      const newStepInternalId = newInternalStepId();
      dispatch({
        type: 'CREATE_STEP_AND_ASSIGN',
        stepId,
        responseUiId,
        newStepInternalId,
      });
      onCreatedStep?.(newStepInternalId);
    },
    [onCreatedStep]
  );

  return {
    viewModel,
    dirty,
    validationIssues,
    updateFlowInfo,
    updateStepTitle,
    updateStepMessage,
    addStep,
    deleteStep,
    duplicateStep,
    reorderSteps,
    addResponse,
    updateResponse,
    deleteResponse,
    setResponseDestination,
    createStepAndAssignDestination,
    hydrateFromServer,
    buildSavePayload,
    isReady: Boolean(viewModel),
  };
}
