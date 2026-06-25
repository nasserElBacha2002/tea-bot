import { describe, expect, it } from 'vitest';
import { handoffReasonHumanText } from './conversationDisplay';

describe('conversationDisplay', () => {
  it('handoffReasonHumanText traduce human_handoff', () => {
    expect(handoffReasonHumanText('human_handoff')).toMatch(/persona/i);
  });
});
