import { describe, expect, it } from 'vitest';
import type { ConversationStep } from './conversationViewModel';
import {
  buildStepPathDisplayOrder,
  getStepOutgoingTargets,
  getStepPathRowSx,
} from './stepPathOrdering';

function step(
  id: string,
  destinations: string[],
  extra?: Partial<ConversationStep['metadata']>,
): ConversationStep {
  return {
    uiId: id,
    internalId: id,
    title: id,
    message: 'msg',
    responses: destinations.map((dest, index) => ({
      uiId: `${id}__r${index}`,
      kind: 'exact',
      values: [String(index + 1)],
      destinationStepId: dest,
      displayOrder: index,
    })),
    metadata: {
      nodeType: 'message',
      position: { x: 0, y: 0 },
      ...extra,
    },
  };
}

describe('buildStepPathDisplayOrder', () => {
  it('orders steps by traversal path, not by internal id', () => {
    const steps = [
      step('step10', ['step2']),
      step('step2', []),
      step('step1', ['step10']),
    ];

    const ordered = buildStepPathDisplayOrder(steps, 'step1');
    expect(ordered.map(item => item.step.internalId)).toEqual(['step1', 'step10', 'step2']);
    expect(ordered.map(item => item.pathOrder)).toEqual([1, 2, 3]);
  });

  it('places branch children immediately after parent in deterministic order', () => {
    const branch = step('menu', ['opt_a', 'opt_b']);
    const optA = step('opt_a', ['end']);
    const optB = step('opt_b', ['end']);
    const end = step('end', []);

    const ordered = buildStepPathDisplayOrder([branch, optB, optA, end], 'menu');
    expect(ordered.map(item => item.step.internalId)).toEqual(['menu', 'opt_a', 'end', 'opt_b']);
  });

  it('assigns different branch groups to sibling branches', () => {
    const steps = [step('root', ['a', 'b']), step('a', []), step('b', [])];
    const ordered = buildStepPathDisplayOrder(steps, 'root');
    const a = ordered.find(item => item.step.internalId === 'a');
    const b = ordered.find(item => item.step.internalId === 'b');
    expect(a?.branchGroup).not.toBe(b?.branchGroup);
  });

  it('appends orphan steps in a separate section with stable id order', () => {
    const steps = [step('z_orphan', []), step('a_orphan', []), step('entry', ['next']), step('next', [])];
    const ordered = buildStepPathDisplayOrder(steps, 'entry');
    const orphans = ordered.filter(item => item.section === 'orphan');
    expect(orphans.map(item => item.step.internalId)).toEqual(['a_orphan', 'z_orphan']);
    expect(ordered.map(item => item.step.internalId)).toEqual(['entry', 'next', 'a_orphan', 'z_orphan']);
  });

  it('handles cycles without infinite loops', () => {
    const steps = [step('a', ['b']), step('b', ['a'])];
    const ordered = buildStepPathDisplayOrder(steps, 'a');
    expect(ordered.map(item => item.step.internalId)).toEqual(['a', 'b']);
  });

  it('filters items by title while keeping traversal order', () => {
    const steps = [step('step10', ['step2']), step('step2', []), step('step1', ['step10'])];
    const ordered = buildStepPathDisplayOrder(steps, 'step1');
    const filtered = ordered.filter(
      item =>
        item.step.title.toLowerCase().includes('step10') ||
        item.step.internalId.toLowerCase().includes('step10'),
    );
    expect(filtered.map(item => item.step.internalId)).toEqual(['step10']);
  });

  it('includes auto-advance and parallel links in traversal', () => {
    const auto: ConversationStep = {
      ...step('welcome', []),
      metadata: {
        nodeType: 'message',
        position: { x: 0, y: 0 },
        messageAutoAdvanceNextNode: 'after',
      },
    };
    const after = step('after', []);
    const ordered = buildStepPathDisplayOrder([after, auto], 'welcome');
    expect(ordered.map(item => item.step.internalId)).toEqual(['welcome', 'after']);
    expect(getStepOutgoingTargets(auto)).toEqual(['after']);
  });
});

describe('getStepPathRowSx', () => {
  it('keeps selected row readable with primary accent', () => {
    const sx = getStepPathRowSx({ depth: 1, branchGroup: 2, section: 'path' }, true);
    expect(sx.borderColor).toBe('primary.main');
  });

  it('uses muted styling for orphan rows', () => {
    const sx = getStepPathRowSx({ depth: 0, branchGroup: -1, section: 'orphan' }, false);
    expect(sx.borderColor).toBe('divider');
    expect(sx.bgcolor).toBe('action.hover');
  });
});
