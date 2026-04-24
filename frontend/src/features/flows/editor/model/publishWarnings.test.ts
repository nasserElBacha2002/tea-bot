import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from './conversationViewModel';
import type { ConversationValidationIssue } from './conversationValidation';
import { buildPublishWarnings, validationIssueToPublishMessage } from './publishWarnings';

function minimalVm(overrides: Partial<ConversationViewModel> = {}): ConversationViewModel {
  return {
    flowId: 'f1',
    flowName: 'F',
    version: 'draft',
    status: 'draft',
    entryStepId: 'a',
    fallbackStepId: 'b',
    steps: [
      {
        uiId: 'a',
        internalId: 'a',
        title: 'Menú',
        message: 'Elegí',
        responses: [
          { uiId: 'r1', kind: 'exact', values: ['1'], destinationStepId: 'b', displayOrder: 0 },
        ],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
      { uiId: 'b', internalId: 'b', title: 'Fin', message: 'Ok', responses: [], metadata: { nodeType: 'end', position: { x: 1, y: 1 } } },
    ],
    compatibilityWarnings: ['no debe aparecer en publicación'],
    ...overrides,
  };
}

describe('buildPublishWarnings', () => {
  it('marks validation issues as blocking', () => {
    const issues: ConversationValidationIssue[] = [
      {
        code: 'RESPONSE_DESTINATION_MISSING',
        message: 'raw',
        stepInternalId: 'a',
        responseUiId: 'r1',
      },
    ];
    const { blocking, nonBlocking } = buildPublishWarnings(minimalVm(), issues, {
      hasUnsavedChanges: false,
      isFirstPublish: false,
    });
    expect(blocking).toHaveLength(1);
    expect(blocking[0].severity).toBe('blocking');
    expect(nonBlocking).toHaveLength(0);
  });

  it('adds non-blocking autosave notice when dirty', () => {
    const { nonBlocking } = buildPublishWarnings(minimalVm(), [], {
      hasUnsavedChanges: true,
      isFirstPublish: false,
    });
    expect(nonBlocking.some(n => n.id === 'autosave')).toBe(true);
  });

  it('does not surface compatibilityWarnings from the view model', () => {
    const vm = minimalVm({ compatibilityWarnings: ['regla avanzada y vista técnica'] });
    const { blocking, nonBlocking } = buildPublishWarnings(vm, [], {
      hasUnsavedChanges: false,
      isFirstPublish: true,
    });
    const all = [...blocking, ...nonBlocking].map(x => x.message).join(' ');
    expect(all).not.toMatch(/avanzada/i);
    expect(all).not.toMatch(/vista técnica/i);
  });
});

describe('validationIssueToPublishMessage', () => {
  it('uses friendly copy for step needs response', () => {
    const msg = validationIssueToPublishMessage(minimalVm(), {
      code: 'STEP_NEEDS_RESPONSE',
      message: 'ignored',
      stepInternalId: 'a',
    });
    expect(msg).toContain('Menú');
    expect(msg).not.toContain('STEP_');
  });
});
