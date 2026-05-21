// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { AxiosError } from 'axios';
import { ConversationPersistenceAlert } from './ConversationPersistenceAlert';

describe('ConversationPersistenceAlert', () => {
  it('muestra error descriptivo en español y botón Reintentar', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const err = new AxiosError('fail');
    err.response = {
      status: 503,
      data: {
        ok: false,
        error: 'CONVERSATION_PERSISTENCE_UNAVAILABLE',
        message:
          'No se pudo conectar con la base de datos de conversaciones. Verificá que SQL Server esté levantado.',
      },
      statusText: 'Service Unavailable',
      headers: {},
      config: {} as never,
    };

    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationPersistenceAlert error={err} onRetry={onRetry} />
      </ThemeProvider>,
    );

    expect(screen.getByText('No se pudo cargar la bandeja')).toBeInTheDocument();
    expect(screen.getByText(/base de datos de conversaciones/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
