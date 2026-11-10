import { query, isConversationDbEnabled, withTransaction } from '../db/index.js';

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
      const metadataJson = serializeJson({
        ...(metadata || {}),
        actor: metadata?.actor || (actorUserId ? 'user' : 'system_or_local_admin'),
      });
      const values = [
        actorUserId,
        entityType,
        String(entityId),
        action,
        serializeJson(beforeJson),
        serializeJson(afterJson),
        metadataJson,
      ];
      if (metadata?.providerMessageId) {
        await withTransaction(async (transaction) => {
          const existing = await query(
            `SELECT TOP (1) id
             FROM dbo.audit_logs WITH (UPDLOCK, HOLDLOCK)
             WHERE entity_type = $1
               AND entity_id = $2
               AND action = $3
               AND ISJSON(metadata_json) = 1
               AND JSON_VALUE(metadata_json, '$.providerMessageId') = $4`,
            [entityType, String(entityId), action, String(metadata.providerMessageId)],
            { transaction },
          );
          if (existing.rows[0]) return;
          await query(
            `INSERT INTO dbo.audit_logs (
              actor_user_id, entity_type, entity_id, action,
              before_json, after_json, metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            values,
            { transaction },
          );
        });
        return;
      }
      await query(
        `INSERT INTO dbo.audit_logs (
          actor_user_id, entity_type, entity_id, action,
          before_json, after_json, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        values,
      );
    } catch (err) {
      console.warn(`[AuditLog] No se pudo registrar ${action}: ${err.message}`);
    }
  }
}

const auditLogService = new AuditLogService();
export default auditLogService;
