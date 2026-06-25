// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationComposer } from './ConversationComposer';

describe('ConversationComposer', () => {
  it('waiting_human muestra Tomar conversación', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="waiting_human" onSend={vi.fn()} onClaim={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: /tomar conversación/i })).toBeInTheDocument();
  });

  it('assigned muestra composer y envía mensaje', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="assigned"
          assignedToCurrentAgent
          onSend={onSend}
        />
      </ThemeProvider>,
    );
    const input = screen.getByPlaceholderText(/escribí una respuesta/i);
    await user.type(input, 'Hola desde el equipo');
    await user.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(onSend).toHaveBeenCalledWith('Hola desde el equipo');
  });

  it('closed muestra mensaje de no responder', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="closed" onSend={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/conversación cerrada/i)).toBeInTheDocument();
  });

  it('bot activo no permite responder', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="bot" onSend={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/bot está activo/i)).toBeInTheDocument();
  });
});
