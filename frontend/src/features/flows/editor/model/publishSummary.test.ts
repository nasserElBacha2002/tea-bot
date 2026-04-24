import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from './conversationViewModel';
import { buildPublishChangeSummary } from './publishSummary';

function vm(overrides: Partial<ConversationViewModel> = {}): ConversationViewModel {
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
        title: 'Saludo',
        message: 'Hola',
        responses: [{ uiId: 'r1', kind: 'fallback', values: [], destinationStepId: 'b', displayOrder: 0 }],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
      {
        uiId: 'b',
        internalId: 'b',
        title: 'Fin',
        message: 'Chau',
        responses: [],
        metadata: { nodeType: 'end', position: { x: 1, y: 1 } },
      },
    ],
    compatibilityWarnings: [],
    ...overrides,
  };
}

describe('buildPublishChangeSummary', () => {
  it('uses first-publish copy when baseline is null', () => {
    const lines = buildPublishChangeSummary(vm(), null);
    expect(lines.some(l => l.includes('primera vez'))).toBe(true);
    expect(lines.some(l => l.includes('Saludo'))).toBe(true);
  });

  it('detects message change', () => {
    const base = vm();
    const draft = vm({
      steps: base.steps.map(s =>
        s.internalId === 'a' ? { ...s, message: 'Hola querido' } : s
      ),
    });
    const lines = buildPublishChangeSummary(draft, base);
    expect(lines.some(l => l.includes('Mensaje cambiado') && l.includes('Saludo'))).toBe(true);
  });

  it('detects new step', () => {
    const base = vm();
    const draft = vm({
      steps: [
        ...base.steps,
        {
          uiId: 'c',
          internalId: 'c',
          title: 'Extra',
          message: 'M',
          responses: [],
          metadata: { nodeType: 'message', position: { x: 2, y: 2 } },
        },
      ],
    });
    const lines = buildPublishChangeSummary(draft, base);
    expect(lines.some(l => l.includes('Nuevo paso') && l.includes('Extra'))).toBe(true);
  });

  it('detects new response', () => {
    const seed = vm();
    const draft = vm({
      steps: seed.steps.map(s =>
        s.internalId === 'a'
          ? {
              ...s,
              responses: [
                { uiId: 'r1', kind: 'exact', values: ['sí'], destinationStepId: 'b', displayOrder: 0 },
                { uiId: 'r2', kind: 'fallback', values: [], destinationStepId: 'b', displayOrder: 1 },
              ],
            }
          : s
      ),
    });
    const lines = buildPublishChangeSummary(draft, seed);
    expect(lines.some(l => l.includes('Nueva respuesta'))).toBe(true);
  });

  it('fallback summary when structures match superficially', () => {
    const a = vm({ entryStepId: 'a', fallbackStepId: 'b' });
    const b = vm({ entryStepId: 'a', fallbackStepId: 'b' });
    const lines = buildPublishChangeSummary(a, b);
    expect(lines).toEqual([
      'Cambios guardados en la versión en preparación desde la última vez en vivo.',
    ]);
  });
});
