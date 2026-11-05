import { HUMAN_NODE_IDS } from './handoff-detection.js';
import { normalizeGlobalCommandInput, detectGlobalCommand } from './global-commands.js';

const UNSAFE_RESUME_NODES = new Set([...HUMAN_NODE_IDS, 'fallback_global', 'fallback']);

export const RETURN_TO_BOT_EVENT = 'conversation_returned_to_bot';

export const RETURN_TO_BOT_BODY =
  'Conversación cerrada por el equipo. El bot retomará la atención.';

/** El fallback del cursor viejo no es un paso del flujo. */
const LEGACY_PARKED_NODE_KEYS = new Set(['fallback_global', 'fallback']);

/**
 * Outbound posteriores al cierre humano. Un nodo real, o un mensaje de agente,
 * significa que el hilo ya siguió. Esos casos no se rearman.
 * @param {object[] | null | undefined} outboundMessages
 */
export function hasFlowProgressAfterReturn(outboundMessages) {
  if (!Array.isArray(outboundMessages)) return false;
  for (const message of outboundMessages) {
    if (!message || message.direction === 'inbound') continue;
    if (message.senderType === 'agent') return true;
    if (message.senderType !== 'bot') continue;
    const nodeKey = String(message.metadataJson?.nodeKey || '').trim();
    if (!nodeKey || LEGACY_PARKED_NODE_KEYS.has(nodeKey)) continue;
    return true;
  }
  return false;
}

/** Respuestas inválidas persistidas antes de salir de awaiting_choice. */
export const MAX_INVALID_REENTRY_ATTEMPTS = 3;

/** unknown: tests y proceso aún no probeado. missing: código nuevo sin la columna. */
let reentryColumnState = 'unknown';

export function noteReentryColumn(present) {
  if (present == null) reentryColumnState = 'unknown';
  else reentryColumnState = present ? 'ready' : 'missing';
}

export function getReentryColumnState() {
  return reentryColumnState;
}

const CONTINUE_INPUTS = new Set([
  '1',
  'si',
  'continuar',
  'seguir',
  'anterior',
  'retomar',
]);

const FRESH_INPUTS = new Set([
  '2',
  'no',
  'nueva',
  'nuevo',
  'empezar',
  'comenzar',
  'reiniciar',
  'nueva consulta',
  'consulta nueva',
]);

export const REENTRY_PROMPT = [
  '¿Seguimos con tu consulta anterior o preferís empezar una nueva?',
  '',
  '1. Continuar',
  '2. Nueva consulta',
  '',
  'También podés escribir *menú* o pedir hablar con una persona.',
].join('\n');

/**
 * `legacy` restaura el cursor de cierre anterior.
 * `degraded` solo cuando falta la columna: el cierre deja el nodo en null y no escribe reentry_json.
 * Cualquier otro valor, incluido el default, usa el prompt de reentrada.
 */
export function resolveReentryPolicy() {
  const raw = String(process.env.REENTRY_POLICY ?? 'prompt').trim().toLowerCase();
  if (raw === 'legacy') return 'legacy';
  if (reentryColumnState === 'missing') return 'degraded';
  return 'prompt';
}

export function normalizeFlowVersion(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('v') ? raw.slice(1) : raw;
}

function transitionContract(transition) {
  if (!transition || typeof transition !== 'object') return null;
  return {
    type: transition.type || null,
    value: transition.value === undefined ? null : transition.value,
    next: transition.nextNode || transition.nextNodeKey || transition.to || null,
  };
}

/** Contrato del nodo que el motor va a ejecutar. No incluye la versión. */
export function nodeResumeContract(node) {
  if (!node || typeof node !== 'object') return null;
  const message = typeof node.message === 'string' ? node.message.trim() : '';
  if (!message) return null;
  const transitions = Array.isArray(node.transitions)
    ? node.transitions.map(transitionContract).filter(Boolean)
    : [];
  return JSON.stringify({ id: String(node.id || ''), message, transitions });
}

/**
 * No reanuda una versión histórica dentro del motor publicado.
 * Misma versión: restaurar el nodo publicado.
 * Otra versión con el mismo contrato: migrar explícitamente al publicado.
 * Nodo ausente, modificado o versión no verificable: reinicio seguro.
 */
