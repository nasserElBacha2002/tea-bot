import { computeFlowChecksum } from './flow-checksum.js';
import { coerceTransitionValueForDocument } from './flow-transition-value.js';

/**
 * Reconstruye el documento de flujo esperado por FlowEngine desde tablas normalizadas.
 */
export function buildFlowDocumentFromTables(flow, version, nodes, transitionsByNodeKey) {
  const meta = version.metadataJson || {};
  const flowNodes = nodes.map((node) => {
    const base = {
      id: node.nodeKey,
      type: node.type,
      message: node.message ?? '',
    };
    if (node.title) base.title = node.title;
    if (node.metadataJson && typeof node.metadataJson === 'object') {
      Object.assign(base, node.metadataJson);
    }
    if (node.positionX != null || node.positionY != null) {
      base.ui = {
        position: {
          x: node.positionX ?? 0,
          y: node.positionY ?? 0,
        },
      };
    }

    const transitions = transitionsByNodeKey.get(node.nodeKey) || [];
    const mapped = transitions
      .filter((t) => t.type !== 'implicit_next')
      .map((t) => {
        const tr = {
          type: t.type,
          nextNode: t.nextNodeKey,
        };
        if (t.value !== undefined && t.value !== null) {
          tr.value = coerceTransitionValueForDocument(t.value, {
            flowKey: flow.flowKey,
            version: version.versionLabel,
            nodeId: node.nodeKey,
            path: `nodes.${node.nodeKey}.transitions[].value`,
          });
        }
        if (t.priority != null) tr.priority = t.priority;
        if (t.metadataJson && typeof t.metadataJson === 'object') {
          Object.assign(tr, t.metadataJson);
        }
        return tr;
      });

    if (mapped.length > 0) {
      base.transitions = mapped;
    } else {
      const implicit = transitions.find((t) => t.type === 'implicit_next');
      if (implicit) base.nextNode = implicit.nextNodeKey;
    }

    return base;
  });

  return {
    id: flow.flowKey,
    name: flow.name,
    version: version.versionLabel,
    entryNode: version.entryNodeKey,
    fallbackNode: version.fallbackNodeKey || undefined,
    schemaVersion: meta.schemaVersion ?? 1,
    status: version.status === 'published' ? 'published' : 'draft',
    nodes: flowNodes,
  };
}

export function buildSnapshotPayload(flow, version, nodes, transitionsByNodeKey) {
  const document = buildFlowDocumentFromTables(flow, version, nodes, transitionsByNodeKey);
  const snapshotJson = JSON.stringify(document);
  const checksum = computeFlowChecksum(snapshotJson);
  return { document, snapshotJson, checksum };
}
