import { describe, expect, it } from 'vitest';
import {
  extractNodeIdFromNodoError,
  mapBackendFlowErrorToUserMessage,
  replaceKnownNodeIdsInMessage,
} from './mapBackendFlowError';

describe('mapBackendFlowErrorToUserMessage', () => {
  it('maps message field error to step title', () => {
    const raw =
      'El nodo "step-moyahgckl8uyaj" de tipo "message" requiere un campo "message".';
    const msg = mapBackendFlowErrorToUserMessage(raw, [
      { internalId: 'step-moyahgckl8uyaj', title: 'Nuevo paso sin completar' },
    ]);
    expect(msg).toBe('El paso "Nuevo paso sin completar" requiere un mensaje del bot.');
  });

  it('extracts node id from backend pattern', () => {
    const raw = 'El nodo "step-abc" de tipo "message" requiere un campo "message".';
    expect(extractNodeIdFromNodoError(raw)).toBe('step-abc');
  });

  it('replaces known node ids in free-form messages', () => {
    const raw = 'Error en El nodo "step-1" de tipo "capture".';
    const out = replaceKnownNodeIdsInMessage(raw, [{ internalId: 'step-1', title: 'Mi paso' }]);
    expect(out).toContain('"Mi paso"');
    expect(out).not.toContain('step-1');
  });
});