export function decideResumeCompatibility({
  snapshotVersion,
  publishedVersion,
  publishedNode,
  historicalNode = null,
  historicalLoaded = false,
}) {
  if (!nodeResumeContract(publishedNode)) {
    return { decision: 'restart', reason: 'node_removed' };
  }
  const snapshot = normalizeFlowVersion(snapshotVersion);
  const published = normalizeFlowVersion(publishedVersion);
  if (!snapshot) {
    return { decision: 'restart', reason: 'version_unknown' };
  }
  if (snapshot === published) {
    return { decision: 'restore', reason: 'same_version' };
  }
  if (!historicalLoaded) {
    return { decision: 'restart', reason: 'historical_unavailable' };
  }
  if (!nodeResumeContract(historicalNode)) {
    return { decision: 'restart', reason: 'historical_node_missing' };
  }
  if (nodeResumeContract(historicalNode) !== nodeResumeContract(publishedNode)) {
    return { decision: 'restart', reason: 'node_modified' };
  }
  return { decision: 'migrate', reason: 'migrated_published' };
}

export function isSafeResumeNode(nodeKey) {
  const key = String(nodeKey || '').trim();
  return key.length > 0 && !UNSAFE_RESUME_NODES.has(key);
}

function lastSafeNode(list) {
  if (!Array.isArray(list)) return null;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    const key = typeof item === 'string' ? item : '';
    if (isSafeResumeNode(key)) return key.trim();
  }
  return null;
}

function resumeNodeFromTrail(trail) {
  if (!Array.isArray(trail)) return null;
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const step = trail[index];
    if (!step || typeof step !== 'object') continue;
    if (isSafeResumeNode(step.to)) return String(step.to).trim();
    if (isSafeResumeNode(step.from)) return String(step.from).trim();
  }
  return null;
}

function capList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(-max);
}

function copyObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

/**
 * Nodo de flujo al que se puede volver. Ignora handoff y fallback.
 * @param {object | null | undefined} memorySession
 * @param {object | null | undefined} openSession
 */
export function pickResumeNode(memorySession, openSession) {
  const memoryNode = isSafeResumeNode(memorySession?.currentNode)
    ? String(memorySession.currentNode).trim()
    : null;
  const sessionNode = isSafeResumeNode(openSession?.currentNodeKey)
    ? String(openSession.currentNodeKey).trim()
    : null;

  return (
    resumeNodeFromTrail(memorySession?.transitionTrail)
    || lastSafeNode(memorySession?.history)
    || lastSafeNode(memorySession?.visitedNodes)
    || memoryNode
    || resumeNodeFromTrail(openSession?.trackingJson?.transitionTrail)
    || lastSafeNode(openSession?.historyJson)
    || lastSafeNode(openSession?.trackingJson?.visitedNodes)
    || sessionNode
    || null
  );
}

/**
 * Snapshot persistido en conversations.reentry_json al cerrar una atención humana.
 */
export function buildReentrySnapshot({
  conversation,
  openSession = null,
  memorySession = null,
  capturedAt = new Date().toISOString(),
} = {}) {
  const tracking = openSession?.trackingJson && typeof openSession.trackingJson === 'object'
    ? openSession.trackingJson
    : {};

  return {
    v: 1,
    status: 'pending',
    flowId: memorySession?.flowId || openSession?.flowId || conversation?.currentFlowId || null,
    flowVersion:
      memorySession?.flowVersion
      || openSession?.flowVersion
      || conversation?.currentFlowVersion
      || null,
    resumeNodeKey: pickResumeNode(memorySession, openSession),
    variables: copyObject(memorySession?.variables || openSession?.variablesJson),
    history: capList(memorySession?.history || openSession?.historyJson),
    tracking: {
      answers: copyObject(memorySession?.answers || tracking.answers),
      visitedNodes: capList(memorySession?.visitedNodes || tracking.visitedNodes),
      transitionTrail: capList(memorySession?.transitionTrail || tracking.transitionTrail),
    },
    sourceSessionId: openSession?.id || null,
    capturedAt,
  };
}

function stripKeycapDigits(text) {
  return String(text || '').replace(/([0-9])\uFE0F?\u20E3/g, '$1');
}

/**
 * El primer texto (status pending) no se interpreta como elección,
 * salvo un comando global de menú o de persona.
 *
 * @param {string} text
 * @param {'pending' | 'awaiting_choice'} phase
 * @returns {'present' | 'continue' | 'fresh' | 'human' | 'reprompt'}
 */
export function classifyReentryInput(text, phase) {
  const normalizedText = stripKeycapDigits(text);
  const globalCommand = detectGlobalCommand(normalizedText);
  if (globalCommand.type === 'human') return 'human';
  if (globalCommand.type === 'menu') return 'fresh';
  if (phase !== 'awaiting_choice') return 'present';
  if (globalCommand.type === 'back') return 'continue';

  const key = normalizeGlobalCommandInput(normalizedText);
  if (CONTINUE_INPUTS.has(key)) return 'continue';
  if (FRESH_INPUTS.has(key)) return 'fresh';
  return 'reprompt';
}
