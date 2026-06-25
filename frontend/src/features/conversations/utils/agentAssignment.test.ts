import { describe, expect, it } from 'vitest';
import { canOperatorReply, isSameAgentId, normalizeAgentId } from './agentAssignment';

describe('agentAssignment', () => {
  it('normalizeAgentId es case-insensitive', () => {
    const upper = '7319B35A-ABC5-4B76-A9C7-55418721F56C';
    const lower = '7319b35a-abc5-4b76-a9c7-55418721f56c';
    expect(normalizeAgentId(upper)).toBe(lower);
    expect(isSameAgentId(upper, lower)).toBe(true);
  });

  it('canOperatorReply habilita inbox humano compartido', () => {
    expect(canOperatorReply('waiting_human')).toBe(true);
    expect(canOperatorReply('assigned')).toBe(true);
    expect(canOperatorReply('paused')).toBe(true);
    expect(canOperatorReply('bot')).toBe(false);
    expect(canOperatorReply('closed')).toBe(false);
  });
});
