import { query, parseJsonColumn, isConversationDbEnabled } from '../db/index.js';

function serializeJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
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
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    metadataJson: parseJsonColumn(row.metadata_json, null),
  };
}

function mapNode(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowVersionId: row.flow_version_id,
    nodeKey: row.node_key,
    type: row.type,
    message: row.message,
    title: row.title,
    metadataJson: parseJsonColumn(row.metadata_json, null),
    positionX: row.position_x,
    positionY: row.position_y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransition(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowNodeId: row.flow_node_id,
    type: row.type,
    value: parseJsonColumn(row.value_json, null),
    nextNodeKey: row.next_node_key,
    priority: row.priority,
    metadataJson: parseJsonColumn(row.metadata_json, null),
    createdAt: row.created_at,
  };
}

class FlowCatalogRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async listFlows() {
    const { rows } = await query(
      `SELECT f.*,
        pub.id AS pub_id, pub.version_number AS pub_version_number,
        pub.version_label AS pub_version_label, pub.published_at AS pub_published_at,
        dr.id AS draft_id, dr.version_number AS draft_version_number,
        dr.version_label AS draft_version_label, dr.status AS draft_status
       FROM dbo.flows f
       OUTER APPLY (
         SELECT TOP (1) fv.*
         FROM dbo.flow_versions fv
         WHERE fv.flow_id = f.id AND fv.status = N'published'
         ORDER BY fv.version_number DESC
       ) pub
       OUTER APPLY (
         SELECT TOP (1) fv.*
         FROM dbo.flow_versions fv
         WHERE fv.flow_id = f.id AND fv.status = N'draft'
         ORDER BY fv.version_number DESC
       ) dr
       ORDER BY f.flow_key`,
    );

