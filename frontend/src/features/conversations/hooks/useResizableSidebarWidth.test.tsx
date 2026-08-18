// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook, act } from '@testing-library/react';
import {
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  useResizableSidebarWidth,
} from './useResizableSidebarWidth';
import { ConversationSidebarResizeHandle } from '../components/ConversationSidebarResizeHandle';

describe('useResizableSidebarWidth', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  });

  it('pointer down/move/up cambia ancho y persiste respetando límites', () => {
    const { result } = renderHook(() => useResizableSidebarWidth(true));
    const startWidth = result.current.width;

    act(() => {
      result.current.beginResize(400);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }));
    });
    expect(result.current.width).toBe(startWidth + 100);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    const stored = Number.parseInt(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || '',
      10,
    );
    expect(stored).toBe(result.current.width);
    expect(stored).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
    expect(stored).toBeLessThanOrEqual(Math.floor(1200 * 0.5));
  });

  it('nudgeWidth respeta mínimo', () => {
    const { result } = renderHook(() => useResizableSidebarWidth(true));

    act(() => {
      result.current.nudgeWidth(-10_000);
    });

    expect(result.current.width).toBe(SIDEBAR_MIN_WIDTH);
  });
});

describe('ConversationSidebarResizeHandle', () => {
  it('ajusta ancho con teclado ArrowLeft/ArrowRight', async () => {
    const user = userEvent.setup();
    let width = SIDEBAR_DEFAULT_WIDTH;
    const minWidth = SIDEBAR_MIN_WIDTH;
    const maxWidth = 600;
    const onKeyboardNudge = vi.fn((delta: number) => {
      width = Math.min(Math.max(width + delta, minWidth), maxWidth);
    });

    render(
      <ConversationSidebarResizeHandle
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        onPointerDown={vi.fn()}
        onKeyboardNudge={onKeyboardNudge}
      />,
    );

    const handle = screen.getByTestId('conversation-sidebar-resize-handle');
    handle.focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowLeft}');

    expect(onKeyboardNudge).toHaveBeenCalledWith(16);
    expect(onKeyboardNudge).toHaveBeenCalledWith(-16);
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuemin', String(minWidth));
    expect(handle).toHaveAttribute('aria-valuemax', String(maxWidth));
  });
});
