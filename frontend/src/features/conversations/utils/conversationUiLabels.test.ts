// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  conversationStatusLabel,
  formatConversationTitle,
  senderTypeLabel,
} from './conversationUiLabels';

describe('conversationUiLabels', () => {
  it('usa etiquetas en español para estados', () => {
    expect(conversationStatusLabel('waiting_human')).toBe('Esperando humano');
    expect(conversationStatusLabel('bot')).toBe('Bot activo');
  });

  it('formatea titulo con telefono o nombre', () => {
    expect(formatConversationTitle('+54911', null)).toBe('+54911');
    expect(formatConversationTitle(null, 'María')).toBe('María');
    expect(formatConversationTitle(null, null)).toBe('Sin identificar');
  });

  it('traduce sender types', () => {
    expect(senderTypeLabel('user')).toBe('Usuario');
    expect(senderTypeLabel('bot')).toBe('Bot');
  });
});
