import { describe, expect, it } from 'vitest';
import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { conversationViewModelToFlow, flowToConversationViewModel } from '../model/conversationAdapters';
import { conversationEditorReducer, type ConversationEditorReducerState } from './conversationEditorReducer';

function minimalVm(overrides: Partial<ConversationViewModel> = {}): ConversationViewModel {
  return {
    flowId: 'f1',
    flowName: 'Test',
    version: 'draft',
    status: 'draft',
    entryStepId: 'a',
    fallbackStepId: 'a',
    steps: [
      {
        uiId: 'a',
        internalId: 'a',
        title: 'A',
        message: 'Hola',
        responses: [],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
    ],
    compatibilityWarnings: [],
    ...overrides,
  };
}

describe('conversation save payload', () => {
  it('serializes current reducer view model with base flow fields', () => {
    const base: Flow = {
      id: 'f1',
      name: 'Old',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'a',
      nodes: [],
      updatedAt: '2024-01-01',
      publishedAt: undefined,
    };
    const state: ConversationEditorReducerState = {
      viewModel: minimalVm({ flowName: 'Renamed' }),
      dirty: false,
    };
    const payload = conversationViewModelToFlow(state.viewModel!, base);
    expect(payload.name).toBe('Renamed');
    expect(payload.updatedAt).toBe('2024-01-01');
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].id).toBe('a');
  });

  it('preserves advanced transitions on save round-trip', () => {
    const original: Flow = {
      id: 'f1',
      name: 'Adv',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'b',
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'X',
          transitions: [
            { type: 'matchIncludes', value: 'tea', nextNode: 'b' },
            { type: 'default', nextNode: 'b' },
          ],
          ui: { position: { x: 0, y: 0 } },
        },
        { id: 'b', type: 'end', message: 'E', ui: { position: { x: 1, y: 1 } } },
      ],
    };
    const vm = flowToConversationViewModel(original);
    const payload = conversationViewModelToFlow(vm, original);
    const nodeA = payload.nodes.find(n => n.id === 'a');
    expect(nodeA?.transitions?.some(t => t.type === 'matchIncludes')).toBe(true);
    expect(nodeA?.transitions?.some(t => t.type === 'default')).toBe(true);
    expect(nodeA?.transitions?.find(t => t.type === 'matchIncludes')?.value).toBe('tea');
  });

  it('successful hydrate after edit clears dirty (save success path)', () => {
    const vm = minimalVm();
    let state: ConversationEditorReducerState = { viewModel: vm, dirty: false };
    state = conversationEditorReducer(state, { type: 'UPDATE_STEP_TITLE', stepId: 'a', title: 'Local' });
    expect(state.dirty).toBe(true);
    const savedFlow = conversationViewModelToFlow(state.viewModel!, {
      id: 'f1',
      name: 'Test',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'a',
      nodes: [],
    });
    const fromServer = flowToConversationViewModel(savedFlow);
    state = conversationEditorReducer(state, { type: 'HYDRATE', payload: fromServer });
    expect(state.dirty).toBe(false);
  });

  it('without hydrate, failed save keeps dirty and local edits', () => {
    let state: ConversationEditorReducerState = { viewModel: minimalVm(), dirty: false };
    state = conversationEditorReducer(state, { type: 'UPDATE_STEP_MESSAGE', stepId: 'a', message: 'Nuevo' });
    expect(state.dirty).toBe(true);
    expect(state.viewModel?.steps[0].message).toBe('Nuevo');
    // Simula error de API: no se llama HYDRATE
    expect(state.dirty).toBe(true);
    expect(state.viewModel?.steps[0].message).toBe('Nuevo');
  });
});
