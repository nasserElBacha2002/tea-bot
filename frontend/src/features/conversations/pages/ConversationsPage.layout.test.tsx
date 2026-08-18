// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ConversationsPage } from './ConversationsPage';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '../hooks/useResizableSidebarWidth';

const useMediaQueryMock = vi.hoisted(() => vi.fn(() => false));

const listItem = {
  id: 'conv-scroll',
  channel: 'simulator',
  provider: 'internal',
  phoneNumber: null,
  displayName: 'Conversación scroll',
  status: 'bot',
  assignedAgentId: null,
  currentFlowId: 'main-menu',
  currentFlowVersion: 'v22',
  currentNodeKey: 'welcome',
  lastMessageAt: '2026-05-21T10:00:00.000Z',
  startedAt: '2026-05-21T09:00:00.000Z',
  closedAt: null,
  lastMessage: {
    body: 'Hola',
    direction: 'inbound',
    senderType: 'user',
    createdAt: '2026-05-21T10:00:00.000Z',
  },
  humanHandoff: null,
};

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

vi.mock('../api/conversationsApi', () => ({
  conversationsApi: {
    list: vi.fn(async () => ({
      items: [listItem],
      total: 1,
      limit: 50,
      offset: 0,
    })),
    getDetail: vi.fn(async () => ({
      conversation: listItem,
      activeSession: null,
      humanHandoff: null,
    })),
    getMessages: vi.fn(async () => ({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
      order: 'asc',
    })),
    claim: vi.fn(),
    sendMessage: vi.fn(),
    close: vi.fn(),
    updateContact: vi.fn(),
  },
}));

function renderPage(path = '/conversations') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/conversations', element: <ConversationsPage /> },
      { path: '/conversations/:conversationId', element: <ConversationsPage /> },
    ],
    { initialEntries: [path] },
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

describe('ConversationsPage layout', () => {
  beforeEach(() => {
    useMediaQueryMock.mockReturnValue(false);
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  });

  it('coloca el buscador antes de los filtros en columna', async () => {
    renderPage();
    const filters = await screen.findByTestId('conversation-filters');
    const search = screen.getByTestId('conversation-search-input');
    const status = screen.getByTestId('conversation-status-filter');
    expect(filters.contains(search)).toBe(true);
    expect(filters.contains(status)).toBe(true);
    expect(
      search.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('expone contenedor scrollable para la lista con header fijo', async () => {
    renderPage();
    const panel = await screen.findByTestId('conversation-list-panel');
    const scroll = await screen.findByTestId('conversation-list-scroll');
    const header = screen.getByTestId('conversation-sidebar-header');

    expect(panel.contains(header)).toBe(true);
    expect(panel.contains(scroll)).toBe(true);
    expect(scroll).toHaveStyle({ overflowY: 'auto', flex: '1', minHeight: '0px' });
    expect(header).toHaveStyle({ flexShrink: '0' });
  });

  it('mantiene scroll de mensajes independiente en detalle', async () => {
    renderPage('/conversations/conv-scroll');
    expect(await screen.findByTestId('conversation-messages-scroll-region')).toHaveStyle({
      overflowY: 'auto',
    });
  });

  it('muestra resize handle en desktop', async () => {
    renderPage();
    expect(await screen.findByTestId('conversation-sidebar-resize-handle')).toBeInTheDocument();
  });

  it('oculta resize handle en mobile', () => {
    useMediaQueryMock.mockReturnValue(true);
    renderPage();
    expect(screen.queryByTestId('conversation-sidebar-resize-handle')).not.toBeInTheDocument();
  });

  it('ignora ancho inválido en localStorage', async () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, 'not-a-number');
    renderPage();
    expect(await screen.findByTestId('conversation-list-panel')).toBeInTheDocument();
  });
});
