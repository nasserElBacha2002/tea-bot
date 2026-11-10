// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ConversationComposer } from './ConversationComposer';

describe('ConversationComposer', () => {
  it('waiting_human muestra Tomar conversación y composer', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="waiting_human" onSend={vi.fn()} onClaim={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: /tomar conversación/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/escribí una respuesta/i)).toBeInTheDocument();
  });

  it('assigned muestra composer y envía mensaje', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="assigned" onSend={onSend} />
      </ThemeProvider>,
    );
    const input = screen.getByPlaceholderText(/escribí una respuesta/i);
    await user.type(input, 'Hola desde el equipo');
    await user.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(onSend).toHaveBeenCalledWith('Hola desde el equipo');
  });

  it('un agente que no es el dueño no puede responder', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="assigned"
          assignedAgentId="agent-ana"
          currentAgentId="agent-luis"
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(/otro agente/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/escribí una respuesta/i)).not.toBeInTheDocument();
  });

  it('con la toma apagada el inbox compartido sigue pudiendo responder', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="assigned"
          takeoverBlock="disabled"
          assignedAgentId="agent-ana"
          currentAgentId="agent-luis"
          onSend={onSend}
        />
      </ThemeProvider>,
    );
    const input = screen.getByPlaceholderText(/escribí una respuesta/i);
    await user.type(input, 'Continúo la atención');
    await user.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(onSend).toHaveBeenCalledWith('Continúo la atención');
  });

  it('closed muestra mensaje de no responder', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="closed" onSend={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/conversación cerrada/i)).toBeInTheDocument();
  });

  it('bot activo no permite responder', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer status="bot" onSend={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/La respuesta manual se habilitará al derivar a humano/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tomar conversación/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/escribí una respuesta/i)).not.toBeInTheDocument();
  });

  it('bot con permiso muestra Tomar y no habilita el composer', async () => {
    const user = userEvent.setup();
    const onTakeover = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="bot"
          canTakeover
          onSend={vi.fn()}
          onTakeover={onTakeover}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(/puede tomarse manualmente/i)).toBeInTheDocument();
    expect(screen.queryByText(/se habilitará al derivar a humano/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/escribí una respuesta/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tomar conversación/i }));
    expect(onTakeover).toHaveBeenCalledOnce();
  });

  it('muestra el conflicto si otro agente ya la tiene y no habilita el composer', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="assigned"
          takeoverBlock="owned_by_other"
          assignedAgentLabel="Ana"
          actionError="La conversación ya está asignada a otro agente."
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(/atención humana/i)).toBeInTheDocument();
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/otro agente/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/escribí una respuesta/i)).not.toBeInTheDocument();
  });

  it('asignada al agente muestra atención humana y el composer', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ConversationComposer
          status="assigned"
          takeoverBlock="already_owner"
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText(/atención humana/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/escribí una respuesta/i)).toBeInTheDocument();
  });
});
