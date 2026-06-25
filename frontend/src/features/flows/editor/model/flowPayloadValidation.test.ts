import { describe, expect, it } from 'vitest';
import type { Flow } from '../../types/flow.types';
import { validateFlowPayload } from './flowPayloadValidation';
import { validateFlowTransitionValue } from './flowTransitionValidation';

function minimalFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: 'f1',
    name: 'F',
    version: 'draft',
    status: 'draft',
    entryNode: 'a',
    fallbackNode: 'b',
    nodes: [
      {
        id: 'a',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'default', nextNode: 'b' }],
      },
      {
        id: 'b',
        type: 'message',
        message: 'Chau',
        transitions: [{ type: 'default', nextNode: 'a' }],
      },
    ],
    ...overrides,
  };
}

describe('validateFlowTransitionValue', () => {
  it('rejects match without value', () => {
    const issue = validateFlowTransitionValue(
      'si_cursos_menu',
      { type: 'match', nextNode: 'x', priority: 3 },
      3
    );
    expect(issue?.code).toBe('PAYLOAD_TRANSITION_VALUE_REQUIRED');
    expect(issue?.message).toMatch(/si_cursos_menu/);
    expect(issue?.message).toMatch(/prioridad 3/);
  });

  it('accepts numeric values after coercion', () => {
    const issue = validateFlowTransitionValue(
      'welcome',
      { type: 'match', value: 1 as unknown as string, nextNode: 'x' },
      0
    );
    expect(issue).toBeNull();
  });
});

describe('validateFlowPayload', () => {
  it('accepts a minimal coherent flow', () => {
    expect(validateFlowPayload(minimalFlow())).toHaveLength(0);
  });

  it('flags match transition without value', () => {
    const flow = minimalFlow({
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'Hola',
          transitions: [{ type: 'match', nextNode: 'b' }],
        },
        { id: 'b', type: 'end', message: 'Chau' },
      ],
    });
    const issues = validateFlowPayload(flow);
    expect(issues.some(i => i.code === 'PAYLOAD_TRANSITION_VALUE_REQUIRED')).toBe(true);
  });

  it('flags missing message like the backend', () => {
    const flow = minimalFlow({
      nodes: [
        { id: 'a', type: 'message', message: '', transitions: [{ type: 'default', nextNode: 'b' }] },
        { id: 'b', type: 'message', message: 'x', transitions: [{ type: 'default', nextNode: 'a' }] },
      ],
    });
    const issues = validateFlowPayload(flow);
    expect(issues.some(i => i.code === 'STEP_MESSAGE_EMPTY' && i.stepInternalId === 'a')).toBe(true);
  });

  it('flags redirect without message', () => {
    const flow = minimalFlow({
      nodes: [
        {
          id: 'a',
          type: 'redirect',
          message: '',
          nextNode: 'b',
        },
        { id: 'b', type: 'message', message: 'ok', transitions: [{ type: 'default', nextNode: 'a' }] },
      ],
    });
    const issues = validateFlowPayload(flow);
    expect(issues.some(i => i.stepInternalId === 'a' && i.code === 'STEP_MESSAGE_EMPTY')).toBe(true);
  });

  it('detects duplicate node ids', () => {
    const flow = minimalFlow({
      nodes: [
        { id: 'a', type: 'message', message: '1', transitions: [{ type: 'default', nextNode: 'b' }] },
        { id: 'a', type: 'message', message: '2', transitions: [{ type: 'default', nextNode: 'b' }] },
        { id: 'b', type: 'message', message: '3', transitions: [{ type: 'default', nextNode: 'a' }] },
      ],
    });
    expect(validateFlowPayload(flow).some(i => i.code === 'PAYLOAD_DUPLICATE_NODE_ID')).toBe(true);
  });
});
