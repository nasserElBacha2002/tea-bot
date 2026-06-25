import { query, parseJsonColumn, isConversationDbEnabled } from '../db/index.js';

function serializeJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function mapFlow(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowKey: row.flow_key,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flow_id,
    versionNumber: row.version_number,
    versionLabel: row.version_label,
    status: row.status,
    entryNodeKey: row.entry_node_key,
    fallbackNodeKey: row.fallback_node_key,
    publishedAt: row.published_at,
    metadataJson: parseJsonColumn(row.metadata_json, null),
  };
}

class FlowDbRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async findFlowByKey(flowKey) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.flows WHERE flow_key = $1',
      [flowKey],
    );
    return mapFlow(rows[0]);
  }

  async upsertFlow({ flowKey, name, description = null, status = 'active' }) {
    const existing = await this.findFlowByKey(flowKey);
    if (existing) {
      const { rows } = await query(
        `UPDATE dbo.flows SET name = $1, description = $2, status = $3, updated_at = SYSUTCDATETIME()
         OUTPUT INSERTED.* WHERE flow_key = $4`,
        [name, description, status, flowKey],
      );
      return mapFlow(rows[0]);
    }

    const { rows } = await query(
      `INSERT INTO dbo.flows (flow_key, name, description, status)
       OUTPUT INSERTED.*
       VALUES ($1, $2, $3, $4)`,
      [flowKey, name, description, status],
    );
    return mapFlow(rows[0]);
  }

  async findVersionByFlowAndNumber(flowId, versionNumber) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.flow_versions
       WHERE flow_id = $1 AND version_number = $2`,
      [flowId, versionNumber],
    );
    return mapVersion(rows[0]);
  }

  async getSnapshotChecksum(flowVersionId) {
    const { rows } = await query(
      'SELECT TOP (1) checksum FROM dbo.flow_version_snapshots WHERE flow_version_id = $1',
      [flowVersionId],
    );
    return rows[0]?.checksum || null;
  }

  async deleteVersionChildren(flowVersionId, { transaction } = {}) {
    await query(
      `DELETE t FROM dbo.flow_transitions t
       INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
       WHERE n.flow_version_id = $1`,
      [flowVersionId],
      { transaction },
    );
    await query('DELETE FROM dbo.flow_nodes WHERE flow_version_id = $1', [flowVersionId], {
      transaction,
    });
    await query(
      'DELETE FROM dbo.flow_version_snapshots WHERE flow_version_id = $1',
      [flowVersionId],
      { transaction },
    );
  }

  async upsertFlowVersion(data) {
    const {
      flowId,
      versionNumber,
      versionLabel,
      status,
      entryNodeKey,
      fallbackNodeKey = null,
      publishedAt = null,
      metadataJson = null,
    } = data;

    const existing = await this.findVersionByFlowAndNumber(flowId, versionNumber);
    if (existing) {
      const { rows } = await query(
        `UPDATE dbo.flow_versions SET
          version_label = $1, status = $2, entry_node_key = $3, fallback_node_key = $4,
          published_at = $5, metadata_json = $6
         OUTPUT INSERTED.*
         WHERE id = $7`,
        [
          versionLabel,
          status,
          entryNodeKey,
          fallbackNodeKey,
          publishedAt,
          serializeJson(metadataJson),
          existing.id,
        ],
      );
      return mapVersion(rows[0]);
    }

    const { rows } = await query(
      `INSERT INTO dbo.flow_versions (
        flow_id, version_number, version_label, status,
        entry_node_key, fallback_node_key, published_at, metadata_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        flowId,
        versionNumber,
        versionLabel,
        status,
        entryNodeKey,
        fallbackNodeKey,
        publishedAt,
        serializeJson(metadataJson),
      ],
    );
    return mapVersion(rows[0]);
  }

  async insertNodes(flowVersionId, nodes) {
    const idByKey = new Map();
    for (const node of nodes) {
      const {
        nodeKey,
        type,
        message = null,
        title = null,
        metadataJson = null,
        positionX = null,
        positionY = null,
      } = node;
      const { rows } = await query(
        `INSERT INTO dbo.flow_nodes (
          flow_version_id, node_key, type, message, title, metadata_json, position_x, position_y
        )
        OUTPUT INSERTED.id
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          flowVersionId,
          nodeKey,
          type,
          message,
          title,
          serializeJson(metadataJson),
          positionX,
          positionY,
        ],
      );
      idByKey.set(nodeKey, rows[0].id);
    }
    return idByKey;
  }

  async insertTransitions(nodeIdByKey, transitionsByNodeKey) {
    let count = 0;
    for (const [nodeKey, transitions] of transitionsByNodeKey.entries()) {
      const flowNodeId = nodeIdByKey.get(nodeKey);
      if (!flowNodeId) continue;
      let priority = 0;
      for (const trans of transitions) {
        await query(
          `INSERT INTO dbo.flow_transitions (
            flow_node_id, type, value_json, next_node_key, priority, metadata_json
          )
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            flowNodeId,
            trans.type,
            serializeJson(trans.value),
            trans.nextNodeKey,
            trans.priority ?? priority++,
            serializeJson(trans.metadataJson),
          ],
        );
        count += 1;
      }
    }
    return count;
  }

  async insertSnapshot(flowVersionId, snapshotJson, checksum) {
    await query(
      `INSERT INTO dbo.flow_version_snapshots (flow_version_id, snapshot_json, checksum)
       VALUES ($1, $2, $3)`,
      [flowVersionId, snapshotJson, checksum],
    );
  }

  async listPublishedFlowKeys() {
    const { rows } = await query(
      `SELECT DISTINCT f.flow_key FROM dbo.flows f
       INNER JOIN dbo.flow_versions fv ON fv.flow_id = f.id
       WHERE fv.status = N'published'`,
    );
    return rows.map((r) => r.flow_key);
  }

  async getLatestPublishedSnapshot(flowKey) {
    const { rows } = await query(
      `SELECT TOP (1)
        f.flow_key,
        fv.version_label,
        fv.version_number,
        s.snapshot_json,
        s.checksum
       FROM dbo.flows f
       INNER JOIN dbo.flow_versions fv ON fv.flow_id = f.id
       INNER JOIN dbo.flow_version_snapshots s ON s.flow_version_id = fv.id
       WHERE f.flow_key = $1 AND fv.status = N'published'
       ORDER BY fv.version_number DESC`,
      [flowKey],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      flowKey: row.flow_key,
      versionLabel: row.version_label,
      versionNumber: row.version_number,
      snapshotJson: row.snapshot_json,
      checksum: row.checksum,
    };
  }

  async getPublishedSnapshotByLabel(flowKey, versionLabel) {
    const { rows } = await query(
      `SELECT TOP (1) s.snapshot_json, fv.version_label, fv.version_number, fv.status
       FROM dbo.flows f
       INNER JOIN dbo.flow_versions fv ON fv.flow_id = f.id
       INNER JOIN dbo.flow_version_snapshots s ON s.flow_version_id = fv.id
       WHERE f.flow_key = $1
         AND (fv.version_label = $2 OR CAST(fv.version_number AS NVARCHAR(20)) = $2)
       ORDER BY fv.version_number DESC`,
      [flowKey, versionLabel],
    );
    if (!rows[0]) return null;
    return {
      flowKey,
      versionLabel: rows[0].version_label,
      versionNumber: rows[0].version_number,
      status: rows[0].status,
      snapshotJson: rows[0].snapshot_json,
    };
  }
}

const flowDbRepository = new FlowDbRepository();
export default flowDbRepository;
