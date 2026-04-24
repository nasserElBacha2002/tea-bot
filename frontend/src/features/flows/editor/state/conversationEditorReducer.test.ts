import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { validateConversationViewModel } from '../model/conversationValidation';
import { conversationEditorReducer } from './conversationEditorReducer';

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

describe('conversationEditorReducer', () => {
  it('UPDATE_FLOW_INFO updates name and description', () => {
    const s0 = { viewModel: minimalVm({ flowName: 'Old', description: 'd0' }), dirty: false };
    const s1 = conversationEditorReducer(s0, {
      type: 'UPDATE_FLOW_INFO',
      flowName: 'New name',
      description: 'Nueva descripción',
    });
    expect(s1.dirty).toBe(true);
    expect(s1.viewModel?.flowName).toBe('New name');
    expect(s1.viewModel?.description).toBe('Nueva descripción');
    const s2 = conversationEditorReducer(s0, {
      type: 'UPDATE_FLOW_INFO',
      flowName: '  ',
      description: '',
    });
    expect(s2.viewModel?.flowName).toBe('Old');
    expect(s2.viewModel?.description).toBeUndefined();
  });

  it('HYDRATE replaces view model and clears dirty', () => {
    const s0 = { viewModel: minimalVm(), dirty: false };
    const s1 = conversationEditorReducer(s0, {
      type: 'UPDATE_STEP_TITLE',
      stepId: 'a',
      title: 'Edited',
    });
    expect(s1.dirty).toBe(true);
    const s2 = conversationEditorReducer(s1, {
      type: 'HYDRATE',
      payload: minimalVm({ flowName: 'From server' }),
    });
    expect(s2.dirty).toBe(false);
    expect(s2.viewModel?.flowName).toBe('From server');
  });

  it('adds a step', () => {
    const s0 = { viewModel: minimalVm(), dirty: false };
    const s1 = conversationEditorReducer(s0, { type: 'ADD_STEP' });
    expect(s1.viewModel?.steps.length).toBe(2);
    expect(s1.dirty).toBe(true);
  });

  it('adds exact response', () => {
    const vm = minimalVm();
    const s0 = { viewModel: vm, dirty: false };
    const s1 = conversationEditorReducer(s0, { type: 'ADD_RESPONSE', stepId: 'a', kind: 'exact' });
    expect(s1.viewModel?.steps[0].responses.length).toBe(1);
    expect(s1.viewModel?.steps[0].responses[0].kind).toBe('exact');
  });

  it('rejects second fallback', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'm',
          responses: [
            {
              uiId: 'r1',
              kind: 'fallback',
              values: [],
              destinationStepId: 'a',
              displayOrder: 0,
            },
          ],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const s0 = { viewModel: vm, dirty: false };
    const s1 = conversationEditorReducer(s0, { type: 'ADD_RESPONSE', stepId: 'a', kind: 'fallback' });
    expect(s1.viewModel?.steps[0].responses.length).toBe(1);
  });

  it('creates step and assigns destination', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'm',
          responses: [
            {
              uiId: 'r1',
              kind: 'exact',
              values: ['sí'],
              destinationStepId: 'a',
              displayOrder: 0,
            },
          ],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const s0 = { viewModel: vm, dirty: false };
    const s1 = conversationEditorReducer(s0, {
      type: 'CREATE_STEP_AND_ASSIGN',
      stepId: 'a',
      responseUiId: 'r1',
      newStepInternalId: 'newB',
    });
    expect(s1.viewModel?.steps.length).toBe(2);
    const dest = s1.viewModel?.steps[0].responses[0].destinationStepId;
    expect(dest).toBe('newB');
    expect(s1.viewModel?.steps.some(x => x.internalId === 'newB')).toBe(true);
  });
});

describe('validateConversationViewModel', () => {
  it('flags empty exact value', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'ok',
          responses: [
            {
              uiId: 'r1',
              kind: 'exact',
              values: [''],
              destinationStepId: 'a',
              displayOrder: 0,
            },
          ],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(vm);
    expect(issues.some(i => i.code === 'RESPONSE_EXACT_EMPTY')).toBe(true);
  });

  it('flags empty anyOf', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'ok',
          responses: [
            {
              uiId: 'r1',
              kind: 'anyOf',
              values: [],
              destinationStepId: 'a',
              displayOrder: 0,
            },
          ],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(vm);
    expect(issues.some(i => i.code === 'RESPONSE_ANYOF_EMPTY')).toBe(true);
  });

  it('flags missing destination', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'ok',
          responses: [
            {
              uiId: 'r1',
              kind: 'fallback',
              values: [],
              destinationStepId: '',
              displayOrder: 0,
            },
          ],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(vm);
    expect(issues.some(i => i.code === 'RESPONSE_DESTINATION_MISSING')).toBe(true);
  });

  it('flags step needing responses', () => {
    const vm = minimalVm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'ok',
          responses: [],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(vm);
    expect(issues.some(i => i.code === 'STEP_NEEDS_RESPONSE')).toBe(true);
  });
});
