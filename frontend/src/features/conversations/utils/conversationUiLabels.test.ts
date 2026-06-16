import { describe, expect, it } from 'vitest';
import {
  formatListItemPrimary,
  formatListItemSecondary,
} from './conversationUiLabels';

describe('formatListItemPrimary/Secondary', () => {
  it('con nombre muestra nombre primero y teléfono secundario', () => {
    expect(formatListItemPrimary('+5491111111111', 'Juan Pérez')).toBe('Juan Pérez');
    expect(formatListItemSecondary('+5491111111111', 'Juan Pérez', 'WhatsApp')).toBe(
      '+5491111111111 · WhatsApp',
    );
  });

  it('sin nombre usa teléfono como título', () => {
    expect(formatListItemPrimary('+5491111111111', null)).toBe('+5491111111111');
    expect(formatListItemSecondary('+5491111111111', null, 'WhatsApp')).toBe('WhatsApp');
  });
});
