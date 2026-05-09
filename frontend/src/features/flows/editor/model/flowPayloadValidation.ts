/**
 * Validación del JSON de flujo alineada con `whatsapp-bot/src/utils/flow-validator.js`.
 * Detecta errores que el backend rechazaría con 400 antes del PUT.
 */

import type { Flow, FlowNode, FlowTransition } from '../../types/flow.types';
import type { ConversationValidationIssue } from './conversationValidation';

const SUPPORTED_TYPES = new Set(['message', 'capture', 'redirect', 'end']);
const SUPPORTED_TRANSITIONS = new Set(['match', 'matchAny', 'matchIncludes', 'default']);

function anchorStepId(nodes: FlowNode[]): string {
  return nodes[0]?.id ?? '';
}

function withDefaultSchemaVersion(flow: Flow): Flow & { schemaVersion: number } {
  const raw = flow as Flow & { schemaVersion?: number };
  const sv = raw.schemaVersion;
  const schemaVersion = Number.isInteger(sv) ? sv! : 1;
  return { ...flow, schemaVersion };
}

/**
 * Igual que `flowValidator.validate` del backend sobre el objeto enviado / persistido.
 */
export function validateFlowPayload(flow: Flow): ConversationValidationIssue[] {
  const issues: ConversationValidationIssue[] = [];
  const { id, entryNode, fallbackNode, nodes } = flow;
  const sid = anchorStepId(nodes ?? []);

  if (!id?.trim()) {
    issues.push({
      code: 'PAYLOAD_FLOW_ID_MISSING',
      message: 'El borrador no tiene un identificador de flujo válido.',
      stepInternalId: sid,
    });
    return issues;
  }

  if (!entryNode?.trim()) {
    issues.push({
      code: 'ENTRY_STEP_MISSING',
      message: 'Falta el inicio de la conversación. Revisa la configuración en la vista clásica.',
      stepInternalId: entryNode || sid,
    });
  }

  const requireFallback = Boolean((flow as Flow & { requireFallback?: boolean }).requireFallback);
  if (requireFallback && !fallbackNode?.trim()) {
    issues.push({
      code: 'FALLBACK_STEP_MISSING',
      message: 'Falta el paso de respaldo. Revisa la configuración en la vista clásica.',
      stepInternalId: fallbackNode || sid,
    });
  }

  if (!Array.isArray(nodes)) {
    issues.push({
      code: 'PAYLOAD_NODES_INVALID',
      message: `El flujo "${id}" debe tener "nodes" como lista.`,
      stepInternalId: sid,
    });
    return issues;
  }

  if (nodes.length === 0) {
    issues.push({
      code: 'PAYLOAD_NODES_EMPTY',
      message: `El flujo "${id}" debe tener al menos un paso.`,
      stepInternalId: sid,
    });
    return issues;
  }

  const normalized = withDefaultSchemaVersion(flow);
  const { schemaVersion } = normalized;
  if (schemaVersion != null && (!Number.isInteger(schemaVersion) || schemaVersion < 1)) {
    issues.push({
      code: 'PAYLOAD_SCHEMA_INVALID',
      message: `El flujo "${id}" tiene una versión de esquema inválida.`,
      stepInternalId: sid,
    });
  }

  const nodeIds = nodes.map(n => n.id);
  const seen = new Set<string>();
  for (const nid of nodeIds) {
    if (!nid) continue;
    if (seen.has(nid)) {
      issues.push({
        code: 'PAYLOAD_DUPLICATE_NODE_ID',
        message: `Hay dos pasos con el mismo identificador interno. Revisá el flujo en la vista clásica.`,
        stepInternalId: nid,
      });
    }
    seen.add(nid);
  }

  if (!nodeIds.includes(entryNode)) {
    issues.push({
      code: 'ENTRY_STEP_MISSING',
      message: `El inicio de la conversación apunta a un paso que no existe.`,
      stepInternalId: entryNode || sid,
    });
  }

  if (fallbackNode && !nodeIds.includes(fallbackNode)) {
    issues.push({
      code: 'FALLBACK_STEP_MISSING',
      message: `El paso de respaldo no existe en la lista de pasos.`,
      stepInternalId: fallbackNode,
    });
  }

  const idSet = new Set(nodeIds.filter(Boolean));

  for (const node of nodes) {
    issues.push(...validatePayloadNode(node, idSet, id));
  }

  return issues;
}

function validatePayloadNode(
  node: FlowNode,
  allNodeIds: Set<string>,
  flowId: string
): ConversationValidationIssue[] {
  const issues: ConversationValidationIssue[] = [];
  const { id: nid, type, message, transitions, nextNode } = node;
  const stepId = nid || anchorStepIdFallback(flowId);

  if (!nid?.trim()) {
    issues.push({
      code: 'PAYLOAD_NODE_ID_MISSING',
      message: `Un paso en el flujo "${flowId}" no tiene identificador.`,
      stepInternalId: stepId,
    });
    return issues;
  }

  if (!type || !SUPPORTED_TYPES.has(type)) {
    issues.push({
      code: 'PAYLOAD_NODE_TYPE_INVALID',
      message: `El paso tiene un tipo no válido o no soportado.`,
      stepInternalId: nid,
    });
  }

  if (!message || typeof message !== 'string') {
    issues.push({
      code: 'STEP_MESSAGE_EMPTY',
      message: 'Escribí el mensaje que verá el cliente en este paso.',
      stepInternalId: nid,
    });
  }

  if (transitions) {
    if (!Array.isArray(transitions)) {
      issues.push({
        code: 'PAYLOAD_TRANSITIONS_INVALID',
        message: `Las respuestas del paso deben ser una lista.`,
        stepInternalId: nid,
      });
    } else {
      transitions.forEach((trans: FlowTransition, idx: number) => {
        if (!trans.nextNode) {
          issues.push({
            code: 'PAYLOAD_TRANSITION_NEXT_MISSING',
            message: `Una respuesta no indica a qué paso sigue.`,
            stepInternalId: nid,
            responseUiId: `t-${idx}`,
          });
        } else if (!allNodeIds.has(trans.nextNode)) {
          issues.push({
            code: 'PAYLOAD_TRANSITION_NEXT_UNKNOWN',
            message: `Una respuesta apunta a un paso que no existe.`,
            stepInternalId: nid,
            responseUiId: `t-${idx}`,
          });
        }
        if (trans.type && !SUPPORTED_TRANSITIONS.has(trans.type)) {
          issues.push({
            code: 'PAYLOAD_TRANSITION_TYPE_INVALID',
            message: `Hay una respuesta con un tipo no reconocido.`,
            stepInternalId: nid,
            responseUiId: `t-${idx}`,
          });
        }
      });
    }
  }

  if (nextNode && !allNodeIds.has(nextNode)) {
    issues.push({
      code: 'PAYLOAD_NEXT_NODE_UNKNOWN',
      message: `El enlace directo apunta a un paso que no existe.`,
      stepInternalId: nid,
    });
  }

  return issues;
}

function anchorStepIdFallback(flowId: string): string {
  return `__flow__:${flowId}`;
}
