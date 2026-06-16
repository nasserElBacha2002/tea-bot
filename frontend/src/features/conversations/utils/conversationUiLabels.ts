import type { ConversationStatus } from '../types/conversation.types';

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus | 'all', string> = {
  all: 'Todas',
  bot: 'Bot activo',
  waiting_human: 'Esperando humano',
  assigned: 'Asignadas',
  closed: 'Cerradas',
  paused: 'Pausadas',
};

export function conversationStatusLabel(status: string): string {
  return CONVERSATION_STATUS_LABELS[status as ConversationStatus] ?? status;
}

export const CHANNEL_FILTER_LABELS = {
  all: 'Todos',
  whatsapp: 'WhatsApp',
  simulator: 'Simulador',
} as const;

/** @deprecated Usar constants/conversationChannels.ts */

export function formatConversationTitle(
  phoneNumber: string | null,
  displayName: string | null,
): string {
  if (displayName?.trim()) return displayName.trim();
  if (phoneNumber?.trim()) return phoneNumber;
  return 'Sin identificar';
}

export function formatListItemPrimary(
  phoneNumber: string | null,
  displayName: string | null,
): string {
  return formatConversationTitle(phoneNumber, displayName);
}

export function formatListItemSecondary(
  phoneNumber: string | null,
  displayName: string | null,
  channelLabelText: string,
): string {
  const name = displayName?.trim();
  const phone = phoneNumber?.trim();
  if (name && phone) return `${phone} · ${channelLabelText}`;
  return channelLabelText;
}

export function senderTypeLabel(senderType: string): string {
  switch (senderType) {
    case 'user':
      return 'Usuario';
    case 'bot':
      return 'Bot';
    case 'agent':
      return 'Agente';
    case 'system':
      return 'Sistema';
    default:
      return senderType;
  }
}

export function handoffStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'assigned':
      return 'Asignada';
    case 'resolved':
      return 'Resuelta';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status;
  }
}
