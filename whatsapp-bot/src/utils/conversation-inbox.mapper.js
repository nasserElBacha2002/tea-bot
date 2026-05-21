/**
 * Normaliza filas de DB a respuestas API del inbox (camelCase, sin payloads crudos por defecto).
 */

export function mapConversationPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    phoneNumber: row.phoneNumber ?? null,
    displayName: row.displayName ?? null,
    status: row.status,
    assignedAgentId: row.assignedAgentId ?? null,
    currentFlowId: row.currentFlowId ?? null,
    currentFlowVersion: row.currentFlowVersion ?? null,
    currentNodeKey: row.currentNodeKey ?? null,
    lastMessageAt: row.lastMessageAt ?? null,
    startedAt: row.startedAt,
    closedAt: row.closedAt ?? null,
  };
}

export function mapLastMessagePublic(row) {
  if (!row) return null;
  return {
    body: row.body ?? '',
    direction: row.direction,
    senderType: row.senderType,
    createdAt: row.createdAt,
  };
}

export function mapHumanHandoffPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    reason: row.reason ?? null,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    assignedAgentId: row.assignedAgentId ?? null,
    assignedAt: row.assignedAt ?? null,
    resolvedAt: row.resolvedAt ?? null,
  };
}

export function mapMessagePublic(row, { includeRawPayload = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    senderType: row.senderType,
    body: row.body ?? '',
    provider: row.provider,
    providerMessageId: row.providerMessageId ?? null,
    metadata: row.metadataJson ?? null,
    createdAt: row.createdAt,
  };
  if (includeRawPayload && row.rawPayloadJson) {
    item.rawPayload = row.rawPayloadJson;
  }
  return item;
}

export function mapSessionPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flowId,
    flowVersion: row.flowVersion ?? null,
    currentNodeKey: row.currentNodeKey ?? null,
    status: row.status,
    history: Array.isArray(row.historyJson) ? row.historyJson : [],
    variables:
      row.variablesJson && typeof row.variablesJson === 'object' ? row.variablesJson : {},
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}
