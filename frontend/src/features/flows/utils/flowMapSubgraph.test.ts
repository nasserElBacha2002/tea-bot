import { describe, expect, it } from 'vitest';
import type { Flow } from '../types/flow.types';
import {
  collectNodesWithinDepth,
  resolveMapFocusNodeId,
  searchFlowNodes,
  summarizeOutgoingTransitions,
  truncateText,
} from './flowMapSubgraph';

const sampleFlow: Flow = {
  id: 'f1',
  name: 'Test',
  version: 'draft',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [
    {
      id: 'a',
      type: 'message',
      message: 'Welcome tea menu',
      transitions: [
        { type: 'match', value: 'sí', nextNode: 'b' },
        { type: 'match', value: 'menú', nextNode: 'b' },
      ],
    },
    {
      id: 'b',
      type: 'message',
      message: 'Fallback global',
      transitions: [{ type: 'default', nextNode: 'c' }],
    },
    { id: 'c', type: 'end', message: 'Fin' },
  ],
};

describe('flowMapSubgraph', () => {
  it('resolveMapFocusNodeId usa selección o entryNode', () => {
    expect(resolveMapFocusNodeId(sampleFlow, 'b')).toBe('b');
    expect(resolveMapFocusNodeId(sampleFlow, null)).toBe('a');
  });

  it('collectNodesWithinDepth limita a 2 saltos por defecto conceptual', () => {
    const two = collectNodesWithinDepth(sampleFlow, 'a', 2);
    expect(two.has('a')).toBe(true);
    expect(two.has('b')).toBe(true);
    expect(two.has('c')).toBe(true);
    const one = collectNodesWithinDepth(sampleFlow, 'a', 1);
    expect(one.has('a')).toBe(true);
    expect(one.has('b')).toBe(true);
    expect(one.has('c')).toBe(false);
  });

  it('searchFlowNodes encuentra por mensaje', () => {
    const hits = searchFlowNodes(sampleFlow, 'tea');
    expect(hits.some((h) => h.id === 'a')).toBe(true);
  });

  it('summarizeOutgoingTransitions resume múltiples respuestas', () => {
    const s = summarizeOutgoingTransitions(
      [
        { type: 'match', value: 'sí', nextNode: 'b' },
        { type: 'match', value: 'menú', nextNode: 'b' },
      ],
      'b',
    );
    expect(s.shortLabel).toContain('2 respuestas');
    expect(s.tooltip).toContain('sí');
  });

  it('truncateText acorta textos largos', () => {
    expect(truncateText('abcdefghij', 5)).toBe('abcd…');
  });
});
