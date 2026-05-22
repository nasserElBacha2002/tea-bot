// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationListItem } from './ConversationListItem';
import type { InboxConversationItem } from '../types/conversation.types';

const theme = createTheme();

const item: InboxConversationItem = {
  id: 'c1',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Simulación',
  status: 'waiting_human',
  assignedAgentId: null,
  currentFlowId: null,
  currentFlowVersion: null,
  currentNodeKey: null,
  lastMessageAt: '2026-05-22T10:00:00.000Z',
  startedAt: '2026-05-22T09:00:00.000Z',
  closedAt: null,
  lastMessage: {
    body: 'humano',
    direction: 'inbound',
    senderType: 'user',
    createdAt: '2026-05-22T10:00:00.000Z',
  },
  humanHandoff: null,
};

describe('ConversationListItem', () => {
  it('muestra badge Sin leer y aria-label accesible', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationListItem
          conversation={{ ...item, status: 'bot' }}
          selected={false}
          unread
          onSelect={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('Sin leer')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', expect.stringContaining('sin leer'));
  });

  it('muestra contador cuando hay varios sin leer', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationListItem
          conversation={item}
          selected={false}
          unread
          unreadCount={3}
          onSelect={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('muestra badge Nuevo', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationListItem
          conversation={{ ...item, status: 'bot' }}
          selected={false}
          isNew
          onSelect={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('Nuevo')).toBeInTheDocument();
  });
});
