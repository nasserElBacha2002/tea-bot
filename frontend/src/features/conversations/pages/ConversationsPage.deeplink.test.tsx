// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ConversationsPage } from './ConversationsPage';

const refreshMock = vi.fn();
const useMediaQueryMock = vi.hoisted(() => vi.fn(() => false));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const detailDeferred = vi.hoisted(() => new Map<string, Deferred<ReturnType<typeof buildDetail>>>());
const messagesDeferred = vi.hoisted(() => new Map<string, Deferred<ReturnType<typeof buildMessages>>>());

vi.mock('@mui/material', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mui/material')>();
  return {
    ...mod,
    useMediaQuery: (() => useMediaQueryMock()) as typeof mod.useMediaQuery,
  };
});

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

const listItemA = {
  id: 'conv-a',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Conversación A',
  status: 'bot',
  assignedAgentId: null,
  currentFlowId: 'main-menu',
  currentFlowVersion: 'v22',
  currentNodeKey: 'welcome',
  lastMessageAt: '2026-05-21T10:00:00.000Z',
  startedAt: '2026-05-21T09:00:00.000Z',
  closedAt: null,
  lastMessage: {
    body: 'Hola A',
    direction: 'inbound',
    senderType: 'user',
    createdAt: '2026-05-21T10:00:00.000Z',
  },
  humanHandoff: null,
};

const listItemB = {
  ...listItemA,
  id: 'conv-b',
  displayName: 'Conversación B',
  lastMessage: { ...listItemA.lastMessage, body: 'Hola B' },
};

const listItemC = {
  ...listItemA,
  id: 'conv-c',
  displayName: 'Conversación C',
  lastMessage: { ...listItemA.lastMessage, body: 'Hola C' },
};

function buildDetail(id: string, name: string) {
  return {
    conversation: {
      id,
      channel: 'simulator',
      provider: 'internal',
      phoneNumber: null,
      displayName: name,
      status: 'bot',
      assignedAgentId: null,
      currentFlowId: 'main-menu',
      currentFlowVersion: 'v22',
      currentNodeKey: 'welcome',
      lastMessageAt: '2026-05-21T10:00:00.000Z',
      startedAt: '2026-05-21T09:00:00.000Z',
      closedAt: null,
    },
    activeSession: null,
    humanHandoff: null,
  };
}

function buildMessages(id: string) {
  return {
    items: [
      {
        id: `m-${id}`,
        conversationId: id,
        direction: 'inbound',
        senderType: 'user',
        body: `Mensaje ${id}`,
        provider: 'internal',
        providerMessageId: null,
        metadata: {},
        createdAt: '2026-05-21T10:00:00.000Z',
      },
    ],
    total: 1,
    limit: 200,
    offset: 0,
    order: 'asc' as const,
  };
}

function detailName(id: string) {
  if (id === 'conv-z') return 'Conversación Z';
  if (id === 'conv-b') return 'Conversación B';
  if (id === 'conv-c') return 'Conversación C';
  return 'Conversación A';
}

function ensureDetailDeferred(id: string) {
  if (!detailDeferred.has(id)) {
    detailDeferred.set(id, createDeferred());
  }
  return detailDeferred.get(id)!;
}

function ensureMessagesDeferred(id: string) {
  if (!messagesDeferred.has(id)) {
    messagesDeferred.set(id, createDeferred());
  }
  return messagesDeferred.get(id)!;
}

vi.mock('../api/conversationsApi', () => ({
  conversationsApi: {
    list: vi.fn(async () => ({
      items: [listItemA, listItemB, listItemC],
      total: 3,
      limit: 50,
      offset: 0,
    })),
    getDetail: vi.fn(async (id: string) => {
      if (id === 'conv-missing') {
        const err = new Error('Recurso no encontrado') as Error & { status?: number; code?: string };
        err.status = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      return ensureDetailDeferred(id).promise;
    }),
    getMessages: vi.fn(async (id: string) => ensureMessagesDeferred(id).promise),
    claim: vi.fn(),
    sendMessage: vi.fn(),
    close: vi.fn(),
    updateContact: vi.fn(),
  },
}));

function resolveDetailAndMessages(id: string) {
  const name = detailName(id);
  ensureDetailDeferred(id).resolve(buildDetail(id, name));
  ensureMessagesDeferred(id).resolve(buildMessages(id));
}

function renderWithRouter(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/conversations', element: <ConversationsPage /> },
      { path: '/conversations/:conversationId', element: <ConversationsPage /> },
    ],
    { initialEntries: [initialEntry], initialIndex: 0 },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createTheme()}>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return router;
}

