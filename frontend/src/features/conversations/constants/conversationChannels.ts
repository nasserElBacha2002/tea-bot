import type { ConversationChannel } from '../types/conversation.types';

export const CHANNEL_WHATSAPP = 'whatsapp' as const;
export const CHANNEL_SIMULATOR = 'simulator' as const;

export const CONVERSATION_CHANNELS = [CHANNEL_WHATSAPP, CHANNEL_SIMULATOR] as const;

export const DEFAULT_CONVERSATION_CHANNEL: ConversationChannel = CHANNEL_WHATSAPP;

/** Valor del selector para "todos los canales" (elección explícita del usuario). */
export const CHANNEL_FILTER_ALL = '' as const;

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  whatsapp: 'WhatsApp',
  simulator: 'Simulador',
};

export const CHANNEL_FILTER_LABELS: Record<ConversationChannel | 'all', string> = {
  all: 'Todos los canales',
  whatsapp: 'WhatsApp',
  simulator: 'Simulador',
};

/** Valor mostrado en el Select del inbox (vacío solo si el usuario eligió "todos"). */
export function resolveChannelFilterValue(
  channel: ConversationChannel | '' | undefined,
): ConversationChannel | typeof CHANNEL_FILTER_ALL {
  if (channel === CHANNEL_FILTER_ALL) return CHANNEL_FILTER_ALL;
  return channel ?? DEFAULT_CONVERSATION_CHANNEL;
}

/** Parámetro enviado al API: sin filtro solo cuando el usuario eligió "todos". */
export function resolveChannelForApi(
  channel: ConversationChannel | '' | undefined,
): ConversationChannel | undefined {
  const resolved = resolveChannelFilterValue(channel);
  if (resolved === CHANNEL_FILTER_ALL) return undefined;
  return resolved;
}

export function channelFilterLabel(
  channel: ConversationChannel | typeof CHANNEL_FILTER_ALL,
): string {
  if (channel === CHANNEL_FILTER_ALL) return CHANNEL_FILTER_LABELS.all;
  return CHANNEL_FILTER_LABELS[channel];
}
