import { describe, expect, it } from 'vitest';
import { shouldApplyServerHydration } from './conversationHydrationPolicy';

describe('shouldApplyServerHydration', () => {
  it('hydrates on first load (no prior flow id)', () => {
    expect(
      shouldApplyServerHydration({
        incomingFlowId: 'f1',
        lastHydratedFlowId: null,
        editorDirty: false,
      })
    ).toBe(true);
  });

  it('hydrates when flow id changes', () => {
    expect(
      shouldApplyServerHydration({
        incomingFlowId: 'f2',
        lastHydratedFlowId: 'f1',
        editorDirty: true,
      })
    ).toBe(true);
  });

  it('does not overwrite dirty local state on same-flow refetch', () => {
    expect(
      shouldApplyServerHydration({
        incomingFlowId: 'f1',
        lastHydratedFlowId: 'f1',
        editorDirty: true,
      })
    ).toBe(false);
  });

  it('applies server data on same flow when not dirty', () => {
    expect(
      shouldApplyServerHydration({
        incomingFlowId: 'f1',
        lastHydratedFlowId: 'f1',
        editorDirty: false,
      })
    ).toBe(true);
  });
});
