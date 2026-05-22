// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationMessageTimeline } from './ConversationMessageTimeline';
import type { ConversationMessage } from '../types/conversation.types';

const theme = createTheme();

const messages: ConversationMessage[] = [
  {
    id: '1',
    conversationId: 'c1',
    direction: 'inbound',
    senderType: 'user',
    body: 'Hola',
    provider: 'twilio',
    providerMessageId: null,
    metadata: null,
    createdAt: '2026-05-21T10:00:00.000Z',
  },
  {
    id: '2',
    conversationId: 'c1',
    direction: 'outbound',
    senderType: 'bot',
    body: 'Bienvenido',
    provider: 'twilio',
    providerMessageId: null,
    metadata: null,
    createdAt: '2026-05-21T10:01:00.000Z',
  },
];

describe('ConversationMessageTimeline', () => {
  it('muestra estado sin mensajes', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationMessageTimeline messages={[]} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Sin mensajes')).toBeInTheDocument();
  });

  it('renderiza mensajes entrantes y salientes', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationMessageTimeline messages={messages} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Hola')).toBeInTheDocument();
    expect(screen.getByText('Bienvenido')).toBeInTheDocument();
    expect(screen.getByText(/Usuario/)).toBeInTheDocument();
    expect(screen.getByText(/Bot/)).toBeInTheDocument();
  });

  it('renderiza inputs cortos del usuario (1, humano, menú)', () => {
    const inputs: ConversationMessage[] = [
      { ...messages[0], id: 'u1', body: '1' },
      { ...messages[0], id: 'u2', body: 'humano' },
      { ...messages[0], id: 'u3', body: 'menú' },
    ];
    render(
      <ThemeProvider theme={theme}>
        <ConversationMessageTimeline messages={inputs} />
      </ThemeProvider>,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('humano')).toBeInTheDocument();
    expect(screen.getByText('menú')).toBeInTheDocument();
  });

  it('expone contenedor con scroll propio para mensajes', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationMessageTimeline messages={messages} conversationId="c1" />
      </ThemeProvider>,
    );
    const scroll = screen.getByTestId('conversation-messages-scroll');
    expect(scroll).toBeInTheDocument();
    const inner = scroll.querySelector('[class*="MuiBox"]');
    expect(inner).toBeTruthy();
  });
});
