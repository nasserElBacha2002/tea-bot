// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RestoreDraftDialog } from './RestoreDraftDialog';

const target = {
  version: 'v-1',
  versionLabel: '2024-01-01',
  publishedAt: new Date('2024-01-02T12:00:00Z').toISOString(),
};

describe('RestoreDraftDialog', () => {
  it('opens with strong copy and dirty warning', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ThemeProvider theme={createTheme()}>
        <RestoreDraftDialog
          open
          target={target}
          editorDirty
          loading={false}
          errorMessage={null}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />
      </ThemeProvider>
    );
    expect(screen.getByText(/cambios sin guardar/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sí, traer al borrador/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('uses milder alert when draft is clean', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <RestoreDraftDialog
          open
          target={target}
          editorDirty={false}
          loading={false}
          errorMessage={null}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.queryByText(/cambios sin guardar/i)).not.toBeInTheDocument();
    expect(screen.getByText(/borrador actual se reemplazará/i)).toBeInTheDocument();
  });
});
