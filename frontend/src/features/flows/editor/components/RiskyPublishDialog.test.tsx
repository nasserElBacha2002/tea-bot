// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RiskyPublishDialog, RISKY_PUBLISH_CONFIRM_TEXT } from './RiskyPublishDialog';

describe('RiskyPublishDialog', () => {
  it('enables publish only after typing PUBLICAR exactly', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <RiskyPublishDialog
          open
          loading={false}
          error={null}
          blockingWarnings={[{ id: '1', message: 'Algo falla', severity: 'blocking' }]}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />
      </ThemeProvider>
    );
    const btn = screen.getByRole('button', { name: /poner en vivo igualmente/i });
    expect(btn).toBeDisabled();
    const input = screen.getByRole('textbox');
    await user.type(input, 'publicar');
    expect(btn).toBeDisabled();
    await user.clear(input);
    await user.type(input, RISKY_PUBLISH_CONFIRM_TEXT);
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });
});
