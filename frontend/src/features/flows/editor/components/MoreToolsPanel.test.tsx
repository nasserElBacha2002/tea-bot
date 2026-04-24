// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MoreToolsPanel } from './MoreToolsPanel';
import type { ConversationViewModel } from '../model/conversationViewModel';
import type { Flow } from '../../types/flow.types';
import { MAP_INTRO_STORAGE_KEY } from './AdvancedMapIntroDialog';

vi.mock('../../hooks/useFlows', () => ({
  usePublishedVersions: () => ({
    data: {
      activeVersion: 'v1',
      lastPublishedAt: '2024-01-01T00:00:00.000Z',
      versions: [
        {
          version: 'v1',
          versionLabel: 'v1',
          publishedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useDuplicatePublishedToDraft: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

vi.mock('../../components/FlowGraphCanvas', () => ({
  FlowGraphCanvas: () => <div data-testid="flow-graph-canvas" />,
}));

const vm: ConversationViewModel = {
  flowId: 'f1',
  flowName: 'F',
  version: 'draft',
  status: 'draft',
  entryStepId: 'a',
  fallbackStepId: 'b',
  steps: [
    {
      uiId: 'a',
      internalId: 'a',
      title: 'Uno',
      message: 'Hola',
      responses: [
        {
          uiId: 'r1',
          kind: 'fallback',
          values: [],
          destinationStepId: 'b',
          displayOrder: 0,
        },
      ],
      metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
    },
    {
      uiId: 'b',
      internalId: 'b',
      title: 'Dos',
      message: 'Chau',
      responses: [],
      metadata: { nodeType: 'end', position: { x: 1, y: 0 } },
    },
  ],
  compatibilityWarnings: [],
};

const draftFlow: Flow = {
  id: 'f1',
  name: 'F',
  version: 'draft',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [],
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={createTheme()}>
        <MoreToolsPanel
          flowId="f1"
          viewModel={vm}
          draftFlow={draftFlow}
          editorDirty={false}
          onRestoreSuccess={vi.fn()}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('MoreToolsPanel', () => {
  beforeEach(() => {
    localStorage.removeItem(MAP_INTRO_STORAGE_KEY);
  });

  it('renders Conexiones without raw JSON', () => {
    renderPanel();
    expect(screen.getByRole('columnheader', { name: /paso origen/i })).toBeInTheDocument();
    expect(screen.queryByText(/\{/)).not.toBeInTheDocument();
  });

  it('shows Historial and opens restore confirmation', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: /historial/i }));
    await user.click(screen.getByRole('button', { name: /traer a mi borrador/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/traer versión al borrador/i)).toBeInTheDocument();
  });

  it('shows map intro on first open and then canvas', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('tab', { name: /^mapa$/i }));
    await user.click(screen.getByRole('button', { name: /abrir mapa/i }));
    expect(screen.getByRole('dialog', { name: /mapa avanzado/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /entendido, abrir mapa/i }));
    expect(await screen.findByTestId('flow-graph-canvas')).toBeInTheDocument();
  });
});
