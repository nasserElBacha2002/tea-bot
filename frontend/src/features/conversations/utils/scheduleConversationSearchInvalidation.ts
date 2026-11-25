import type { QueryClient } from '@tanstack/react-query';

const DEBOUNCE_MS = 700;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce WS-driven global search refetches to avoid rate-limit storms. */
export function scheduleConversationSearchInvalidation(queryClient: QueryClient) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void queryClient.invalidateQueries({
      queryKey: ['conversations', 'search', 'global'],
      refetchType: 'active',
    });
  }, DEBOUNCE_MS);
}

export function resetConversationSearchInvalidationForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
}