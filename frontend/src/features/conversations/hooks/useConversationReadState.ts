import { useCallback, useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'tea:conversation-read:v1:';

function storageKey(agentId: string) {
  return `${PREFIX}${agentId || 'default'}`;
}

function loadMap(agentId: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(agentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveMap(agentId: string, map: Record<string, string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(agentId), JSON.stringify(map));
}

let listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notify() {
  listeners.forEach((l) => l());
}

export function useConversationReadState(agentId: string | null) {
  const key = agentId ?? 'default';

  const serialized = useSyncExternalStore(
    subscribe,
    () => {
      if (typeof window === 'undefined') return '{}';
      return localStorage.getItem(storageKey(key)) ?? '{}';
    },
    () => '{}',
  );

  const readMap = useMemo(() => {
    try {
      const parsed = JSON.parse(serialized) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [serialized]);

  const markRead = useCallback(
    (conversationId: string, readThroughAt?: string) => {
      const map = loadMap(key);
      const at = readThroughAt ?? new Date().toISOString();
      const prev = map[conversationId];
      if (prev && new Date(prev).getTime() >= new Date(at).getTime()) return;
      map[conversationId] = at;
      saveMap(key, map);
      notify();
    },
    [key],
  );

  const getReadAt = useCallback(
    (conversationId: string) => readMap[conversationId] ?? null,
    [readMap],
  );

  return useMemo(
    () => ({ markRead, getReadAt, readMap }),
    [markRead, getReadAt, readMap],
  );
}
