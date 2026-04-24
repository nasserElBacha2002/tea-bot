import type { Flow, FlowNode } from '../types/flow.types';
import { UI_TRANSITION_TYPE } from './flowUiLabels';

export type NodeIssueSeverity = 'error' | 'warning';

export interface NodeIssue {
  code: string;
  message: string;
  severity: NodeIssueSeverity;
}

const nodeIds = (flow: Flow) => new Set(flow.nodes.map(n => n.id));

function hasOutgoing(node: FlowNode): boolean {
  if (node.nextNode) return true;
  return (node.transitions?.length ?? 0) > 0;
}

/**
 * Heurísticas locales de incompletitud (no sustituyen al validador del backend).
 */
export function getNodeIssues(flow: Flow, node: FlowNode): NodeIssue[] {
  const issues: NodeIssue[] = [];
  const ids = nodeIds(flow);

  if (node.type === 'end') {
    if (hasOutgoing(node)) {
      issues.push({
        code: 'end_has_outgoing',
        message: 'Un nodo fin no debería tener transiciones ni siguiente',
        severity: 'warning',
      });
    }
    return issues;
  }

  if (!hasOutgoing(node)) {
    issues.push({
      code: 'no_outgoing',
      message: 'Sin salida (añade transición o siguiente)',
      severity: 'warning',
    });
  }

  if (node.type === 'redirect') {
    if (!node.nextNode) {
      issues.push({
        code: 'redirect_no_target',
        message: 'La redirección necesita un destino (siguiente nodo)',
        severity: 'error',
      });
    } else if (!ids.has(node.nextNode)) {
      issues.push({
        code: 'redirect_bad_target',
        message: `Destino desconocido «${node.nextNode}»`,
        severity: 'error',
      });
    }
  }

  if (node.type === 'capture' && !node.variableName?.trim()) {
    issues.push({
      code: 'capture_no_var',
      message: 'La captura necesita nombre de variable',
      severity: 'warning',
    });
  }

  if (node.type !== 'redirect' && !node.message?.trim()) {
    issues.push({
      code: 'missing_message',
      message: 'El mensaje está vacío',
      severity: 'warning',
    });
  }

  (node.transitions ?? []).forEach((t, i) => {
    if (!t.type) {
      issues.push({
        code: `trans_incomplete_${i}`,
        message: `Transición #${i + 1}: falta el tipo de regla`,
        severity: 'error',
      });
    }
    if (!t.nextNode) {
      issues.push({
        code: `trans_no_target_${i}`,
        message: `Transición #${i + 1}: sin destino`,
        severity: 'error',
      });
    } else if (!ids.has(t.nextNode)) {
      issues.push({
        code: `trans_bad_target_${i}`,
        message: `Transición #${i + 1}: destino desconocido «${t.nextNode}»`,
        severity: 'error',
      });
    }
    if (t.type && t.type !== 'default') {
      if (t.type === 'matchAny') {
        if (!Array.isArray(t.value) || t.value.length === 0) {
          issues.push({
            code: `trans_value_${i}`,
            message: `Transición #${i + 1}: la lista de valores no puede estar vacía`,
            severity: 'warning',
          });
        }
      } else if (!t.value || (typeof t.value === 'string' && !t.value.trim())) {
        issues.push({
          code: `trans_value_${i}`,
          message: `Transición #${i + 1}: falta el valor (${UI_TRANSITION_TYPE[t.type]})`,
          severity: 'warning',
        });
      }
    }
  });

  if (node.nextNode && !ids.has(node.nextNode)) {
    issues.push({
      code: 'next_bad',
      message: `Siguiente nodo desconocido «${node.nextNode}»`,
      severity: 'error',
    });
  }

  return issues;
}
