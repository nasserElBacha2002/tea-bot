import type { ConversationChannel, ConversationProvider } from '../types/conversation.types';
import { conversationStatusLabel } from './conversationUiLabels';

const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  whatsapp: 'WhatsApp',
  simulator: 'Simulador',
};

const PROVIDER_LABELS: Record<ConversationProvider, string> = {
  twilio: 'Twilio',
  internal: 'Canal interno',
};

export function channelLabel(channel: ConversationChannel): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export function providerLabel(provider: ConversationProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function formatDetailSubtitle(
  channel: ConversationChannel,
  provider: ConversationProvider,
  status: string,
  lastMessageAt: string | null,
): string {
  const time = formatShortDateTime(lastMessageAt);
  return `${channelLabel(channel)} · ${providerLabel(provider)} · ${conversationStatusLabel(status)}${time ? ` · ${time}` : ''}`;
}

export function formatShortDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatAssignmentLabel(
  assignedAgentId: string | null,
  currentAgentId: string | null | undefined,
): string | null {
  if (!assignedAgentId) return null;
  if (currentAgentId && assignedAgentId === currentAgentId) return 'Asignada a vos';
  return 'Asignada a otro agente';
}

export function handoffReasonHumanText(reason: string | null | undefined): string | null {
  if (!reason?.trim()) return null;
  switch (reason) {
    case 'human_handoff':
      return 'El usuario pidió hablar con una persona.';
    default:
      return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function lastMessagePreviewPrefix(
  direction: 'inbound' | 'outbound' | undefined,
  senderType: string | undefined,
): string {
  if (direction === 'outbound' && (senderType === 'agent' || senderType === 'bot')) {
    return 'Tú: ';
  }
  return '';
}
