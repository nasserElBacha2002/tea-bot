// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationLiveProvider } from './ConversationLiveProvider';
import * as liveHook from '../hooks/useConversationsLiveUpdates';

vi.mock('../../auth/context/AuthContext', () => ({
  useAuthUser: () => ({ username: 'admin', role: 'admin' }),
}));

vi.mock('../../auth/api/authApi', () => ({
  authApi: {
    me: vi.fn().mockResolvedValue({
      ok: true,
      user: { username: 'admin', agentId: 'agent-1', role: 'admin' },
    }),
  },
}));

const useConversationsLiveUpdatesMock = vi.spyOn(liveHook, 'useConversationsLiveUpdates');

describe('ConversationLiveProvider', () => {
  it('habilita live updates solo para usuarios con acceso a conversaciones', () => {
    useConversationsLiveUpdatesMock.mockReturnValue({
      status: 'live',
      markManual: vi.fn(),
      reconnect: vi.fn(),
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ConversationLiveProvider>
          <div>child</div>
        </ConversationLiveProvider>
      </QueryClientProvider>,
    );

    expect(useConversationsLiveUpdatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });
});
