// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { StepsIndex } from './StepsIndex';
import type { ConversationStep } from '../model/conversationViewModel';

function step(id: string, destinations: string[]): ConversationStep {
  return {
    uiId: id,
    internalId: id,
    title: `Title ${id}`,
    message: 'msg',
    responses: destinations.map((dest, index) => ({
      uiId: `${id}__r${index}`,
      kind: 'exact',
      values: ['1'],
      destinationStepId: dest,
      displayOrder: index,
    })),
    metadata: { nodeType: 'message', position: { x: 0, y: 0 } },
  };
}

function renderIndex(props: Partial<React.ComponentProps<typeof StepsIndex>> = {}) {
  const steps = props.steps ?? [step('step10', ['step2']), step('step2', []), step('step1', ['step10'])];
  return render(
    <ThemeProvider theme={createTheme()}>
      <StepsIndex
        steps={steps}
        entryStepId={props.entryStepId ?? 'step1'}
        activeStepId={props.activeStepId ?? null}
        onStepSelect={props.onStepSelect ?? vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe('StepsIndex', () => {
  it('renders steps in path order instead of id order', () => {
    renderIndex();
    const buttons = screen.getAllByRole('button');
    const labels = buttons.map(btn => btn.textContent ?? '');
    expect(labels[0]).toContain('Title step1');
    expect(labels[1]).toContain('Title step10');
    expect(labels[2]).toContain('Title step2');
  });

  it('shows orphan section for unreachable steps', () => {
    renderIndex({
      steps: [step('entry', ['next']), step('next', []), step('lonely', [])],
      entryStepId: 'entry',
    });
    expect(screen.getByText('Pasos desconectados')).toBeTruthy();
    expect(screen.getByText('Title lonely')).toBeTruthy();
  });

  it('applies branch depth data attributes', () => {
    renderIndex();
    const child = document.querySelector('[data-step-id="step10"]');
    expect(child?.getAttribute('data-depth')).toBe('1');
  });

  it('keeps selected state visible', async () => {
    const user = userEvent.setup();
    const onStepSelect = vi.fn();
    renderIndex({ onStepSelect, activeStepId: 'step10' });
    const selected = document.querySelector('[data-step-id="step10"]');
    expect(selected?.className).toMatch(/Mui-selected/);
    await user.click(screen.getByText('Title step2'));
    expect(onStepSelect).toHaveBeenCalledWith('step2');
  });

  it('shows search field for larger flows', () => {
    const manySteps = [
      step('step1', ['step2']),
      step('step2', ['step3']),
      step('step3', ['step4']),
      step('step4', ['step5']),
      step('step5', ['step6']),
      step('step6', ['step7']),
      step('step7', []),
    ];
    renderIndex({ steps: manySteps, entryStepId: 'step1' });
    expect(screen.getByPlaceholderText('Buscar…')).toBeTruthy();
  });
});
