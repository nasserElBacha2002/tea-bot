import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from './conversationViewModel';
import { buildConnectionRows, responseClientPhrase } from './connectionRows';

function baseVm(overrides: Partial<ConversationViewModel> = {}): ConversationViewModel {
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
        responses: [
          {
            uiId: 'r1',
            kind: 'exact',
            values: ['sí'],
            destinationStepId: 'b',
            displayOrder: 0,
          },
          {
            uiId: 'r2',
            kind: 'fallback',
            values: [],
            destinationStepId: 'c',
            displayOrder: 1,
          },
        ],
        metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
      },
      {
        uiId: 'b',
        internalId: 'b',
        title: 'Opción Sí',
        message: 'Genial',
        responses: [],
        metadata: { nodeType: 'message', position: { x: 1, y: 0 } },
      },
      {
        uiId: 'c',
        internalId: 'c',
        title: 'Otro',
        message: 'Ok',
        responses: [],
        metadata: { nodeType: 'end', position: { x: 2, y: 0 } },
      },
    ],
    compatibilityWarnings: [],
    ...overrides,
  };
}

describe('responseClientPhrase', () => {
  it('describes exact without engine jargon', () => {
    const p = responseClientPhrase({
      uiId: 'x',
      kind: 'exact',
      values: ['hola'],
      destinationStepId: 'z',
      displayOrder: 0,
    });
    expect(p).toContain('exactamente');
    expect(p).not.toMatch(/match|transition|json/i);
  });

  it('uses approved fallback copy', () => {
    const p = responseClientPhrase({
      uiId: 'x',
      kind: 'fallback',
      values: [],
      destinationStepId: 'z',
      displayOrder: 0,
    });
    expect(p).toBe('En cualquier otro caso');
  });
});

describe('buildConnectionRows', () => {
  it('derives rows from responses with step titles', () => {
    const rows = buildConnectionRows(baseVm());
    const exact = rows.find(r => r.clientPhrase.includes('exactamente'));
    expect(exact?.originTitle).toBe('Saludo');
    expect(exact?.destinationTitle).toBe('Opción Sí');
    const fb = rows.find(r => r.clientPhrase === 'En cualquier otro caso');
    expect(fb?.destinationTitle).toBe('Otro');
  });

  it('does not expose response ui ids or kinds in visible strings', () => {
    const rows = buildConnectionRows(baseVm());
    const joined = rows.map(r => `${r.originTitle}${r.clientPhrase}${r.destinationTitle}`).join(' ');
    expect(joined).not.toMatch(/__r\d/);
    expect(joined).not.toMatch(/\bexact\b|\banyOf\b|\bfallback\b/i);
  });

  it('includes auto-advance and parallel links in plain language', () => {
    const vm = baseVm();
    vm.steps[0].metadata.messageAutoAdvanceNextNode = 'b';
    vm.steps[0].metadata.parallelNextNode = 'c';
    const rows = buildConnectionRows(vm);
    expect(rows.some(r => r.clientPhrase.includes('automáticamente'))).toBe(true);
    expect(rows.some(r => r.clientPhrase.includes('También puede enlazar'))).toBe(true);
  });

  it('humanizes missing titles for destinations', () => {
    const vm = baseVm();
    vm.steps.push({
      uiId: 'z9',
      internalId: 'z9',
      title: '',
      message: '',
      responses: [
        {
          uiId: 'rz',
          kind: 'fallback',
          values: [],
          destinationStepId: 'missing-step',
          displayOrder: 0,
        },
      ],
      metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
    });
    const rows = buildConnectionRows(vm);
    const r = rows.find(x => x.originStepId === 'z9');
    expect(r?.destinationTitle.length).toBeGreaterThan(0);
    expect(r?.destinationTitle).not.toBe('missing-step');
  });
});
