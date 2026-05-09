import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from './conversationViewModel';
import {
  buildConversationValidationSummary,
  firstInvalidStepIdInDisplayOrder,
  mergeValidationIssues,
  validateConversationViewModel,
} from './conversationValidation';

function vm(overrides: Partial<ConversationViewModel> = {}): ConversationViewModel {
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
        title: 'Saludo',
        message: 'Hola',
        responses: [{ uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'a', displayOrder: 0 }],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
    ],
    compatibilityWarnings: [],
    ...overrides,
  };
}

describe('buildConversationValidationSummary', () => {
  it('includes visible step title for empty message and missing responses', () => {
    const model = vm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'Nuevo paso sin completar',
          message: '',
          responses: [],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(model);
    const summary = buildConversationValidationSummary(model, issues);
    expect(summary).toContain('Nuevo paso sin completar');
    expect(summary).toMatch(/no tiene mensaje del bot/);
    expect(summary).toMatch(/no tiene respuestas configuradas/);
  });
});

describe('firstInvalidStepIdInDisplayOrder', () => {
  it('returns the first step with issues in flow order', () => {
    const model = vm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'A',
          message: 'ok',
          responses: [{ uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'a', displayOrder: 0 }],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
        {
          uiId: 'b',
          internalId: 'b',
          title: 'B',
          message: '',
          responses: [],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(model);
    expect(firstInvalidStepIdInDisplayOrder(model, issues)).toBe('b');
  });
});

describe('mergeValidationIssues', () => {
  it('dedupes the same code and step', () => {
    const a = validateConversationViewModel(
      vm({
        steps: [
          {
            uiId: 'a',
            internalId: 'a',
            title: 'X',
            message: '',
            responses: [{ uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'a', displayOrder: 0 }],
            metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
          },
        ],
      })
    );
    const b = a.map(i => ({ ...i }));
    const merged = mergeValidationIssues(a, b);
    expect(merged.length).toBe(a.length);
  });
});

describe('validateConversationViewModel message node', () => {
  it('flags whitespace-only message', () => {
    const model = vm({
      steps: [
        {
          uiId: 'a',
          internalId: 'a',
          title: 'X',
          message: '   \n\t',
          responses: [{ uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'a', displayOrder: 0 }],
          metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
        },
      ],
    });
    const issues = validateConversationViewModel(model);
    expect(issues.some(i => i.code === 'STEP_MESSAGE_EMPTY')).toBe(true);
  });
});
