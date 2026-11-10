import { query, isConversationDbEnabled } from '../db/index.js';

function serializeJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

class AuditLogService {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async record({
    actorUserId = null,
    entityType,
    entityId,
    action,
    beforeJson = null,
    afterJson = null,
    metadata = null,
  }) {
    if (!this.isEnabled()) return;
    try {
      if (metadata?.providerMessageId) {
        const existing = await query(
          `SELECT TOP (1) id
           FROM dbo.audit_logs
           WHERE entity_type = $1
             AND entity_id = $2
             AND action = $3
             AND ISJSON(metadata_json) = 1
             AND JSON_VALUE(metadata_json, '$.providerMessageId') = $4`,
          [entityType, String(entityId), action, String(metadata.providerMessageId)],
        );
        if (existing.rows[0]) return;
      }
      await query(
        `INSERT INTO dbo.audit_logs (
          actor_user_id, entity_type, entity_id, action,
          before_json, after_json, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          actorUserId,
          entityType,
          String(entityId),
          action,
          serializeJson(beforeJson),
          serializeJson(afterJson),
          serializeJson({
            ...(metadata || {}),
            actor: metadata?.actor || (actorUserId ? 'user' : 'system_or_local_admin'),
          }),
        ],
      );
    } catch (err) {
      console.warn(`[AuditLog] No se pudo registrar ${action}: ${err.message}`);
    }
  }
}

const auditLogService = new AuditLogService();
export default auditLogService;