describe('ConversationsPage deep-link', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    detailDeferred.clear();
    messagesDeferred.clear();
    useMediaQueryMock.mockReturnValue(false);
    ['conv-a', 'conv-b', 'conv-c', 'conv-z'].forEach((id) => {
      resolveDetailAndMessages(id);
    });
  });

  it('sin ID muestra lista y empty state del detalle', async () => {
    const router = renderWithRouter('/conversations');
    expect(router.state.location.pathname).toBe('/conversations');
    expect(await screen.findByText('Conversación A')).toBeInTheDocument();
    expect(
      screen.getByText('Seleccioná una conversación para ver el detalle'),
    ).toBeInTheDocument();
  });

  it('con ID en URL ejecuta detail y messages fetch', async () => {
    renderWithRouter('/conversations/conv-a');
    await waitFor(() => {
      expect(screen.getByTestId('conversation-detail-panel')).toBeInTheDocument();
    });
    const detailPanel = screen.getByTestId('conversation-detail-panel');
    expect(await within(detailPanel).findByText('Mensaje conv-a')).toBeInTheDocument();
  });

  it('click en conversación navega a /conversations/:id', async () => {
    const user = userEvent.setup();
    const router = renderWithRouter('/conversations');
    await user.click(await screen.findByText('Conversación A'));
    expect(router.state.location.pathname).toBe('/conversations/conv-a');
    const detailPanel = screen.getByTestId('conversation-detail-panel');
    expect(await within(detailPanel).findByText('Mensaje conv-a')).toBeInTheDocument();
  });

  it('browser back y forward restauran la conversación seleccionada', async () => {
    const user = userEvent.setup();
    const router = renderWithRouter('/conversations/conv-a');
    expect(router.state.location.pathname).toBe('/conversations/conv-a');

    await user.click(await screen.findByText('Conversación B'));
    expect(router.state.location.pathname).toBe('/conversations/conv-b');

    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/conversations/conv-a');
    expect(await within(screen.getByTestId('conversation-detail-panel')).findByText('Mensaje conv-a')).toBeInTheDocument();

    await router.navigate(1);
    expect(router.state.location.pathname).toBe('/conversations/conv-b');
    expect(await within(screen.getByTestId('conversation-detail-panel')).findByText('Mensaje conv-b')).toBeInTheDocument();
  });

  it('ID fuera del listado abre detalle cuando backend lo conoce', async () => {
    renderWithRouter('/conversations/conv-z');
    const detailPanel = screen.getByTestId('conversation-detail-panel');
    expect(await within(detailPanel).findByText('Mensaje conv-z')).toBeInTheDocument();
  });

  it('404 muestra estado controlado sin confundir 401/403', async () => {
    renderWithRouter('/conversations/conv-missing');
    expect(await screen.findByText('Conversación no encontrada')).toBeInTheDocument();
    expect(await screen.findByText('Conversación A')).toBeInTheDocument();
  });

  it('cambio rápido A→B→C con responses fuera de orden mantiene detalle de C', async () => {
    detailDeferred.clear();
    messagesDeferred.clear();
    ['conv-a', 'conv-b', 'conv-c'].forEach((id) => {
      ensureDetailDeferred(id);
      ensureMessagesDeferred(id);
    });

    const user = userEvent.setup();
    const router = renderWithRouter('/conversations/conv-a');

    await user.click(await screen.findByText('Conversación B'));
    await user.click(await screen.findByText('Conversación C'));
    expect(router.state.location.pathname).toBe('/conversations/conv-c');

    resolveDetailAndMessages('conv-c');
    resolveDetailAndMessages('conv-b');
    resolveDetailAndMessages('conv-a');

    const detailPanel = screen.getByTestId('conversation-detail-panel');
    expect(await within(detailPanel).findByText('Mensaje conv-c')).toBeInTheDocument();
    expect(within(detailPanel).queryByText('Mensaje conv-a')).not.toBeInTheDocument();
    expect(within(detailPanel).queryByText('Mensaje conv-b')).not.toBeInTheDocument();
  });
});
