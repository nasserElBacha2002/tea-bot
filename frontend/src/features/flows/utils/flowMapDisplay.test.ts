import { describe, expect, it } from 'vitest';
import type { FlowNode } from '../types/flow.types';
import {
  formatTransitionSummary,
  getNodeDisplayTitle,
  getNodeMessagePreview,
  groupTransitionsByTarget,
  humanizeNodeId,
  looksLikeRawTechnicalId,
  prepareMessageForPreview,
} from './flowMapDisplay';

const nodeWithMessage: FlowNode = {
  id: 'archivo_info',
  type: 'message',
  message:
    '**Información solicitada**\n\nDebés contactarte por mail a archivo@teaydeportea.edu.ar.\n\n¿Necesitás algo más?\n\n1 Sí\n2 No',
  transitions: [
    { type: 'match', value: 'sí', nextNode: 'welcome' },
    { type: 'match', value: 'si', nextNode: 'welcome' },
    { type: 'match', value: 'menú', nextNode: 'welcome' },
    { type: 'match', value: 'inicio', nextNode: 'welcome' },
  ],
  ui: { position: { x: 0, y: 0 }, stepTitle: 'Archivo info' },
};

describe('flowMapDisplay', () => {
  it('getNodeDisplayTitle prioriza nombre manual', () => {
    expect(getNodeDisplayTitle(nodeWithMessage)).toBe('Archivo info');
  });

  it('humanizeNodeId limpia ids con guiones bajos', () => {
    expect(humanizeNodeId('si_pd_admin_a')).toBe('Si pd admin a');
  });

  it('looksLikeRawTechnicalId detecta ids internos', () => {
    expect(looksLikeRawTechnicalId('node_message_34')).toBe(true);
    expect(looksLikeRawTechnicalId('archivo_info')).toBe(false);
  });

  it('prepareMessageForPreview quita markdown fuerte', () => {
    const t = prepareMessageForPreview('**Hola** mundo');
    expect(t).toBe('Hola mundo');
  });

  it('getNodeMessagePreview trunca mensajes largos', () => {
    const long = 'a'.repeat(400);
    const preview = getNodeMessagePreview({ ...nodeWithMessage, message: long }, 3, 50);
    expect(preview.truncated).toBe(true);
    expect(preview.lines.join('').length).toBeLessThanOrEqual(60);
  });

  it('getNodeMessagePreview muestra líneas del mensaje como contenido principal', () => {
    const preview = getNodeMessagePreview(nodeWithMessage, 5, 300);
    expect(preview.lines[0]).toContain('Información solicitada');
    expect(preview.lines.some((l) => l.includes('mail'))).toBe(true);
  });

  it('groupTransitionsByTarget agrupa por destino', () => {
    const groups = groupTransitionsByTarget(nodeWithMessage);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(4);
    expect(groups[0]!.target).toBe('welcome');
    expect(groups[0]!.preview).toContain('sí');
  });

  it('formatTransitionSummary resume múltiples respuestas', () => {
    const groups = groupTransitionsByTarget(nodeWithMessage);
    expect(formatTransitionSummary(groups[0]!, 'edge')).toContain('4 respuestas');
    expect(formatTransitionSummary(groups[0]!, 'edge')).toMatch(/welcome/i);
  });

  it('vista mensaje no usa id técnico como título si hay stepTitle', () => {
    const titled = getNodeDisplayTitle({
      id: 'node_message_34',
      type: 'message',
      ui: { position: { x: 0, y: 0 }, stepTitle: 'Menú' },
    });
    expect(titled).toBe('Menú');
    expect(titled).not.toBe('node_message_34');
  });
});
