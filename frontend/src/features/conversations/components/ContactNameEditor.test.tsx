// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ContactNameEditor } from './ContactNameEditor';

describe('ContactNameEditor', () => {
  it('permite editar y guardar el nombre', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ThemeProvider theme={createTheme()}>
        <ContactNameEditor displayName={null} onSave={onSave} />
      </ThemeProvider>,
    );

    await user.click(screen.getByLabelText('Editar nombre del contacto'));
    const input = screen.getByLabelText('Nombre del contacto');
    await user.type(input, 'Juan Pérez');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onSave).toHaveBeenCalledWith('Juan Pérez');
  });

  it('cancela con Escape', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <ThemeProvider theme={createTheme()}>
        <ContactNameEditor displayName="Ana" onSave={onSave} />
      </ThemeProvider>,
    );

    await user.click(screen.getByLabelText('Editar nombre del contacto'));
    const input = screen.getByLabelText('Nombre del contacto');
    await user.clear(input);
    await user.type(input, 'Otro');
    await user.keyboard('{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Nombre del contacto')).not.toBeInTheDocument();
  });
});
