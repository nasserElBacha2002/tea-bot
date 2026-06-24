import flowValidator from '../utils/flow-validator.js';
import { compileFlow } from '../utils/compile-flow.js';
import { validateTransitionValueForPublish } from '../utils/flow-transition-value.js';
import { buildFlowDocumentFromTables } from '../utils/flow-snapshot-builder.js';
import flowCatalogRepository from '../repositories/flow-catalog.repository.js';

const HANDOFF_NODE_KEYS = new Set(['human_handoff', 'humano', 'asesor', 'representante']);
const TERMINAL_TYPES = new Set(['end', 'redirect']);

function buildTransitionsMap(nodes, transitions) {
  const byKey = new Map(nodes.map((n) => [n.nodeKey, []]));
  for (const t of transitions) {
    const list = byKey.get(t.sourceNodeKey) || [];
    list.push(t);
    byKey.set(t.sourceNodeKey, list);
  }
  return byKey;
}

function collectReachable(entryKey, byKey) {
  const visited = new Set();
  const queue = [entryKey];
  while (queue.length) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const transitions = byKey.get(key) || [];
    for (const t of transitions) {
      if (t.nextNodeKey && !visited.has(t.nextNodeKey)) queue.push(t.nextNodeKey);
    }
  }
  return visited;
}

function detectCycles(entryKey, byKey) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function dfs(nodeKey, path) {
    if (!nodeKey) return;
    if (visiting.has(nodeKey)) {
      cycles.push([...path, nodeKey]);
      return;
    }
    if (visited.has(nodeKey)) return;
    visiting.add(nodeKey);
    const transitions = byKey.get(nodeKey) || [];
    for (const t of transitions) {
      dfs(t.nextNodeKey, [...path, nodeKey]);
    }
    visiting.delete(nodeKey);
    visited.add(nodeKey);
  }

  dfs(entryKey, []);
  return cycles;
}

class FlowValidationManagementService {
  async validateVersion(versionId) {
    const graph = await flowCatalogRepository.getVersionGraph(versionId);
    if (!graph) {
      return { valid: false, errors: [{ code: 'FLOW_VERSION_NOT_FOUND', message: 'Versión no encontrada.' }], warnings: [] };
    }

    const { flow, version, nodes, transitions } = graph;
    const errors = [];
    const warnings = [];
    const nodeKeys = new Set(nodes.map((n) => n.nodeKey));
    const byKey = buildTransitionsMap(nodes, transitions);

    if (!version.entryNodeKey || !nodeKeys.has(version.entryNodeKey)) {
      errors.push({
        code: 'FLOW_ENTRY_NODE_MISSING',
        message: 'El nodo de entrada no existe.',
        nodeKey: version.entryNodeKey,
      });
    }

    if (version.fallbackNodeKey && !nodeKeys.has(version.fallbackNodeKey)) {
      errors.push({
        code: 'FLOW_FALLBACK_NODE_MISSING',
        message: 'El nodo fallback no existe.',
        nodeKey: version.fallbackNodeKey,
      });
    }

    const seen = new Set();
    for (const node of nodes) {
      if (seen.has(node.nodeKey)) {
        errors.push({
          code: 'FLOW_NODE_KEY_DUPLICATED',
          message: 'Clave de nodo duplicada.',
          nodeKey: node.nodeKey,
        });
      }
      seen.add(node.nodeKey);

      if (!flowValidator.supportedTypes.includes(node.type)) {
        errors.push({
          code: 'FLOW_NODE_TYPE_UNSUPPORTED',
          message: `Tipo de nodo no soportado: ${node.type}`,
          nodeKey: node.nodeKey,
        });
      }

      if (
        ['message', 'capture'].includes(node.type) &&
        (!node.message || !String(node.message).trim())
      ) {
        errors.push({
          code: 'FLOW_EMPTY_MESSAGE',
          message: 'El nodo requiere un mensaje.',
          nodeKey: node.nodeKey,
        });
      }

      if (
        (HANDOFF_NODE_KEYS.has(node.nodeKey) || node.metadataJson?.requiresHuman) &&
        (!node.message || !String(node.message).trim())
      ) {
        warnings.push({
          code: 'FLOW_HUMAN_HANDOFF_WITHOUT_MESSAGE',
          message: 'Nodo de derivación sin mensaje; se usará texto por defecto.',
          nodeKey: node.nodeKey,
        });
      }
    }

    for (const trans of transitions) {
      if (!nodeKeys.has(trans.nextNodeKey)) {
        errors.push({
          code: 'FLOW_TRANSITION_TARGET_MISSING',
          message: 'Una transición apunta a un nodo que no existe.',
          nodeKey: trans.sourceNodeKey,
          nextNodeKey: trans.nextNodeKey,
        });
      }
      if (trans.type !== 'implicit_next' && !flowValidator.supportedTransitions.includes(trans.type)) {
        errors.push({
          code: 'FLOW_TRANSITION_TYPE_UNSUPPORTED',
          message: `Tipo de transición no soportado: ${trans.type}`,
          nodeKey: trans.sourceNodeKey,
        });
      }
      if (trans.value !== undefined && trans.value !== null) {
        try {
          validateTransitionValueForPublish(trans.type, trans.value, {
            flowKey: flow.flowKey,
            version: version.versionLabel,
            nodeId: trans.sourceNodeKey,
            path: `nodes.${trans.sourceNodeKey}.transitions[].value`,
          });
        } catch (err) {
          errors.push({
            code: 'FLOW_TRANSITION_VALUE_INVALID',
            message: err.message,
            nodeKey: trans.sourceNodeKey,
          });
        }
      }
    }

    if (version.entryNodeKey && nodeKeys.has(version.entryNodeKey)) {
      const reachable = collectReachable(version.entryNodeKey, byKey);
      for (const node of nodes) {
        if (!reachable.has(node.nodeKey)) {
          warnings.push({
            code: 'FLOW_UNREACHABLE_NODE',
            message: 'El nodo existe pero no es alcanzable desde el nodo de entrada.',
            nodeKey: node.nodeKey,
          });
        }
      }

      const cycles = detectCycles(version.entryNodeKey, byKey);
      if (cycles.length > 0) {
        warnings.push({
          code: 'FLOW_CYCLE_DETECTED',
          message: 'Se detectaron ciclos en el grafo (puede ser intencional en menús).',
          path: cycles[0],
        });
      }
    }

    for (const node of nodes) {
      const nodeTransitions = byKey.get(node.nodeKey) || [];
      const hasOutgoing =
        nodeTransitions.length > 0 ||
        node.metadataJson?.nextNode ||
        TERMINAL_TYPES.has(node.type) ||
        HANDOFF_NODE_KEYS.has(node.nodeKey);
      if (['message', 'capture'].includes(node.type) && !hasOutgoing) {
        warnings.push({
          code: 'FLOW_NO_TRANSITIONS',
          message: 'Nodo sin transiciones de salida.',
          nodeKey: node.nodeKey,
        });
      }
    }

    if (errors.length === 0) {
      try {
        const doc = buildFlowDocumentFromTables(flow, version, nodes, byKey);
        flowValidator.validate(doc);
        compileFlow(doc);
      } catch (err) {
        errors.push({
          code: 'FLOW_VALIDATION_ENGINE',
          message: err.message,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

const flowValidationManagementService = new FlowValidationManagementService();
export default flowValidationManagementService;
