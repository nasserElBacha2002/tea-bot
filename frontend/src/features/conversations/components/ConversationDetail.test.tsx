// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationDetail } from './ConversationDetail';
import type { ConversationDetailResponse } from '../types/conversation.types';

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function detail(patch: Partial<ConversationDetailResponse['conversation']>): ConversationDetailResponse {
  return {
    conversation: {
      id: 'c1',
      channel: 'whatsapp',
      provider: 'twilio',
      phoneNumber: '+5491111111111',
      displayName: 'Ana',
      status: 'bot',
      assignedAgentId: null,
      currentFlowId: 'main-menu',
      currentFlowVersion: 'v62',
      currentNodeKey: 'welcome',
      lastMessageAt: '2026-11-10T15:00:00.000Z',
      startedAt: '2026-11-10T14:00:00.000Z',
      closedAt: null,
      ...patch,
    },
    activeSession: null,
    humanHandoff: null,
  };
}

function renderDetail(data: ConversationDetailResponse) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ConversationDetail
        detail={data}
        messages={[]}
        onSend={vi.fn()}
        onClaim={vi.fn()}
        onTakeover={vi.fn()}
        onClose={vi.fn()}
        onUpdateContact={vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe('ConversationDetail takeover', () => {
  it('con el bot activo y permiso muestra Tomar y no el cierre', () => {
    renderDetail(detail({ status: 'bot', canTakeover: true }));
    expect(screen.getByText('Bot activo')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /tomar conversación/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /cerrar y devolver al bot/i })).not.toBeInTheDocument();
  });

  it('durante la atención humana muestra el agente y la devolución al bot', () => {
    renderDetail(detail({
      status: 'assigned',
      assignedAgentId: 'agent-1',
      assignedAgentLabel: 'Ana',
      takeoverBlock: 'already_owner',
      canTakeover: false,
    }));
    expect(screen.getByText('Atención humana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar y devolver al bot/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/escribí una respuesta/i)).toBeInTheDocument();
  });

  it('una conversación en espera también puede devolverse al bot', () => {
    renderDetail(detail({ status: 'waiting_human', canTakeover: false }));
    expect(screen.getByRole('button', { name: /cerrar y devolver al bot/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /tomar conversación/i }).length).toBeGreaterThan(0);
  });
});
