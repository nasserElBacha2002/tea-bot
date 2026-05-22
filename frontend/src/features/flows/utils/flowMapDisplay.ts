import type { Flow, FlowNode, FlowTransition } from '../types/flow.types';
import type { NodeIssue } from './flowGraph.validation';
import { UI_NODE_TYPE, UI_TRANSITION_TYPE } from './flowUiLabels';

export type MapViewStyle = 'message' | 'technical';

export interface MessagePreview {
  lines: string[];
  truncated: boolean;
  full: string;
}

export interface TransitionGroup {
  target: string;
  targetTitle: string;
  count: number;
  preview: string;
  transitions: FlowTransition[];
}

const TECHNICAL_ID_RE = /^(node_|match|step_)/i;

/** Título corto para tarjetas del mapa. */
export function getNodeDisplayTitle(node: FlowNode): string {
  const manual = node.ui?.stepTitle?.trim();
  if (manual) return manual;
  if (node.id && !looksLikeRawTechnicalId(node.id)) {
    return humanizeNodeId(node.id);
  }
  if (node.id) return humanizeNodeId(node.id);
  return 'Paso sin nombre';
}

export function looksLikeRawTechnicalId(id: string): boolean {
  return TECHNICAL_ID_RE.test(id) || /^[a-z]+_[a-z0-9_]{8,}$/i.test(id);
}

export function humanizeNodeId(id: string): string {
  const cleaned = id
    .replace(/^(node_|step_)/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return id;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Normaliza mensaje para vista de lectura (sin markdown ruidoso). */
export function prepareMessageForPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function getNodeMessagePreview(
  node: FlowNode,
  maxLines = 4,
  maxChars = 220,
): MessagePreview {
  const raw = node.message?.trim() ?? '';
  if (!raw) {
    const fallback =
      node.type === 'end'
        ? 'Cierra la conversación.'
        : node.type === 'redirect'
          ? `Redirige a ${node.nextNode ?? '…'}`
          : node.type === 'capture'
            ? `Captura: ${node.variableName ?? 'variable'}`
            : '(Sin mensaje)';
    return { lines: [fallback], truncated: false, full: fallback };
  }

  const prepared = prepareMessageForPreview(raw);
  const split = prepared.split('\n').map((l) => l.trim()).filter(Boolean);
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;

  for (const line of split) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const room = maxChars - chars;
    if (room <= 0) {
      truncated = true;
      break;
    }
    if (line.length > room) {
      lines.push(`${line.slice(0, Math.max(0, room - 1))}…`);
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }

  if (lines.length === 0) {
    lines.push(truncateText(prepared, maxChars));
    truncated = prepared.length > maxChars;
  } else if (!truncated && prepared.length > chars) {
    truncated = true;
  }

  return { lines, truncated, full: prepared };
}

export function groupTransitionsByTarget(
  node: FlowNode,
  flow?: Flow,
): TransitionGroup[] {
  const byTarget = new Map<string, FlowTransition[]>();

  for (const t of node.transitions ?? []) {
    if (!t.nextNode) continue;
    const list = byTarget.get(t.nextNode) ?? [];
    list.push(t);
    byTarget.set(t.nextNode, list);
  }

  if (node.nextNode && (!node.transitions || node.transitions.length === 0)) {
    byTarget.set(node.nextNode, [{ type: 'default', nextNode: node.nextNode }]);
  }

  return [...byTarget.entries()].map(([target, transitions]) => {
    const targetNode = flow?.nodes.find((n) => n.id === target);
    const targetTitle = targetNode
      ? getNodeDisplayTitle(targetNode)
      : humanizeNodeId(target);
    return {
      target,
      targetTitle,
      count: transitions.length,
      preview: buildTransitionPreview(transitions),
      transitions,
    };
  });
}

function buildTransitionPreview(transitions: FlowTransition[]): string {
  const values: string[] = [];
  for (const t of transitions) {
    if (t.type === 'default') values.push('por defecto');
    else if (t.value != null) {
      if (Array.isArray(t.value)) values.push(...t.value.map(String));
      else values.push(String(t.value));
    } else if (t.type) values.push(t.type);
  }
  const uniq = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return uniq.slice(0, 6).join(', ');
}

/** Resumen de salida para tarjeta o arista. */
export function formatTransitionSummary(
  group: TransitionGroup,
  style: 'card' | 'edge' = 'card',
): string {
  const dest = group.targetTitle;
  if (group.count === 0) return `→ ${dest}`;
  if (group.count === 1) {
    const t = group.transitions[0]!;
    if (t.type === 'default') {
      return style === 'edge' ? `Por defecto → ${dest}` : `Por defecto → ${dest}`;
    }
    const label = transitionValueLabel(t);
    return style === 'edge'
      ? truncateText(label ? `${label} → ${dest}` : `→ ${dest}`, 36)
      : `1 → ${dest}`;
  }
  return style === 'edge'
    ? `${group.count} respuestas → ${dest}`
    : `${group.count} respuestas → ${dest}`;
}

export function formatTransitionSummaryForEdge(
  transitions: FlowTransition[],
  targetNodeId: string,
  flow?: Flow,
): { shortLabel: string; tooltip: string } {
  const targetNode = flow?.nodes.find((n) => n.id === targetNodeId);
  const group: TransitionGroup = {
    target: targetNodeId,
    targetTitle: targetNode ? getNodeDisplayTitle(targetNode) : humanizeNodeId(targetNodeId),
    count: transitions.length,
    preview: buildTransitionPreview(transitions),
    transitions,
  };
  const shortLabel = formatTransitionSummary(group, 'edge');
  const tooltip = transitions
    .map((t) => {
      const type = t.type ? (UI_TRANSITION_TYPE[t.type] ?? t.type) : 'sin tipo';
      const val = transitionValueLabel(t);
      return val ? `${type}: ${val} → ${targetNodeId}` : `${type} → ${targetNodeId}`;
    })
    .join('\n');
  return { shortLabel, tooltip };
}

function transitionValueLabel(t: FlowTransition): string {
  if (t.type === 'default') return 'por defecto';
  if (t.value == null) return t.type ?? '';
  return Array.isArray(t.value) ? t.value.join(', ') : String(t.value);
}

export function getNodeFooterHints(node: FlowNode, issues: NodeIssue[]): string[] {
  const hints: string[] = [];
  const outCount =
    (node.transitions?.length ?? 0) + (node.nextNode && !node.transitions?.length ? 1 : 0);

  if (node.type === 'end') {
    hints.push('Finaliza conversación');
  } else if (outCount > 0) {
    hints.push(`${outCount} ${outCount === 1 ? 'salida' : 'salidas'}`);
  } else {
    hints.push('Sin salidas');
  }

  if (issues.some((i) => i.severity === 'error')) {
    hints.push('Requiere revisión');
  } else if (issues.some((i) => i.severity === 'warning')) {
    hints.push('Aviso de validación');
  }

  return hints;
}

export function truncateText(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** Detalle técnico de una transición para panel lateral. */
export function formatTransitionDetail(t: FlowTransition, index: number): string {
  const type = t.type ? (UI_TRANSITION_TYPE[t.type] ?? t.type) : '(sin tipo)';
  const val =
    t.value != null
      ? Array.isArray(t.value)
        ? t.value.join(', ')
        : String(t.value)
      : '—';
  return `${index + 1}. ${type} · ${val} → ${t.nextNode}`;
}

export function nodeTypeLabel(type: FlowNode['type']): string {
  return UI_NODE_TYPE[type] ?? type;
}
