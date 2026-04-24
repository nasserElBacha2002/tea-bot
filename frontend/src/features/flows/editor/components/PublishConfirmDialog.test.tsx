// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { PublishConfirmDialog } from './PublishConfirmDialog';

describe('PublishConfirmDialog', () => {
  it('requires checkbox before enabling confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <PublishConfirmDialog open loading={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />
      </ThemeProvider>
    );
    const confirmBtn = screen.getByRole('button', { name: /sí, poner en vivo/i });
    expect(confirmBtn).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalled();
  });
});
