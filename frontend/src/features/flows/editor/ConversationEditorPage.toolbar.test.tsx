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
      transitions: [{ type: 'default', nextNode: 'b' }],
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
  validateAsync: vi.fn(),
  isPending: false,
  validatePending: false,
}));

vi.mock('../api/simulatorApi', () => ({
  simulatorApi: {
    start: vi.fn().mockResolvedValue({ sessionId: 's', reply: 'ok', flowId: 'f1', currentNodeId: 'a', variables: {} }),
    message: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../hooks/useFlows', () => ({
  flowKeys: { detail: (id: string) => ['flows', 'detail', id] as const },
  useFlow: () => ({ data: mockFlow, isLoading: false, isError: false }),
  useUpdateFlow: () => ({
    mutateAsync: flowMocks.mutateAsync,
    get isPending() {
      return flowMocks.isPending;
    },
  }),
  useValidateFlow: () => ({
    mutateAsync: flowMocks.validateAsync,
    get isPending() {
      return flowMocks.validatePending;
    },
  }),
  useImportJsonAsNewVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublishFlow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublishedVersions: () => ({
    data: { flowId: 'f1', activeVersion: null, versions: [] },
    isLoading: false,
  }),
  usePublishedVersionDetail: () => ({ data: undefined, isLoading: false }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={['/flows/f1/conversation']}>
          <Routes>
            <Route path="/flows/:flowId/conversation" element={<ConversationEditorPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ConversationEditorPage toolbar UX', () => {
  beforeEach(() => {
    flowMocks.mutateAsync.mockReset().mockResolvedValue(mockFlow);
    flowMocks.validateAsync.mockReset().mockResolvedValue({ valid: true });
    flowMocks.isPending = false;
    flowMocks.validatePending = false;
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

  it('no muestra Datos ni Validar en la barra principal', async () => {
    renderPage();
    await screen.findByText('Mi flujo');
    expect(screen.queryByRole('button', { name: /^datos$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^validar$/i })).toBeNull();
  });

  it('muestra Guardar cambios y Más herramientas al final', async () => {
    renderPage();
    await screen.findByRole('button', { name: /guardar cambios/i });
    expect(screen.getByRole('button', { name: /más herramientas/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /descargar json/i })).toBeTruthy();
  });

  it('valida antes de guardar y no persiste si falla validación local', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Mi flujo');
    await user.click(screen.getByRole('button', { name: /añadir paso/i }));
    const saveBtn = screen.getByRole('button', { name: /guardar cambios/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await user.click(saveBtn);
    expect(flowMocks.validateAsync).not.toHaveBeenCalled();
    expect(flowMocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('valida en servidor y guarda si todo es válido', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Mi flujo');
    const titleFields = await screen.findAllByLabelText(/nombre del paso/i);
    await user.clear(titleFields[0]!);
    await user.type(titleFields[0]!, 'Paso A');
    const saveBtn = screen.getByRole('button', { name: /guardar cambios/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await user.click(saveBtn);
    await waitFor(() => expect(flowMocks.validateAsync).toHaveBeenCalled());
    await waitFor(() => expect(flowMocks.mutateAsync).toHaveBeenCalled());
  });
});
