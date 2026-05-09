import { describe, expect, it } from 'vitest';
import type { Flow } from '../../types/flow.types';
import { validateFlowPayload } from './flowPayloadValidation';

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

describe('validateFlowPayload', () => {
  it('accepts a minimal coherent flow', () => {
    expect(validateFlowPayload(minimalFlow())).toHaveLength(0);
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
