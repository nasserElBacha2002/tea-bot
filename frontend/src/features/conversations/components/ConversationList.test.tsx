// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationList } from './ConversationList';
import type { InboxConversationItem } from '../types/conversation.types';

const theme = createTheme();

const item: InboxConversationItem = {
  id: 'c1',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Simulación',
  status: 'bot',
  assignedAgentId: null,
  currentFlowId: null,
  currentFlowVersion: null,
  currentNodeKey: null,
  lastMessageAt: '2026-05-22T10:00:00.000Z',
  startedAt: '2026-05-22T09:00:00.000Z',
  closedAt: null,
  lastMessage: null,
  humanHandoff: null,
};

describe('ConversationList', () => {
  it('usa contenedor scrolleable para la lista', () => {
    render(
      <ThemeProvider theme={theme}>
        <ConversationList conversations={[item]} selectedId={null} onSelect={vi.fn()} />
      </ThemeProvider>,
    );
    const scroll = screen.getByTestId('conversation-list-scroll');
    expect(scroll).toHaveStyle({ overflowY: 'auto' });
  });
});
