// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConversationsPage } from './ConversationsPage';

const refreshMock = vi.fn();
const useMediaQueryMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@mui/material', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mui/material')>();
  return {
    ...mod,
    useMediaQuery: (() => useMediaQueryMock()) as typeof mod.useMediaQuery,
  };
});

vi.mock('../../auth/api/authApi', () => ({
  authApi: {
    me: vi.fn().mockResolvedValue({
      ok: true,
      user: { username: 'admin', agentId: 'agent-test-id', role: 'admin' },
    }),
  },
}));

vi.mock('../../auth/context/AuthContext', () => ({
  useAuthUser: () => ({
    username: 'admin',
    agentId: 'agent-test-id',
    role: 'admin',
  }),
}));

vi.mock('../context/conversationLiveContext', () => ({
  useConversationLive: () => ({
    status: 'live' as const,
    markManual: vi.fn(),
    reconnect: vi.fn(),
    setSelectedConversationId: vi.fn(),
    registerHandlers: vi.fn(() => () => {}),
    soundAlertsEnabled: true,
    setSoundAlertsEnabled: vi.fn(),
    soundBlocked: false,
    unlockSound: vi.fn(async () => true),
  }),
}));

vi.mock('../hooks/useConversationLiveHandlers', () => ({
  useConversationLiveHandlers: vi.fn(),
}));

vi.mock('../hooks/useConversations', () => ({
  useConversations: () => ({
    data: {
      items: [
        {
          id: 'conv-1',
          channel: 'simulator',
          provider: 'internal',
          phoneNumber: null,
          displayName: 'Simulación - Esperando humano',
          status: 'waiting_human',
          assignedAgentId: null,
          currentFlowId: 'main-menu',
          currentFlowVersion: 'v22',
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
            channel: 'simulator',
            provider: 'internal',
            phoneNumber: null,
            displayName: 'Simulación - Esperando humano',
            status: 'waiting_human',
            assignedAgentId: null,
            currentFlowId: 'main-menu',
            currentFlowVersion: 'v22',
            currentNodeKey: 'human_handoff',
            lastMessageAt: '2026-05-21T10:00:00.000Z',
            startedAt: '2026-05-21T09:00:00.000Z',
            closedAt: null,
          },
          activeSession: {
            id: 's1',
            flowId: 'main-menu',
            flowVersion: 'v22',
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
            reason: 'human_handoff',
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
              provider: 'internal',
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
  useUpdateContact: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
    useMediaQueryMock.mockReturnValue(false);
  });

  it('renderiza titulo y lista con etiquetas en español', async () => {
    renderPage();
    expect(screen.getByText('Conversaciones')).toBeInTheDocument();
    expect(await screen.findByText('En vivo')).toBeInTheDocument();
    expect(screen.getByText('Esperando humano')).toBeInTheDocument();
    expect(screen.getByText('Simulación - Esperando humano')).toBeInTheDocument();
    expect(screen.getByText(/Quiero una persona/)).toBeInTheDocument();
  });

  it('no muestra datos técnicos al abrir detalle', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Simulación - Esperando humano'));
    expect(screen.queryByText('Flujo actual:')).toBeNull();
    expect(screen.queryByText(/7319B35A/i)).toBeNull();
    expect(screen.queryByText('Detalles técnicos')).not.toBeInTheDocument();
    expect(screen.getByText(/El usuario pidió hablar con una persona/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /tomar conversación/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('muestra empty state de detalle sin seleccion', () => {
    renderPage();
    expect(
      screen.getByText('Seleccioná una conversación para ver el detalle'),
    ).toBeInTheDocument();
  });

  it('no muestra el botón Devolver al bot', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Simulación - Esperando humano'));
    expect(screen.queryByRole('button', { name: /^devolver al bot$/i })).not.toBeInTheDocument();
  });

  it('boton Actualizar dispara refresh', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /actualizar/i }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('en mobile oculta la lista al abrir detalle y permite volver', async () => {
    useMediaQueryMock.mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByTestId('conversation-list-panel')).toBeVisible();
    expect(screen.getByTestId('conversation-detail-panel')).not.toBeVisible();

    await user.click(screen.getByText('Simulación - Esperando humano'));

    expect(screen.getByTestId('conversation-list-panel')).not.toBeVisible();
    expect(screen.getByTestId('conversation-detail-panel')).toBeVisible();
    expect(screen.getByRole('button', { name: /volver a la lista/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cerrar$/i })).toBeInTheDocument();
    expect(screen.queryByText(/Motivo:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Detalles técnicos')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /volver a la lista/i }));

    expect(screen.getByTestId('conversation-list-panel')).toBeVisible();
    expect(screen.getByTestId('conversation-detail-panel')).not.toBeVisible();
  });
});
