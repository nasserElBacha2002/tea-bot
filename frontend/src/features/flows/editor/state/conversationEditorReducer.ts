import { v4 as uuidv4 } from 'uuid';
import type { ConversationResponse, ConversationResponseKind, ConversationStep, ConversationViewModel } from '../model/conversationViewModel';
import { humanizeNodeId } from '../model/conversationAdapters';

export function newInternalStepId(): string {
  return `step-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Mantiene fallback al final y displayOrder coherente; conserva uiId salvo nuevas filas. */
export function normalizeResponseList(responses: ConversationResponse[]): ConversationResponse[] {
  const non = responses.filter(r => r.kind !== 'fallback');
  const fb = responses.filter(r => r.kind === 'fallback');
  const merged = [...non, ...fb];
  return merged.map((r, i) => ({ ...r, displayOrder: i }));
}

function defaultDestinationForStep(vm: ConversationViewModel, stepInternalId: string): string {
  const other = vm.steps.find(s => s.internalId !== stepInternalId);
  return other?.internalId ?? stepInternalId;
}

function createBlankMessageStep(internalId: string, index: number): ConversationStep {
  return {
    uiId: internalId,
    internalId,
    title: 'Nuevo paso',
    message: '',
    responses: [],
    metadata: {
      nodeType: 'message',
      position: { x: 80 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 180 },
    },
  };
}

function cloneStep(step: ConversationStep, newInternalId: string, insertIndex: number): ConversationStep {
  return {
    ...step,
    uiId: newInternalId,
    internalId: newInternalId,
    title: `${step.title} (copia)`,
    responses: step.responses.map((r, i) => ({
      ...r,
      uiId: uuidv4(),
      displayOrder: i,
    })),
    metadata: {
      ...step.metadata,
      position: {
        x: 80 + (insertIndex % 3) * 280,
        y: 80 + Math.floor(insertIndex / 3) * 180,
      },
    },
  };
}

function remapDestinations(
  steps: ConversationStep[],
  removedId: string,
  replacementId: string
): ConversationStep[] {
  return steps.map(s => ({
    ...s,
    responses: s.responses.map(r =>
      r.destinationStepId === removedId ? { ...r, destinationStepId: replacementId } : r
    ),
  }));
}

export type ConversationEditorAction =
  | { type: 'HYDRATE'; payload: ConversationViewModel }
  | { type: 'UPDATE_FLOW_INFO'; flowName: string; description: string }
  | { type: 'UPDATE_STEP_TITLE'; stepId: string; title: string }
  | { type: 'UPDATE_STEP_MESSAGE'; stepId: string; message: string }
  | { type: 'ADD_STEP' }
  | { type: 'DELETE_STEP'; stepId: string }
  | { type: 'DUPLICATE_STEP'; stepId: string }
  | { type: 'REORDER_STEPS'; fromIndex: number; toIndex: number }
  | { type: 'ADD_RESPONSE'; stepId: string; kind: ConversationResponseKind }
  | {
      type: 'UPDATE_RESPONSE';
      stepId: string;
      responseUiId: string;
      patch: Partial<Pick<ConversationResponse, 'values' | 'kind'>>;
    }
  | { type: 'DELETE_RESPONSE'; stepId: string; responseUiId: string }
  | { type: 'SET_RESPONSE_DESTINATION'; stepId: string; responseUiId: string; targetStepId: string }
  | {
      type: 'CREATE_STEP_AND_ASSIGN';
      stepId: string;
      responseUiId: string;
      newStepInternalId: string;
    };

export interface ConversationEditorReducerState {
  viewModel: ConversationViewModel | null;
  dirty: boolean;
}

export function conversationEditorReducer(
  state: ConversationEditorReducerState,
  action: ConversationEditorAction
): ConversationEditorReducerState {
  if (action.type === 'HYDRATE') {
    return { viewModel: action.payload, dirty: false };
  }
  const vm = state.viewModel;
  if (!vm) return state;

  switch (action.type) {

    case 'UPDATE_FLOW_INFO': {
      const name = action.flowName.trim() || vm.flowName;
      const desc = action.description.trim();
      return {
        viewModel: {
          ...vm,
          flowName: name,
          description: desc === '' ? undefined : desc,
        },
        dirty: true,
      };
    }

    case 'UPDATE_STEP_TITLE': {
      const steps = vm.steps.map(s =>
        s.internalId === action.stepId ? { ...s, title: action.title } : s
      );
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'UPDATE_STEP_MESSAGE': {
      const steps = vm.steps.map(s =>
        s.internalId === action.stepId ? { ...s, message: action.message } : s
      );
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'ADD_STEP': {
      const id = newInternalStepId();
      const step = createBlankMessageStep(id, vm.steps.length);
      return { viewModel: { ...vm, steps: [...vm.steps, step] }, dirty: true };
    }

    case 'DELETE_STEP': {
      if (vm.steps.length <= 1) return state;
      const idx = vm.steps.findIndex(s => s.internalId === action.stepId);
      if (idx < 0) return state;
      const removed = vm.steps[idx];
      const remaining = vm.steps.filter(s => s.internalId !== action.stepId);
      const replacement = remaining[0]?.internalId ?? vm.fallbackStepId;
      const steps = remapDestinations(remaining, removed.internalId, replacement);
      let entryStepId = vm.entryStepId === removed.internalId ? replacement : vm.entryStepId;
      let fallbackStepId = vm.fallbackStepId === removed.internalId ? replacement : vm.fallbackStepId;
      if (!steps.some(s => s.internalId === entryStepId)) entryStepId = steps[0].internalId;
      if (!steps.some(s => s.internalId === fallbackStepId)) fallbackStepId = steps[0].internalId;
      return {
        viewModel: { ...vm, steps, entryStepId, fallbackStepId },
        dirty: true,
      };
    }

    case 'DUPLICATE_STEP': {
      const idx = vm.steps.findIndex(s => s.internalId === action.stepId);
      if (idx < 0) return state;
      const newId = newInternalStepId();
      const dup = cloneStep(vm.steps[idx], newId, idx + 1);
      const steps = [...vm.steps.slice(0, idx + 1), dup, ...vm.steps.slice(idx + 1)];
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'REORDER_STEPS': {
      const { fromIndex, toIndex } = action;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= vm.steps.length ||
        toIndex >= vm.steps.length
      ) {
        return state;
      }
      const steps = [...vm.steps];
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, moved);
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'ADD_RESPONSE': {
      const dest = defaultDestinationForStep(vm, action.stepId);
      const step = vm.steps.find(s => s.internalId === action.stepId);
      if (!step) return state;
      if (action.kind === 'fallback' && step.responses.some(r => r.kind === 'fallback')) {
        return state;
      }
      const base: ConversationResponse = {
        uiId: uuidv4(),
        kind: action.kind,
        values: action.kind === 'exact' ? [''] : action.kind === 'anyOf' ? [] : [],
        destinationStepId: dest,
        displayOrder: step.responses.length,
      };
      const newResponses = normalizeResponseList([...step.responses, base]);
      const steps = vm.steps.map(s =>
        s.internalId === action.stepId ? { ...s, responses: newResponses } : s
      );
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'UPDATE_RESPONSE': {
      const steps = vm.steps.map(s => {
        if (s.internalId !== action.stepId) return s;
        const responses = s.responses.map(r => {
          if (r.uiId !== action.responseUiId) return r;
          let next = { ...r, ...action.patch };
          if (action.patch.kind === 'fallback') {
            next = { ...next, values: [], kind: 'fallback' };
          }
          if (action.patch.kind === 'exact' && (!next.values || next.values.length === 0)) {
            next = { ...next, values: [''] };
          }
          if (action.patch.kind === 'anyOf') {
            next = { ...next, values: next.values?.length ? next.values : [] };
          }
          return next;
        });
        return { ...s, responses: normalizeResponseList(responses) };
      });
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'DELETE_RESPONSE': {
      const steps = vm.steps.map(s => {
        if (s.internalId !== action.stepId) return s;
        const responses = normalizeResponseList(
          s.responses.filter(r => r.uiId !== action.responseUiId)
        );
        return { ...s, responses };
      });
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'SET_RESPONSE_DESTINATION': {
      const steps = vm.steps.map(s => {
        if (s.internalId !== action.stepId) return s;
        const responses = s.responses.map(r =>
          r.uiId === action.responseUiId ? { ...r, destinationStepId: action.targetStepId } : r
        );
        return { ...s, responses };
      });
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    case 'CREATE_STEP_AND_ASSIGN': {
      const { stepId, responseUiId, newStepInternalId } = action;
      const insertIndex = vm.steps.length;
      const newStep = createBlankMessageStep(newStepInternalId, insertIndex);
      newStep.title = humanizeNodeId(newStepInternalId);
      const stepsWithNew = [...vm.steps, newStep];
      const steps = stepsWithNew.map(s => {
        if (s.internalId !== stepId) return s;
        const responses = s.responses.map(r =>
          r.uiId === responseUiId ? { ...r, destinationStepId: newStepInternalId } : r
        );
        return { ...s, responses };
      });
      return { viewModel: { ...vm, steps }, dirty: true };
    }

    default:
      return state;
  }
}

