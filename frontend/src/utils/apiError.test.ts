import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { extractApiError, formatFlowValidationErrors } from './apiError';

describe('formatFlowValidationErrors', () => {
  it('joins detailed backend validation messages', () => {
    const text = formatFlowValidationErrors({
      valid: false,
      errors: [
        {
          code: 'FLOW_TRANSITION_VALUE_INVALID',
          message: 'Node `si_cursos_menu`, transition priority 3: `value` is required for transition type `match` (expected string, received undefined).',
        },
      ],
    });
    expect(text).toMatch(/si_cursos_menu/);
  });
});

describe('extractApiError', () => {
  it('prefers detailed validation errors over generic publish message', () => {
    const error = new axios.AxiosError('bad request');
    error.response = {
      status: 400,
      data: {
        ok: false,
        error: 'FLOW_PUBLISH_VALIDATION_FAILED',
        message: 'No se puede publicar el borrador porque tiene errores de validación.',
        details: {
          valid: false,
          errors: [
            {
              code: 'FLOW_TRANSITION_VALUE_INVALID',
              message: 'Node `welcome`, transition priority 1: `value` is required for transition type `match` (expected string, received undefined).',
            },
          ],
        },
      },
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
    };

    const parsed = extractApiError(error);
    expect(parsed.code).toBe('FLOW_PUBLISH_VALIDATION_FAILED');
    expect(parsed.message).toMatch(/welcome/);
    expect(parsed.message).not.toBe('No se puede publicar el borrador porque tiene errores de validación.');
  });
});
