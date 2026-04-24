// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { SimulatorDetailsAccordion } from './SimulatorDetailsAccordion';

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);
}

describe('SimulatorDetailsAccordion', () => {
  it('is collapsed by default', () => {
    wrap(<SimulatorDetailsAccordion currentStepTitle="Paso 1" variables={{}} />);
    const btn = screen.getByRole('button', { name: /detalles \(opcional\)/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows step title and empty data message when expanded', async () => {
    const user = userEvent.setup();
    wrap(<SimulatorDetailsAccordion currentStepTitle="Bienvenida" variables={{}} />);
    await user.click(screen.getByText('Detalles (opcional)'));
    expect(await screen.findByText('Bienvenida')).toBeTruthy();
    expect(screen.getByText('Aún no se guardó ningún dato')).toBeTruthy();
  });

  it('does not render raw JSON blobs in the table', async () => {
    const user = userEvent.setup();
    wrap(<SimulatorDetailsAccordion currentStepTitle="X" variables={{ campo: 'simple' }} />);
    await user.click(screen.getByText('Detalles (opcional)'));
    expect(screen.getByText('simple')).toBeTruthy();
    expect(screen.queryByText(/\{\s*"/)).toBeNull();
  });
});
