import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVERSATION_CHANNEL,
  resolveChannelFilterValue,
  resolveChannelForApi,
} from './conversationChannels';

describe('conversationChannels', () => {
  it('resolveChannelFilterValue usa WhatsApp cuando no hay canal', () => {
    expect(resolveChannelFilterValue(undefined)).toBe(DEFAULT_CONVERSATION_CHANNEL);
  });

  it('resolveChannelFilterValue respeta todos los canales', () => {
    expect(resolveChannelFilterValue('')).toBe('');
  });

  it('resolveChannelForApi envía whatsapp por defecto al API', () => {
    expect(resolveChannelForApi(undefined)).toBe('whatsapp');
  });

  it('resolveChannelForApi no filtra cuando el usuario eligió todos', () => {
    expect(resolveChannelForApi('')).toBeUndefined();
  });
});
