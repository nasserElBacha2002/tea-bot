// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { extractApiError, mapApiErrorCode } from './apiError';

describe('apiError', () => {
  it('mapea CONVERSATION_PERSISTENCE_UNAVAILABLE a español', () => {
    const msg = mapApiErrorCode('CONVERSATION_PERSISTENCE_UNAVAILABLE');
    expect(msg).toMatch(/bandeja de conversaciones/i);
    expect(msg).toMatch(/base de datos/i);
  });

  it('extrae message del backend', () => {
    const err = new AxiosError('fail');
    err.response = {
      status: 503,
      data: {
        ok: false,
        error: 'CONVERSATION_PERSISTENCE_UNAVAILABLE',
        message: 'Mensaje del servidor',
      },
      statusText: 'Service Unavailable',
      headers: {},
      config: {} as never,
    };
    const parsed = extractApiError(err);
    expect(parsed.message).toBe('Mensaje del servidor');
    expect(parsed.code).toBe('CONVERSATION_PERSISTENCE_UNAVAILABLE');
  });
});
