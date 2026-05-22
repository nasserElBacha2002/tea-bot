import { describe, expect, it } from 'vitest';
import type { ConversationViewModel } from './conversationViewModel';
import { runLocalValidationBeforeSave } from './conversationSaveFlow';

const vm: ConversationViewModel = {
  flowId: 'f1',
  flowName: 'F',
  version: 'draft',
  status: 'draft',
  entryStepId: 'a',
  fallbackStepId: 'b',
  steps: [
    {
      uiKey: '1',
      internalId: 'a',
      title: 'A',
      type: 'message',
      message: '',
      responses: [],
      isEntry: true,
      isFallback: false,
    },
  ],
};

describe('conversationSaveFlow', () => {
  it('bloquea guardado si hay issues locales', () => {
    const result = runLocalValidationBeforeSave(vm, [
      { code: 'STEP_MESSAGE_EMPTY', message: 'Sin mensaje', stepInternalId: 'a' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no tiene mensaje del bot/i);
      expect(result.focusStepId).toBe('a');
    }
  });

  it('permite guardado sin issues', () => {
    expect(runLocalValidationBeforeSave(vm, [])).toEqual({ ok: true });
  });
});
