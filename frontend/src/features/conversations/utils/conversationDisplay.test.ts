import { describe, expect, it } from 'vitest';
import {
  formatAssignmentLabel,
  handoffReasonHumanText,
} from './conversationDisplay';

describe('conversationDisplay', () => {
  it('formatAssignmentLabel distingue agente actual', () => {
    expect(formatAssignmentLabel('a1', 'a1')).toBe('Asignada a vos');
    expect(formatAssignmentLabel('a1', 'a2')).toBe('Asignada a otro agente');
    expect(formatAssignmentLabel(null, 'a1')).toBeNull();
  });

  it('handoffReasonHumanText traduce human_handoff', () => {
    expect(handoffReasonHumanText('human_handoff')).toMatch(/persona/i);
  });
});
