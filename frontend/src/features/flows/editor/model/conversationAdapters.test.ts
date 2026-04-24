import { describe, expect, it } from 'vitest';
import type { Flow } from '../../types/flow.types';
import {
  conversationViewModelToFlow,
  flowToConversationViewModel,
  flowsEqualForRoundTrip,
  humanizeNodeId,
} from './conversationAdapters';

describe('flowToConversationViewModel', () => {
  it('maps a simple default-only loop', () => {
    const flow: Flow = {
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
          message: 'Hola',
          transitions: [{ type: 'default', nextNode: 'b' }],
          ui: { position: { x: 0, y: 0 } },
        },
        {
          id: 'b',
          type: 'message',
          message: 'Adiós',
          transitions: [{ type: 'default', nextNode: 'a' }],
          ui: { position: { x: 100, y: 0 } },
        },
      ],
    };
    const vm = flowToConversationViewModel(flow);
    expect(vm.steps).toHaveLength(2);
    expect(vm.steps[0].responses).toHaveLength(1);
    expect(vm.steps[0].responses[0].kind).toBe('fallback');
    expect(vm.steps[0].responses[0].destinationStepId).toBe('b');
    expect(vm.entryStepId).toBe('a');
    expect(vm.fallbackStepId).toBe('b');
  });

  it('maps message with only nextNode as auto-advance metadata', () => {
    const flow: Flow = {
      id: 'f1',
      name: 'Lin',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'b',
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'Info',
          nextNode: 'b',
          ui: { position: { x: 0, y: 0 } },
        },
        { id: 'b', type: 'end', message: 'Fin', ui: { position: { x: 1, y: 1 } } },
      ],
    };
    const vm = flowToConversationViewModel(flow);
    expect(vm.steps[0].responses).toHaveLength(0);
    expect(vm.steps[0].metadata.messageAutoAdvanceNextNode).toBe('b');
  });

  it('maps branching match + default', () => {
    const flow: Flow = {
      id: 'f1',
      name: 'Br',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'c',
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'Sí o no',
          transitions: [
            { type: 'match', value: 'sí', nextNode: 'b' },
            { type: 'default', nextNode: 'c' },
          ],
          ui: { position: { x: 0, y: 0 } },
        },
        { id: 'b', type: 'message', message: 'OK', ui: { position: { x: 1, y: 1 } } },
        { id: 'c', type: 'message', message: 'Nope', ui: { position: { x: 2, y: 2 } } },
      ],
    };
    const vm = flowToConversationViewModel(flow);
    const res = vm.steps[0].responses;
    expect(res.some(r => r.kind === 'exact' && r.values[0] === 'sí')).toBe(true);
    expect(res.some(r => r.kind === 'fallback')).toBe(true);
  });

  it('preserves matchIncludes in step metadata without UI warnings', () => {
    const flow: Flow = {
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
            { type: 'matchIncludes', value: 'hola', nextNode: 'b' },
            { type: 'default', nextNode: 'b' },
          ],
          ui: { position: { x: 0, y: 0 } },
        },
        { id: 'b', type: 'end', message: 'E', ui: { position: { x: 1, y: 1 } } },
      ],
    };
    const vm = flowToConversationViewModel(flow);
    expect(vm.compatibilityWarnings).toEqual([]);
    expect(vm.steps[0].metadata.preservedTransitions?.length).toBe(1);
    expect(vm.steps[0].metadata.preservedTransitions?.[0].type).toBe('matchIncludes');
    expect(vm.steps[0].responses.some(r => r.kind === 'fallback')).toBe(true);
  });

  it('uses stepTitle from ui when present', () => {
    const flow: Flow = {
      id: 'f1',
      name: 'T',
      version: 'draft',
      status: 'draft',
      entryNode: 'x',
      fallbackNode: 'x',
      nodes: [
        {
          id: 'x',
          type: 'message',
          message: 'm',
          ui: { position: { x: 0, y: 0 }, stepTitle: 'Mi título' },
        },
      ],
    };
    const vm = flowToConversationViewModel(flow);
    expect(vm.steps[0].title).toBe('Mi título');
  });
});

describe('round-trip', () => {
  it('simple default loop', () => {
    const original: Flow = {
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
          message: 'Hola',
          transitions: [{ type: 'default', nextNode: 'b' }],
          ui: { position: { x: 10, y: 20 } },
        },
        {
          id: 'b',
          type: 'message',
          message: 'Chau',
          transitions: [{ type: 'default', nextNode: 'a' }],
          ui: { position: { x: 30, y: 40 } },
        },
      ],
    };
    const vm = flowToConversationViewModel(original);
    const back = conversationViewModelToFlow(vm, original);
    expect(flowsEqualForRoundTrip(original, back)).toBe(true);
  });

  it('matchAny round-trip', () => {
    const original: Flow = {
      id: 'f1',
      name: 'M',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'b',
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'Q',
          transitions: [
            { type: 'matchAny', value: ['sí', 'ok'], nextNode: 'b' },
            { type: 'default', nextNode: 'b' },
          ],
          ui: { position: { x: 0, y: 0 } },
        },
        { id: 'b', type: 'end', message: 'E', ui: { position: { x: 1, y: 1 } } },
      ],
    };
    const vm = flowToConversationViewModel(original);
    const back = conversationViewModelToFlow(vm, original);
    expect(flowsEqualForRoundTrip(original, back)).toBe(true);
  });

  it('message nextNode only round-trip', () => {
    const original: Flow = {
      id: 'f1',
      name: 'L',
      version: 'draft',
      status: 'draft',
      entryNode: 'a',
      fallbackNode: 'b',
      nodes: [
        {
          id: 'a',
          type: 'message',
          message: 'Auto',
          nextNode: 'b',
          ui: { position: { x: 5, y: 5 } },
        },
        { id: 'b', type: 'end', message: 'Z', ui: { position: { x: 6, y: 6 } } },
      ],
    };
    const vm = flowToConversationViewModel(original);
    const back = conversationViewModelToFlow(vm, original);
    expect(flowsEqualForRoundTrip(original, back)).toBe(true);
  });

  it('preserves matchIncludes after round-trip', () => {
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
    const back = conversationViewModelToFlow(vm, original);
    const nodeA = back.nodes.find(n => n.id === 'a');
    const hasIncludes = nodeA?.transitions?.some(t => t.type === 'matchIncludes');
    const hasDefault = nodeA?.transitions?.some(t => t.type === 'default');
    expect(hasIncludes).toBe(true);
    expect(hasDefault).toBe(true);
    expect(nodeA?.transitions?.find(t => t.type === 'matchIncludes')?.value).toBe('tea');
  });

  it('reordered steps: output order follows view model', () => {
    const original: Flow = {
      id: 'f1',
      name: 'O',
      version: 'draft',
      status: 'draft',
      entryNode: 'c',
      fallbackNode: 'a',
      nodes: [
        { id: 'c', type: 'message', message: 'C', ui: { position: { x: 0, y: 0 } } },
        { id: 'a', type: 'message', message: 'A', ui: { position: { x: 1, y: 1 } } },
        { id: 'b', type: 'message', message: 'B', ui: { position: { x: 2, y: 2 } } },
      ],
    };
    const vm = flowToConversationViewModel(original);
    const reordered = {
      ...vm,
      steps: [vm.steps[1], vm.steps[2], vm.steps[0]],
    };
    const back = conversationViewModelToFlow(reordered, original);
    expect(back.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('humanizeNodeId', () => {
  it('formats slug-like ids', () => {
    expect(humanizeNodeId('main-menu')).toBe('Main Menu');
  });
});
