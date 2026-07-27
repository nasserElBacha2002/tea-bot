import { query, isConversationDbEnabled } from '../db/index.js';

function mapClassificationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    classifierVersion: row.classifier_version,
    primaryQuery: row.primary_query,
    modality: row.modality,
    programType: row.program_type,
    programName: row.program_name,
    specificReason: row.specific_reason,
    responsibleArea: row.responsible_area,
    source: row.source,
    confidence: Number(row.confidence),
    matchedRule: row.matched_rule,
    matchedNode: row.matched_node,
    flowId: row.flow_id,
    flowVersion: row.flow_version,
    isActive: Boolean(row.is_active),
    classifiedAt: row.classified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ConversationClassificationRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async findActiveByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_classifications
       WHERE conversation_id = $1 AND is_active = 1
       ORDER BY classified_at DESC`,
      [conversationId],
    );
    return mapClassificationRow(rows[0]);
  }

  async deactivateActive(conversationId) {
    await query(
      `UPDATE dbo.conversation_classifications
       SET is_active = 0, updated_at = SYSUTCDATETIME()
       WHERE conversation_id = $1 AND is_active = 1`,
      [conversationId],
    );
  }

  async insertClassification(data) {
    const { rows } = await query(
      `INSERT INTO dbo.conversation_classifications (
        conversation_id, classifier_version, primary_query, modality, program_type,
        program_name, specific_reason, responsible_area, source, confidence,
        matched_rule, matched_node, flow_id, flow_version, classified_at
      )
      OUTPUT INSERTED.*
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        data.conversationId,
        data.classifierVersion,
        data.primaryQuery,
        data.modality,
        data.programType,
        data.programName,
        data.specificReason,
        data.responsibleArea,
        data.source,
        data.confidence,
        data.matchedRule,
        data.matchedNode,
        data.flowId,
        data.flowVersion,
        data.classifiedAt || new Date(),
      ],
    );
    return mapClassificationRow(rows[0]);
  }

  async listUnclassifiedConversationIds(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    const values = [];
    const clauses = [
      `(cc.id IS NULL OR cc.primary_query IS NULL OR cc.source = N'fallback')`,
      `(cc.source IS NULL OR cc.source <> N'manual')`,
    ];

    if (options.fromDate) {
      clauses.push(`c.started_at >= $${values.length + 1}`);
      values.push(options.fromDate);
    }
    if (options.toDate) {
      clauses.push(`c.started_at <= $${values.length + 1}`);
      values.push(options.toDate);
    }
    if (options.flowVersion) {
      clauses.push(`c.current_flow_version = $${values.length + 1}`);
      values.push(options.flowVersion);
    }
    if (options.conversationId) {
      clauses.push(`c.id = $${values.length + 1}`);
      values.push(options.conversationId);
    }

    const { rows } = await query(
      `SELECT TOP (${limit}) c.id
       FROM dbo.conversations c
       LEFT JOIN dbo.conversation_classifications cc
         ON cc.conversation_id = c.id AND cc.is_active = 1
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.started_at DESC`,
      values,
    );
    return rows.map((row) => row.id);
  }

  async createBatch({ batchKey, mode, status = 'running', summaryJson = null }) {
    const { rows } = await query(
      `INSERT INTO dbo.conversation_classification_batches (batch_key, mode, status, summary_json)
       OUTPUT INSERTED.*
       VALUES ($1, $2, $3, $4)`,
      [batchKey, mode, status, summaryJson ? JSON.stringify(summaryJson) : null],
    );
    return rows[0];
  }

  async completeBatch(batchKey, summaryJson) {
    await query(
      `UPDATE dbo.conversation_classification_batches
       SET status = N'completed', summary_json = $2, completed_at = SYSUTCDATETIME()
       WHERE batch_key = $1`,
      [batchKey, JSON.stringify(summaryJson)],
    );
  }
}

const conversationClassificationRepository = new ConversationClassificationRepository();
export default conversationClassificationRepository;
