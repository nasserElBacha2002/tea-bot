/** @typedef {'whatsapp' | 'simulator'} ConversationChannel */

export const CHANNEL_WHATSAPP = 'whatsapp';
export const CHANNEL_SIMULATOR = 'simulator';

/** @type {readonly ConversationChannel[]} */
export const CONVERSATION_CHANNELS = Object.freeze([CHANNEL_WHATSAPP, CHANNEL_SIMULATOR]);

/** @type {ConversationChannel} */
export const DEFAULT_CONVERSATION_CHANNEL = CHANNEL_WHATSAPP;

export const CHANNEL_LABELS = Object.freeze({
  [CHANNEL_WHATSAPP]: 'WhatsApp',
  [CHANNEL_SIMULATOR]: 'Simulador',
});