    return rows.map((row) => {
      const flow = mapFlow(row);
      return {
        ...flow,
        publishedVersion: row.pub_id
          ? {
              id: row.pub_id,
              versionNumber: row.pub_version_number,
              versionLabel: row.pub_version_label,
              publishedAt: row.pub_published_at,
            }
          : null,
        draftVersion: row.draft_id
          ? {
              id: row.draft_id,
              versionNumber: row.draft_version_number,
              versionLabel: row.draft_version_label,
              status: row.draft_status,
            }
          : null,
      };
    });
  }

  async getFlowById(flowId) {
    const { rows } = await query('SELECT TOP (1) * FROM dbo.flows WHERE id = $1', [flowId]);
    return mapFlow(rows[0]);
  }

  async getFlowByKey(flowKey) {
    const { rows } = await query('SELECT TOP (1) * FROM dbo.flows WHERE flow_key = $1', [flowKey]);
    return mapFlow(rows[0]);
  }

  async getLatestPublishedVersion(flowId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.flow_versions
       WHERE flow_id = $1 AND status = N'published'
       ORDER BY version_number DESC`,
      [flowId],
    );
    return mapVersion(rows[0]);
  }

  async getLatestDraftVersion(flowId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.flow_versions
       WHERE flow_id = $1 AND status = N'draft'
       ORDER BY version_number DESC`,
      [flowId],
    );
    return mapVersion(rows[0]);
  }

  async listVersions(flowId) {
    const { rows } = await query(
      `SELECT fv.*,
        (SELECT COUNT(*) FROM dbo.flow_nodes n WHERE n.flow_version_id = fv.id) AS nodes_count,
        (SELECT COUNT(*) FROM dbo.flow_transitions t
         INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
         WHERE n.flow_version_id = fv.id) AS transitions_count
       FROM dbo.flow_versions fv
       WHERE fv.flow_id = $1
       ORDER BY fv.version_number DESC`,
      [flowId],
    );
    return rows.map((row) => ({
      ...mapVersion(row),
      nodesCount: row.nodes_count,
      transitionsCount: row.transitions_count,
    }));
  }

  async getVersionById(versionId) {
    const { rows } = await query('SELECT TOP (1) * FROM dbo.flow_versions WHERE id = $1', [versionId]);
    return mapVersion(rows[0]);
  }

  async getMaxVersionNumber(flowId) {
    const { rows } = await query(
      'SELECT ISNULL(MAX(version_number), 0) AS max_num FROM dbo.flow_versions WHERE flow_id = $1',
      [flowId],
    );
    return rows[0]?.max_num ?? 0;
  }

  async createVersion(data, { transaction } = {}) {
    const {
      flowId,
      versionNumber,
      versionLabel,
      status,
      entryNodeKey,
      fallbackNodeKey = null,
      metadataJson = null,
    } = data;
    const { rows } = await query(
      `INSERT INTO dbo.flow_versions (
        flow_id, version_number, version_label, status,
        entry_node_key, fallback_node_key, metadata_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        flowId,
        versionNumber,
        versionLabel,
        status,
        entryNodeKey,
        fallbackNodeKey,
        serializeJson(metadataJson),
      ],
      { transaction },
    );
    return mapVersion(rows[0]);
  }

  async updateVersion(versionId, patch, { transaction } = {}) {
    const fields = [];
    const params = [];
    const allowed = {
      entryNodeKey: 'entry_node_key',
      fallbackNodeKey: 'fallback_node_key',
      status: 'status',
      publishedAt: 'published_at',
      archivedAt: 'archived_at',
      metadataJson: 'metadata_json',
    };
    for (const [key, col] of Object.entries(allowed)) {
      if (patch[key] !== undefined) {
        fields.push(`${col} = $${params.length + 1}`);
        params.push(key === 'metadataJson' ? serializeJson(patch[key]) : patch[key]);
      }
    }
    if (fields.length === 0) return this.getVersionById(versionId);
    params.push(versionId);
    const { rows } = await query(
      `UPDATE dbo.flow_versions SET ${fields.join(', ')}
       OUTPUT INSERTED.* WHERE id = $${params.length}`,
      params,
      { transaction },
    );
    return mapVersion(rows[0]);
  }

  async archivePublishedVersions(flowId, excludingVersionId = null, { transaction } = {}) {
    const params = [flowId];
    let excludeSql = '';
    if (excludingVersionId) {
      excludeSql = ' AND id <> $2';
      params.push(excludingVersionId);
    }
    await query(
      `UPDATE dbo.flow_versions SET status = N'archived', archived_at = SYSUTCDATETIME()
       WHERE flow_id = $1 AND status = N'published'${excludeSql}`,
      params,
      { transaction },
    );
  }

  async deleteDraftVersion(versionId, { transaction } = {}) {
    await query(
      `DELETE t FROM dbo.flow_transitions t
       INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
       WHERE n.flow_version_id = $1`,
      [versionId],
      { transaction },
    );
    await query('DELETE FROM dbo.flow_nodes WHERE flow_version_id = $1', [versionId], {
      transaction,
    });
    await query('DELETE FROM dbo.flow_version_snapshots WHERE flow_version_id = $1', [versionId], {
      transaction,
    });
    await query('DELETE FROM dbo.flow_versions WHERE id = $1 AND status = N\'draft\'', [versionId], {
      transaction,
    });
  }

  async listNodes(versionId) {
    const { rows } = await query(
      'SELECT * FROM dbo.flow_nodes WHERE flow_version_id = $1 ORDER BY node_key',
      [versionId],
    );
    return rows.map(mapNode);
  }

  async getNodeById(nodeId) {
    const { rows } = await query('SELECT TOP (1) * FROM dbo.flow_nodes WHERE id = $1', [nodeId]);
    return mapNode(rows[0]);
  }

  async getNodeByKey(versionId, nodeKey) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.flow_nodes WHERE flow_version_id = $1 AND node_key = $2',
      [versionId, nodeKey],
    );
    return mapNode(rows[0]);
  }

  async countNodes(versionId) {
    const { rows } = await query(
      'SELECT COUNT(*) AS c FROM dbo.flow_nodes WHERE flow_version_id = $1',
      [versionId],
    );
    return rows[0]?.c ?? 0;
  }

  async countTransitions(versionId) {
    const { rows } = await query(
      `SELECT COUNT(*) AS c FROM dbo.flow_transitions t
       INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
       WHERE n.flow_version_id = $1`,
      [versionId],
    );
    return rows[0]?.c ?? 0;
  }

  async createNode(data, { transaction } = {}) {
    const {
      flowVersionId,
      nodeKey,
      type,
      message = null,
      title = null,
      metadataJson = null,
      positionX = null,
      positionY = null,
    } = data;
    const { rows } = await query(
      `INSERT INTO dbo.flow_nodes (
        flow_version_id, node_key, type, message, title, metadata_json, position_x, position_y
      )
      OUTPUT INSERTED.*
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
      { transaction },
    );
    return mapNode(rows[0]);
  }

  async updateNode(nodeId, patch, { transaction } = {}) {
    const fields = [];
    const params = [];
    const map = {
      type: 'type',
      message: 'message',
      title: 'title',
      metadataJson: 'metadata_json',
      positionX: 'position_x',
      positionY: 'position_y',
    };
    for (const [key, col] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        fields.push(`${col} = $${params.length + 1}`);
        params.push(key === 'metadataJson' ? serializeJson(patch[key]) : patch[key]);
      }
    }
    if (fields.length === 0) return this.getNodeById(nodeId);
    fields.push('updated_at = SYSUTCDATETIME()');
    params.push(nodeId);
    const { rows } = await query(
      `UPDATE dbo.flow_nodes SET ${fields.join(', ')}
       OUTPUT INSERTED.* WHERE id = $${params.length}`,
      params,
      { transaction },
    );
    return mapNode(rows[0]);
  }

  async deleteNode(nodeId, { transaction } = {}) {
    await query('DELETE FROM dbo.flow_transitions WHERE flow_node_id = $1', [nodeId], {
      transaction,
    });
    await query('DELETE FROM dbo.flow_nodes WHERE id = $1', [nodeId], { transaction });
  }

  async listTransitionsByVersion(versionId) {
    const { rows } = await query(
      `SELECT t.*, n.node_key AS source_node_key
       FROM dbo.flow_transitions t
       INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
       WHERE n.flow_version_id = $1
       ORDER BY n.node_key, t.priority`,
      [versionId],
    );
    return rows.map((row) => ({
      ...mapTransition(row),
      sourceNodeKey: row.source_node_key,
    }));
  }

  async listTransitionsByNode(nodeId) {
    const { rows } = await query(
      'SELECT * FROM dbo.flow_transitions WHERE flow_node_id = $1 ORDER BY priority',
      [nodeId],
    );
    return rows.map(mapTransition);
  }

  async findReferencesToNode(versionId, nodeKey) {
    const { rows } = await query(
      `SELECT t.id, t.type, t.next_node_key, n.node_key AS source_node_key
       FROM dbo.flow_transitions t
       INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
       WHERE n.flow_version_id = $1 AND t.next_node_key = $2`,
      [versionId, nodeKey],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      nextNodeKey: row.next_node_key,
      sourceNodeKey: row.source_node_key,
    }));
  }

  async createTransition(data, { transaction } = {}) {
    const { flowNodeId, type, value = null, nextNodeKey, priority = 0, metadataJson = null } =
      data;
    const { rows } = await query(
      `INSERT INTO dbo.flow_transitions (
        flow_node_id, type, value_json, next_node_key, priority, metadata_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [flowNodeId, type, serializeJson(value), nextNodeKey, priority, serializeJson(metadataJson)],
      { transaction },
    );
    return mapTransition(rows[0]);
  }

  async getTransitionById(transitionId) {
    const { rows } = await query('SELECT TOP (1) * FROM dbo.flow_transitions WHERE id = $1', [
      transitionId,
    ]);
    return mapTransition(rows[0]);
  }

  async updateTransition(transitionId, patch, { transaction } = {}) {
    const fields = [];
    const params = [];
    if (patch.type !== undefined) {
      fields.push(`type = $${params.length + 1}`);
      params.push(patch.type);
    }
    if (patch.value !== undefined) {
      fields.push(`value_json = $${params.length + 1}`);
      params.push(serializeJson(patch.value));
    }
    if (patch.nextNodeKey !== undefined) {
      fields.push(`next_node_key = $${params.length + 1}`);
      params.push(patch.nextNodeKey);
    }
    if (patch.priority !== undefined) {
      fields.push(`priority = $${params.length + 1}`);
      params.push(patch.priority);
    }
    if (patch.metadataJson !== undefined) {
      fields.push(`metadata_json = $${params.length + 1}`);
      params.push(serializeJson(patch.metadataJson));
    }
    if (fields.length === 0) return this.getTransitionById(transitionId);
    params.push(transitionId);
    const { rows } = await query(
      `UPDATE dbo.flow_transitions SET ${fields.join(', ')}
       OUTPUT INSERTED.* WHERE id = $${params.length}`,
      params,
      { transaction },
    );
    return mapTransition(rows[0]);
  }

  async deleteTransition(transitionId, { transaction } = {}) {
    await query('DELETE FROM dbo.flow_transitions WHERE id = $1', [transitionId], { transaction });
  }

  async getLatestSnapshot(versionId) {
    const { rows } = await query(
      `SELECT TOP (1) snapshot_json, checksum, created_at
       FROM dbo.flow_version_snapshots
       WHERE flow_version_id = $1
       ORDER BY created_at DESC`,
      [versionId],
    );
    if (!rows[0]) return null;
    return {
      snapshotJson: rows[0].snapshot_json,
      checksum: rows[0].checksum,
      createdAt: rows[0].created_at,
    };
  }

  async createSnapshot(versionId, snapshotJson, checksum, { transaction } = {}) {
    await query(
      `INSERT INTO dbo.flow_version_snapshots (flow_version_id, snapshot_json, checksum)
       VALUES ($1, $2, $3)`,
      [versionId, snapshotJson, checksum],
      { transaction },
    );
  }

  async copyVersionContent(baseVersionId, targetVersionId, { transaction } = {}) {
    const nodes = await this.listNodes(baseVersionId);
    const transitions = await this.listTransitionsByVersion(baseVersionId);
    const nodeIdMap = new Map();

    for (const node of nodes) {
      const created = await this.createNode(
        {
          flowVersionId: targetVersionId,
          nodeKey: node.nodeKey,
          type: node.type,
          message: node.message,
          title: node.title,
          metadataJson: node.metadataJson,
          positionX: node.positionX,
          positionY: node.positionY,
        },
        { transaction },
      );
      nodeIdMap.set(node.id, created.id);
    }

    for (const trans of transitions) {
      const sourceNode = nodes.find((n) => n.nodeKey === trans.sourceNodeKey);
      if (!sourceNode) continue;
      const newNodeId = nodeIdMap.get(sourceNode.id);
      if (!newNodeId) continue;
      await this.createTransition(
        {
          flowNodeId: newNodeId,
          type: trans.type,
          value: trans.value,
          nextNodeKey: trans.nextNodeKey,
          priority: trans.priority,
          metadataJson: trans.metadataJson,
        },
        { transaction },
      );
    }
  }

  async getVersionGraph(versionId) {
    const version = await this.getVersionById(versionId);
    if (!version) return null;
    const flow = await this.getFlowById(version.flowId);
    const nodes = await this.listNodes(versionId);
    const transitions = await this.listTransitionsByVersion(versionId);
    const snapshot = await this.getLatestSnapshot(versionId);
    return { flow, version, nodes, transitions, snapshot };
  }

  async getSnapshotByFlowAndVersionLabel(flowKey, versionLabel) {
    const { rows } = await query(
      `SELECT TOP (1) s.snapshot_json, s.checksum, fv.version_label, fv.version_number, fv.status
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
      snapshotJson: rows[0].snapshot_json,
      checksum: rows[0].checksum,
      versionLabel: rows[0].version_label,
      versionNumber: rows[0].version_number,
      status: rows[0].status,
    };
  }
}

const flowCatalogRepository = new FlowCatalogRepository();
export default flowCatalogRepository;
