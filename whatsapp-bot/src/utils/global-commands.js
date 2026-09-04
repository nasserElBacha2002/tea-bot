function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

const GLOBAL_COMMANDS = {
  menu: new Set(['menu', 'menú', 'inicio', 'volver al menu', 'volver al menú']),
  back: new Set(['atras', 'atrás', 'volver atras', 'volver atrás']),
  human: new Set(['humano', 'persona', 'asesor', 'asesora', 'representante']),
};

const HUMAN_TOKEN = '(?:humano|persona|asesor|asesora|representante|alguien)';

/**
 * Pedidos explícitos de persona en frases libres.
 * No matchear un saludo o consulta que solo menciona "persona" de paso.
 */
const HUMAN_REQUEST_PATTERNS = [
  new RegExp(
    `\\b(?:quiero|necesito|busco)\\s+(?:hablar\\s+con\\s+)?(?:un|una|el|la)?\\s*${HUMAN_TOKEN}\\b`,
  ),
  new RegExp(`\\bhablar\\s+con\\s+(?:un|una|el|la)?\\s*${HUMAN_TOKEN}\\b`),
  new RegExp(
    `\\bpas(?:a|ame|ar(?:me)?)\\s+con\\s+(?:un|una|el|la)?\\s*${HUMAN_TOKEN}\\b`,
  ),
  /\batencion\s+humana\b/,
  new RegExp(
    `\\bderiv(?:a|ame|ar)\\s+(?:con|a)\\s+(?:un|una|el|la)?\\s*${HUMAN_TOKEN}\\b`,
  ),
];

const NORMALIZED_COMMAND_MAP = (() => {
  const map = new Map();
  for (const [type, aliases] of Object.entries(GLOBAL_COMMANDS)) {
    for (const alias of aliases) {
      map.set(normalizeText(alias), type);
    }
  }
  return map;
})();

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isExplicitHumanRequest(input) {
  const key = normalizeText(input);
  if (!key) return false;
  if (NORMALIZED_COMMAND_MAP.get(key) === 'human') return true;
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(key));
}

export function detectGlobalCommand(input) {
  const key = normalizeText(input);
  if (!key) return { type: null };
  const exact = NORMALIZED_COMMAND_MAP.get(key);
  if (exact) return { type: exact };
  if (isExplicitHumanRequest(key)) return { type: 'human' };
  return { type: null };
}

export { normalizeText as normalizeGlobalCommandInput };
