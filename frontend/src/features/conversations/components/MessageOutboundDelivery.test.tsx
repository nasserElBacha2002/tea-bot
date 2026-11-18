// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MessageOutboundDelivery } from './MessageOutboundDelivery';
import type { ConversationMessage } from '../types/conversation.types';

const theme = createTheme();

const outbound: ConversationMessage = {
  id: 'm1',
  conversationId: 'c1',
  direction: 'outbound',
  senderType: 'agent',
  body: 'hola',
  provider: 'twilio',
  providerMessageId: 'SM1',
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('MessageOutboundDelivery', () => {
  it('muestra reloj en pending', () => {
    render(
      <ThemeProvider theme={theme}>
        <MessageOutboundDelivery message={{ ...outbound, dispatch: { state: 'pending' } }} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('outbound-delivery-pending')).toBeInTheDocument();
  });

  it('muestra doble check en entregado', () => {
    render(
      <ThemeProvider theme={theme}>
        <MessageOutboundDelivery
          message={{
            ...outbound,
            dispatch: { state: 'confirmed' },
            whatsappDelivery: { status: 'delivered' },
          }}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('outbound-delivery-delivered')).toBeInTheDocument();
  });
});