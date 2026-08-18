import { useCallback, useEffect, useRef, useState } from 'react';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'conversations.sidebarWidth';
export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_DEFAULT_WIDTH = 390;
export const SIDEBAR_MAX_VIEWPORT_RATIO = 0.5;

function clampSidebarWidth(value: number, viewportWidth: number) {
  const maxWidth = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth * SIDEBAR_MAX_VIEWPORT_RATIO),
  );
  return Math.min(Math.max(value, SIDEBAR_MIN_WIDTH), maxWidth);
}

function readStoredWidth(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return clampSidebarWidth(parsed, window.innerWidth);
}

export function useResizableSidebarWidth(enabled: boolean) {
  const [width, setWidth] = useState<number>(() => readStoredWidth() ?? SIDEBAR_DEFAULT_WIDTH);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    if (!enabled) return undefined;
    const onResize = () => {
      setWidth((current) => clampSidebarWidth(current, window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled]);

  const persistWidth = useCallback((nextWidth: number) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
  }, []);

  const beginResize = useCallback(
    (clientX: number) => {
      if (!enabled) return;
      draggingRef.current = true;
      startXRef.current = clientX;
      startWidthRef.current = width;
    },
    [enabled, width],
  );

  const updateResize = useCallback(
    (clientX: number) => {
      if (!draggingRef.current || !enabled) return;
      const delta = clientX - startXRef.current;
      const next = clampSidebarWidth(startWidthRef.current + delta, window.innerWidth);
      setWidth(next);
    },
    [enabled],
  );

  const endResize = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setWidth((current) => {
      persistWidth(current);
      return current;
    });
  }, [persistWidth]);

  const nudgeWidth = useCallback(
    (delta: number) => {
      if (!enabled) return;
      setWidth((current) => {
        const next = clampSidebarWidth(current + delta, window.innerWidth);
        persistWidth(next);
        return next;
      });
    },
    [enabled, persistWidth],
  );

  const maxWidth = clampSidebarWidth(Number.MAX_SAFE_INTEGER, window.innerWidth);

  useEffect(() => {
    if (!enabled) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      updateResize(event.clientX);
    };
    const onPointerUp = () => {
      endResize();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [enabled, endResize, updateResize]);

  return {
    width,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth,
    beginResize,
    endResize,
    nudgeWidth,
  };
}
