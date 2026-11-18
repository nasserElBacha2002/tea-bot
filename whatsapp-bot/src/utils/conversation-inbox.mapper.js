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
    contactEmail: row.contactEmail ?? null,
    status: row.status,
    assignedAgentId: row.assignedAgentId ?? null,
    statusVersion: row.statusVersion ?? null,
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

export function mapAttachmentPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    ordinal: row.ordinal,
    mimeType: row.mimeType ?? null,
    byteSize: row.byteSize != null ? Number(row.byteSize) : null,
    originalName: row.originalName ?? null,
    status: row.status,
  };
}

export function mapWhatsappDeliveryPublic(deliveryRow) {
  if (!deliveryRow?.status) return null;
  return {
    status: String(deliveryRow.status),
    errorCode: deliveryRow.errorCode ?? null,
    errorMessage: deliveryRow.errorMessage ?? null,
    statusAt: deliveryRow.statusAt ?? null,
  };
}

export function mapOutboundDispatchPublic(metadataJson) {
  const outbound = metadataJson?.outboundDelivery;
  if (!outbound?.state) return null;
  return {
    state: String(outbound.state),
    error: typeof outbound.error === 'string' ? outbound.error : null,
  };
}

export function mapMessagePublic(row, {
  includeRawPayload = false,
  attachments = [],
  whatsappDelivery = undefined,
} = {}) {
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
    attachments: attachments.map((att) => mapAttachmentPublic(att)).filter(Boolean),
  };
  if (row.direction === 'outbound') {
    const dispatch = mapOutboundDispatchPublic(row.metadataJson);
    if (dispatch) item.dispatch = dispatch;
    if (whatsappDelivery !== undefined) {
      item.whatsappDelivery = whatsappDelivery;
    }
  }
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
