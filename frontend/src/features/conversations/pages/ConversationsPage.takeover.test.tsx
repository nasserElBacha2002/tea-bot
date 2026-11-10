// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConversationsPage } from './ConversationsPage';
import { conversationsApi } from '../api/conversationsApi';
import { resetClientRequestIdsForTests } from '../utils/clientRequestId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

vi.mock('../api/conversationsApi', () => ({
  conversationsApi: {
    list: vi.fn(),
    getDetail: vi.fn(),
    getMessages: vi.fn(),
    takeover: vi.fn(),
    claim: vi.fn(),
    sendMessage: vi.fn(),
    close: vi.fn(),
    updateContact: vi.fn(),
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

const originalCrypto = globalThis.crypto;

function renderOpenConversation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={['/conversations/conv-1']}>
          <Routes>
            <Route path="/conversations/:conversationId" element={<ConversationsPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function clickTakeover() {
  const user = userEvent.setup();
  const buttons = await screen.findAllByRole('button', { name: 'Tomar conversación' });
  await user.click(buttons[0]);
}

beforeEach(() => {
  resetClientRequestIdsForTests();
  vi.mocked(conversationsApi.list).mockResolvedValue({
    items: [
      {
        id: 'conv-1',
        channel: 'simulator',
        provider: 'internal',
        phoneNumber: null,
        displayName: 'Conversación de prueba',
        status: 'bot',
        assignedAgentId: null,
        canTakeover: true,
        statusVersion: 7,
        currentFlowId: 'main-menu',
        currentFlowVersion: 'v62',
        currentNodeKey: 'main',
        lastMessageAt: '2026-11-10T20:00:00.000Z',
        startedAt: '2026-11-10T19:00:00.000Z',
        closedAt: null,
        lastMessage: null,
        humanHandoff: null,
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  });
  vi.mocked(conversationsApi.getDetail).mockResolvedValue({
    conversation: {
      id: 'conv-1',
      channel: 'simulator',
      provider: 'internal',
      phoneNumber: null,
      displayName: 'Conversación de prueba',
      status: 'bot',
      assignedAgentId: null,
      canTakeover: true,
      statusVersion: 7,
      currentFlowId: 'main-menu',
      currentFlowVersion: 'v62',
      currentNodeKey: 'main',
      lastMessageAt: '2026-11-10T20:00:00.000Z',
      startedAt: '2026-11-10T19:00:00.000Z',
      closedAt: null,
    },
    activeSession: null,
    humanHandoff: null,
  });
  vi.mocked(conversationsApi.getMessages).mockResolvedValue({
    items: [],
    total: 0,
    limit: 200,
    offset: 0,
    order: 'asc',
  });
  vi.mocked(conversationsApi.takeover).mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
  resetClientRequestIdsForTests();
});

describe('Tomar conversación', () => {
  it('envía un clientRequestId válido y habilita la respuesta manual', async () => {
    vi.mocked(conversationsApi.takeover).mockImplementation(async () => {
      vi.mocked(conversationsApi.getDetail).mockResolvedValue({
        conversation: {
          id: 'conv-1',
          channel: 'simulator',
          provider: 'internal',
          phoneNumber: null,
          displayName: 'Conversación de prueba',
          status: 'assigned',
          assignedAgentId: 'agent-test-id',
          canTakeover: false,
          canReturnToBot: true,
          statusVersion: 8,
          currentFlowId: 'main-menu',
          currentFlowVersion: 'v62',
          currentNodeKey: 'main',
          lastMessageAt: '2026-11-10T20:00:00.000Z',
          startedAt: '2026-11-10T19:00:00.000Z',
          closedAt: null,
        },
        activeSession: null,
        humanHandoff: null,
      });
      return {
        conversation: {
          id: 'conv-1',
          channel: 'simulator',
          provider: 'internal',
          phoneNumber: null,
          displayName: 'Conversación de prueba',
          status: 'assigned',
          assignedAgentId: 'agent-test-id',
          canTakeover: false,
          canReturnToBot: true,
          statusVersion: 8,
          currentFlowId: 'main-menu',
          currentFlowVersion: 'v62',
          currentNodeKey: 'main',
          lastMessageAt: '2026-11-10T20:00:00.000Z',
          startedAt: '2026-11-10T19:00:00.000Z',
          closedAt: null,
          lastMessage: null,
          humanHandoff: null,
        },
        idempotent: false,
      };
    });

    renderOpenConversation();
    await clickTakeover();

    expect(conversationsApi.takeover).toHaveBeenCalledWith('conv-1', {
      expectedVersion: 7,
      clientRequestId: expect.stringMatching(UUID_V4),
    });
    expect(await screen.findByText('Conversación tomada. El bot quedó pausado.')).toBeInTheDocument();
    expect(screen.getByLabelText('Responder')).toBeEnabled();
  });

  it('muestra el conflicto 409 sin perder el clientRequestId del reintento', async () => {
    const conflict = new Error('La conversación ya está asignada a otro agente.') as Error & {
      code: string;
      status: number;
    };
    conflict.code = 'CONVERSATION_OWNED';
    conflict.status = 409;
    vi.mocked(conversationsApi.takeover).mockRejectedValue(conflict);

    renderOpenConversation();
    await clickTakeover();
    await clickTakeover();

    const first = vi.mocked(conversationsApi.takeover).mock.calls[0]?.[1]?.clientRequestId;
    const retry = vi.mocked(conversationsApi.takeover).mock.calls[1]?.[1]?.clientRequestId;
    expect(first).toMatch(UUID_V4);
    expect(retry).toBe(first);
    expect(await screen.findByText('La conversación ya está asignada a otro agente.')).toBeInTheDocument();
  });

  it('informa un error controlado cuando no hay aleatoriedad segura', async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });

    renderOpenConversation();
    await clickTakeover();

    expect(conversationsApi.takeover).not.toHaveBeenCalled();
    expect(
      await screen.findByText('No hay una fuente segura para generar el identificador de la solicitud.'),
    ).toBeInTheDocument();
  });
});
