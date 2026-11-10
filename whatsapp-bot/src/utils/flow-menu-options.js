import { normalizeFlowMatchText } from './flow-match-text.js';

const OPTION_LINE = /(?:^|\n)[ \t]*((?:[0-9]\uFE0F?\u20E3)|[0-9]{1,2})[ \t]+\*([^*\n]+)\*/g;

/**
 * Opciones numeradas visibles en el mensaje del nodo.
 * @param {string} message
 * @returns {{ digit: string, label: string }[]}
 */
export function parseEnumeratedMenuOptions(message) {
  if (typeof message !== 'string' || !message) return [];
  const options = [];
  const pattern = new RegExp(OPTION_LINE.source, 'g');
  let match = pattern.exec(message);
  while (match) {
    const digit = match[1].replace(/\uFE0F?\u20E3/g, '');
    const label = normalizeFlowMatchText(match[2]);
    if (digit && label) options.push({ digit, label });
    match = pattern.exec(message);
  }
  return options;
}

/**
 * @param {object | null | undefined} node
 * @param {Map<string, object>} exact
 */
export function indexEnumeratedLabels(node, exact) {
  const byLabel = new Map();
  const ambiguousLabels = new Set();
  for (const option of parseEnumeratedMenuOptions(node?.message)) {
    const transition = exact.get(option.digit);
    if (!transition || transition.type !== 'match' || transition.nextNode == null) continue;
    if (ambiguousLabels.has(option.label)) continue;
    const current = byLabel.get(option.label);
    if (!current) {
      byLabel.set(option.label, { ...option, transition });
      continue;
    }
    if (current.transition.nextNode !== transition.nextNode) {
      byLabel.delete(option.label);
      ambiguousLabels.add(option.label);
    }
  }
  return { byLabel, ambiguousLabels };
}

/**
 * @param {object} node
 * @param {number} count
 * @param {boolean} humanAvailable
 * @returns {string}
 */
export function formatUnmatchedMenuReply(node, count, humanAvailable) {
  const menu = String(node?.message || '').trim();
  const human = humanAvailable ? ', o *humano* para hablar con una persona' : '';
  const lead = count >= 2
    ? `Sigo sin encontrar esa respuesta entre las opciones.\n\nEscribí el número o el nombre de una opción, *menú* para volver al inicio${human}.`
    : `No reconocí esa respuesta como una opción de este menú.\n\nPodés escribir el número o el nombre de la opción. También *menú* para volver al inicio y *atrás* para el paso anterior${human}.`;
  return menu ? `${lead}\n\n${menu}` : lead;
}
