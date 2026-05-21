// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConversationsPage } from './ConversationsPage';

const refreshMock = vi.fn();

vi.mock('../hooks/useConversations', () => ({
  useConversations: () => ({
    data: {
      items: [
        {
          id: 'conv-1',
          channel: 'whatsapp',
          provider: 'twilio',
          phoneNumber: '+5491111111111',
          displayName: null,
          status: 'waiting_human',
          assignedAgentId: null,
          currentFlowId: 'main-menu',
          currentFlowVersion: 'v21',
          currentNodeKey: 'human_handoff',
          lastMessageAt: '2026-05-21T10:00:00.000Z',
          startedAt: '2026-05-21T09:00:00.000Z',
          closedAt: null,
          lastMessage: {
            body: 'Quiero una persona',
            direction: 'inbound',
            senderType: 'user',
            createdAt: '2026-05-21T10:00:00.000Z',
          },
          humanHandoff: {
            id: 'h1',
            status: 'pending',
            reason: 'human_handoff',
            requestedBy: 'bot',
            requestedAt: '2026-05-21T09:55:00.000Z',
          },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useConversationDetail: (id: string | null) => ({
    data: id
      ? {
          conversation: {
            id: 'conv-1',
            channel: 'whatsapp',
            provider: 'twilio',
            phoneNumber: '+5491111111111',
            displayName: null,
            status: 'waiting_human',
            assignedAgentId: null,
            currentFlowId: 'main-menu',
            currentFlowVersion: 'v21',
            currentNodeKey: 'human_handoff',
            lastMessageAt: '2026-05-21T10:00:00.000Z',
            startedAt: '2026-05-21T09:00:00.000Z',
            closedAt: null,
          },
          activeSession: {
            id: 's1',
            flowId: 'main-menu',
            flowVersion: 'v21',
            currentNodeKey: 'human_handoff',
            status: 'paused',
            history: [],
            variables: {},
            startedAt: '2026-05-21T09:00:00.000Z',
            updatedAt: '2026-05-21T10:00:00.000Z',
          },
          humanHandoff: {
            id: 'h1',
            status: 'pending',
            reason: 'Derivación',
            requestedBy: 'bot',
            requestedAt: '2026-05-21T09:55:00.000Z',
          },
        }
      : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useConversationMessages: (id: string | null) => ({
    data: id
      ? {
          items: [
            {
              id: 'm1',
              conversationId: 'conv-1',
              direction: 'inbound',
              senderType: 'user',
              body: 'Quiero una persona',
              provider: 'twilio',
              providerMessageId: null,
              metadata: { botSkipped: true },
              createdAt: '2026-05-21T10:00:00.000Z',
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
          order: 'asc',
        }
      : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRefreshConversations: () => refreshMock,
  useClaimConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendAgentMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloseConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReturnToBot: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <ConversationsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ConversationsPage', () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  it('renderiza titulo y lista con etiquetas en español', () => {
    renderPage();
    expect(screen.getByText('Conversaciones')).toBeInTheDocument();
    expect(screen.getByText('Esperando humano')).toBeInTheDocument();
    expect(screen.getByText('+5491111111111')).toBeInTheDocument();
    expect(screen.getByText(/Quiero una persona/)).toBeInTheDocument();
  });

  it('muestra empty state de detalle sin seleccion', () => {
    renderPage();
    expect(
      screen.getByText('Seleccioná una conversación para ver el detalle'),
    ).toBeInTheDocument();
  });

  it('al seleccionar conversacion carga detalle y mensajes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('+5491111111111'));
    expect(screen.getByText('Flujo actual:')).toBeInTheDocument();
    expect(screen.getByText(/Motivo de derivación/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tomar conversación/i })).toBeInTheDocument();
  });

  it('boton Actualizar dispara refresh', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /actualizar/i }));
    expect(refreshMock).toHaveBeenCalled();
  });
});
