// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationFilters } from './ConversationFilters';
import { DEFAULT_CONVERSATION_CHANNEL } from '../constants/conversationChannels';

describe('ConversationFilters', () => {
  it('muestra WhatsApp seleccionado por defecto en el selector de canal', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationFilters
          filters={{ channel: DEFAULT_CONVERSATION_CHANNEL }}
          onChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole('combobox', { name: /canal/i })).toHaveTextContent('WhatsApp');
  });

  it('permite cambiar a Simulador', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationFilters
          filters={{ channel: DEFAULT_CONVERSATION_CHANNEL }}
          onChange={onChange}
          onRefresh={vi.fn()}
        />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: /canal/i }));
    await user.click(screen.getByRole('option', { name: 'Simulador' }));

    expect(onChange).toHaveBeenCalledWith({ channel: 'simulator' });
  });
});
