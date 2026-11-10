import { FlowFieldValidationError } from './flow-field-validation.js';

const KEYCAP = /([0-9])\uFE0F?\u20E3/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Forma canónica para comparar entradas con opciones.
 * No modifica el texto que se persiste.
 * NFKC, keycaps a dígitos, sin diacríticos, minúsculas y espacios colapsados.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFlowMatchText(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return normalizeFlowMatchText(String(value));
  }
  if (typeof value !== 'string') return '';
  const canonical = value
    .normalize('NFKC')
    .replace(KEYCAP, '$1')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return canonical;
}

/**
 * @param {unknown} value
 * @param {{ strict?: boolean, flowKey?: string, version?: string, nodeId?: string, path?: string }} [ctx]
 * @returns {string}
 */
export function transitionMatchKey(value, ctx = {}) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return normalizeFlowMatchText(String(value));
  }
  if (typeof value === 'string') return normalizeFlowMatchText(value);
  if (value == null || value === '') return '';
  if (ctx.strict) {
    throw new FlowFieldValidationError({
      flowKey: ctx.flowKey || 'unknown',
      version: ctx.version,
      nodeId: ctx.nodeId,
      path: ctx.path || 'transition.value',
      expectedType: 'string',
      value,
    });
  }
  return '';
}

/**
 * El needle tiene que aparecer como tokens completos, no dentro de otra palabra.
 * @param {string} input
 * @param {string} needle
 * @returns {boolean}
 */
export function includesAsTokens(input, needle) {
  if (!input || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(input);
}
