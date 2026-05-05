// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ComponentProps } from 'react';
import { ImportJsonVersionDialog } from './ImportJsonVersionDialog';

function renderDialog(props?: Partial<ComponentProps<typeof ImportJsonVersionDialog>>) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ImportJsonVersionDialog
        open
        loadingValidate={false}
        loadingCreate={false}
        onClose={vi.fn()}
        onValidate={vi.fn().mockResolvedValue({ valid: true })}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </ThemeProvider>
  );
}

describe('ImportJsonVersionDialog', () => {
  it('muestra error si el JSON es inválido', async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn();
    renderDialog({ onValidate });

    fireEvent.change(screen.getByLabelText(/json del flujo/i), { target: { value: '{invalid' } });
    await user.click(screen.getByRole('button', { name: /validar json/i }));

    expect(screen.getByText(/no es un json válido/i)).toBeInTheDocument();
    expect(onValidate).not.toHaveBeenCalled();
  });

  it('no habilita crear nueva versión hasta validar correctamente', async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn().mockResolvedValue({ valid: true });
    renderDialog({ onValidate });

    const createButton = screen.getByRole('button', { name: /crear nueva versión/i });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/json del flujo/i), {
      target: {
        value: '{"id":"main-menu","entryNode":"a","nodes":[{"id":"a","type":"message","message":"hola"}]}',
      },
    });
    await user.click(screen.getByRole('button', { name: /validar json/i }));

    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(createButton).not.toBeDisabled();
  });
});
