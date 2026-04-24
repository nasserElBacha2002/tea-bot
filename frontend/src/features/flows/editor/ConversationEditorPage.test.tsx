// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { Flow } from '../types/flow.types';
import { ConversationEditorPage } from './ConversationEditorPage';

const mockFlow: Flow = {
  id: 'f1',
  name: 'Mi flujo',
  version: 'draft',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [
    {
      id: 'a',
      type: 'message',
      message: 'Hola',
      transitions: [
        { type: 'matchIncludes', value: 'tea', nextNode: 'b' },
        { type: 'default', nextNode: 'b' },
      ],
      ui: { position: { x: 0, y: 0 } },
    },
    {
      id: 'b',
      type: 'message',
      message: 'Chau',
      transitions: [{ type: 'default', nextNode: 'a' }],
      ui: { position: { x: 1, y: 1 } },
    },
  ],
};

const flowMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const simulatorMocks = vi.hoisted(() => ({
  start: vi.fn(),
  message: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('../api/simulatorApi', () => ({
  simulatorApi: {
    start: simulatorMocks.start,
    message: simulatorMocks.message,
    reset: simulatorMocks.reset,
  },
}));

vi.mock('../hooks/useFlows', () => ({
  flowKeys: { detail: (id: string) => ['flows', 'detail', id] as const },
  useFlow: () => ({
    data: mockFlow,
    isLoading: false,
    isError: false,
  }),
  useUpdateFlow: () => ({
    mutateAsync: flowMocks.mutateAsync,
    get isPending() {
      return flowMocks.isPending;
    },
  }),
  useValidateFlow: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ valid: true }),
    isPending: false,
  }),
  usePublishFlow: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ flowId: 'f1', version: 'v1', publishedAt: '2024-01-01' }),
    isPending: false,
  }),
  usePublishedVersions: () => ({
    data: {
      flowId: 'f1',
      activeVersion: null,
      lastPublishedAt: null,
      updatedAt: null,
      versions: [],
    },
    isLoading: false,
  }),
  usePublishedVersionDetail: () => ({
    data: undefined,
    isLoading: false,
  }),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const theme = createTheme();
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/flows/f1/conversation']}>
          <Routes>
            <Route path="/flows/:flowId/conversation" element={<ConversationEditorPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ConversationEditorPage', () => {
  beforeEach(() => {
    flowMocks.mutateAsync.mockReset();
    flowMocks.mutateAsync.mockResolvedValue(mockFlow);
    flowMocks.isPending = false;
    simulatorMocks.start.mockReset();
    simulatorMocks.message.mockReset();
    simulatorMocks.reset.mockReset();
    simulatorMocks.start.mockResolvedValue({
      sessionId: 's1',
      reply: 'Hola desde simulador',
      flowId: 'f1',
      currentNodeId: 'a',
      variables: {},
    });
    simulatorMocks.message.mockResolvedValue({
      sessionId: 's1',
      reply: 'Ok',
      flowId: 'f1',
      currentNodeId: 'a',
      variables: {},
    });
    simulatorMocks.reset.mockResolvedValue(undefined);
    // MUI `useMediaQuery(theme.breakpoints.up('md'))` usa min-width:900px por defecto
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: String(query).includes('900px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  it('does not render the advanced-rules warning banner', async () => {
    renderPage();
    await screen.findByText('Mi flujo');
    expect(screen.queryByText(/regla avanzada/i)).toBeNull();
    expect(screen.queryByText(/vista técnica/i)).toBeNull();
  });

  it('keeps Guardar disabled until the user edits', async () => {
    renderPage();
    const saveBtn = await screen.findByRole('button', { name: /guardar/i });
    expect(saveBtn).toBeDisabled();
  });

  it('enables Guardar after an edit', async () => {
    const user = userEvent.setup();
    renderPage();
    const saveBtn = await screen.findByRole('button', { name: /guardar/i });
    expect(saveBtn).toBeDisabled();
    const titleFields = await screen.findAllByLabelText(/nombre del paso/i);
    const titleField = titleFields[0]!;
    await user.clear(titleField);
    await user.type(titleField, 'X');
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
  });

  it('shows saving chip while mutation is pending', async () => {
    flowMocks.isPending = true;
    renderPage();
    await screen.findByText('Guardando cambios…');
  });

  it('renders simulator panel with chat on desktop', async () => {
    renderPage();
    await screen.findByText('Mi flujo');
    expect(await screen.findByText('Probar conversación')).toBeTruthy();
    expect(await screen.findByText('Hola desde simulador')).toBeTruthy();
    expect(simulatorMocks.start).toHaveBeenCalled();
  });

  it('opens simulator modal from Probar on small screens', async () => {
    const user = userEvent.setup();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    renderPage();
    await screen.findByText('Mi flujo');
    await user.click(screen.getByRole('button', { name: /probar/i }));
    expect(await screen.findByRole('button', { name: /listo/i })).toBeTruthy();
    expect(await screen.findByText('Hola desde simulador')).toBeTruthy();
  });
});
