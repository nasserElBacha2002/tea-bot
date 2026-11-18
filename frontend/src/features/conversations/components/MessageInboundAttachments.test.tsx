// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Paper } from '@mui/material';
import { MessageInboundAttachments } from './MessageInboundAttachments';
import type { ConversationMessage } from '../types/conversation.types';

vi.mock('../api/conversationsApi', () => ({
  conversationAttachmentContentUrl: (
    conversationId: string,
    messageId: string,
    attachmentId: string,
    options?: { download?: boolean },
  ) => {
    const suffix = options?.download ? '?download=1' : '';
    return `https://example.test/api/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}/content${suffix}`;
  },
}));

const theme = createTheme();

const base: ConversationMessage = {
  id: 'm1',
  conversationId: 'c1',
  direction: 'inbound',
  senderType: 'user',
  body: '',
  provider: 'twilio',
  providerMessageId: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('MessageInboundAttachments', () => {
  it('renderiza miniatura JPEG', () => {
    render(
      <ThemeProvider theme={theme}>
        <MessageInboundAttachments
          message={{
            ...base,
            attachments: [{
              id: 'a1',
              ordinal: 0,
              mimeType: 'image/jpeg',
              byteSize: 2048,
              originalName: 'foto.jpg',
              status: 'stored',
            }],
          }}
        />
      </ThemeProvider>,
    );
    const img = screen.getByRole('img', { name: 'foto.jpg' });
    expect(img).toHaveAttribute(
      'src',
      'https://example.test/api/conversations/c1/messages/m1/attachments/a1/content',
    );
  });

  it('renderiza PDF con nombre y tamaño', () => {
    render(
      <ThemeProvider theme={theme}>
        <MessageInboundAttachments
          message={{
            ...base,
            attachments: [{
              id: 'a2',
              ordinal: 0,
              mimeType: 'application/pdf',
              byteSize: 2048,
              originalName: 'factura.pdf',
              status: 'stored',
            }],
          }}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('factura.pdf')).toBeInTheDocument();
    expect(screen.getByText(/PDF · 2\.0 KB/)).toBeInTheDocument();
  });

  it('muestra nombre PDF legible en burbuja outbound de agente', () => {
    render(
      <ThemeProvider theme={theme}>
        <Paper sx={{ bgcolor: 'success.light', color: 'primary.contrastText', p: 1 }}>
          <MessageInboundAttachments
            message={{
              ...base,
              direction: 'outbound',
              senderType: 'agent',
              attachments: [{
                id: 'a-pdf-out',
                ordinal: 0,
                mimeType: 'application/pdf',
                byteSize: 577_000,
                originalName: '02-011-noti.pdf',
                status: 'stored',
              }],
            }}
          />
        </Paper>
      </ThemeProvider>,
    );
    const label = screen.getByText('02-011-noti.pdf');
    expect(label).toBeVisible();
    expect(label).not.toHaveStyle({ color: 'rgba(255, 255, 255, 1)' });
  });

  it('muestra estado pendiente', () => {
    render(
      <ThemeProvider theme={theme}>
        <MessageInboundAttachments
          message={{
            ...base,
            attachments: [{
              id: 'a3',
              ordinal: 0,
              mimeType: 'image/png',
              byteSize: null,
              originalName: null,
              status: 'pending',
            }],
          }}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(/Procesando adjunto/)).toBeInTheDocument();
  });
});