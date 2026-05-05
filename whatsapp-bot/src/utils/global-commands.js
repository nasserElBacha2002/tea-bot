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

const NORMALIZED_COMMAND_MAP = (() => {
  const map = new Map();
  for (const [type, aliases] of Object.entries(GLOBAL_COMMANDS)) {
    for (const alias of aliases) {
      map.set(normalizeText(alias), type);
    }
  }
  return map;
})();

export function detectGlobalCommand(input) {
  const key = normalizeText(input);
  if (!key) return { type: null };
  return { type: NORMALIZED_COMMAND_MAP.get(key) || null };
}

export { normalizeText as normalizeGlobalCommandInput };
