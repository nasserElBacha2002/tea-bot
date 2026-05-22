import { withTransaction } from '../db/index.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import flowCatalogRepository from '../repositories/flow-catalog.repository.js';
import flowValidationManagementService from './flow-validation-management.service.js';
import auditLogService from './audit-log.service.js';
import { buildSnapshotPayload } from '../utils/flow-snapshot-builder.js';
import { flowAppError } from '../utils/flow-management-errors.js';
import flowLoader from '../utils/flow-loader.js';

function buildTransitionsMap(nodes, transitions) {
  const byKey = new Map(nodes.map((n) => [n.nodeKey, []]));
  for (const t of transitions) {
    const list = byKey.get(t.sourceNodeKey) || [];
    list.push(t);
    byKey.set(t.sourceNodeKey, list);
  }
  return byKey;
}

class FlowPublishDbService {
  async ensureDb() {
    const ready = await ensureConversationDbReady();
    if (!ready.ok) {
      throw flowAppError('FLOW_DB_UNAVAILABLE', ready.message, 503, ready);
    }
  }

  async generateSnapshotFromVersion(versionId) {
    const graph = await flowCatalogRepository.getVersionGraph(versionId);
    if (!graph) {
      throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    }
    const byKey = buildTransitionsMap(graph.nodes, graph.transitions);
    try {
      return buildSnapshotPayload(graph.flow, graph.version, graph.nodes, byKey);
    } catch (err) {
      throw flowAppError(
        'FLOW_SNAPSHOT_GENERATION_FAILED',
        err.message,
        500,
      );
    }
  }

  async publishDraft(versionId, { actorUserId = null } = {}) {
    await this.ensureDb();
    const version = await flowCatalogRepository.getVersionById(versionId);
    if (!version) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    if (version.status !== 'draft') {
      throw flowAppError('FLOW_VERSION_NOT_DRAFT', undefined, 400);
    }

    const validation = await flowValidationManagementService.validateVersion(versionId);
    if (!validation.valid) {
      throw flowAppError(
        'FLOW_PUBLISH_VALIDATION_FAILED',
        undefined,
        400,
        validation,
      );
    }

    const flow = await flowCatalogRepository.getFlowById(version.flowId);
    const graph = await flowCatalogRepository.getVersionGraph(versionId);
    const byKey = buildTransitionsMap(graph.nodes, graph.transitions);
    const { snapshotJson, checksum } = buildSnapshotPayload(
      flow,
      version,
      graph.nodes,
      byKey,
    );

    const published = await withTransaction(async (transaction) => {
      const currentPublished = await flowCatalogRepository.getLatestPublishedVersion(
        version.flowId,
      );
      if (currentPublished) {
        await flowCatalogRepository.archivePublishedVersions(version.flowId, null, {
          transaction,
        });
      }

      await flowCatalogRepository.createSnapshot(versionId, snapshotJson, checksum, {
        transaction,
      });

      const updated = await flowCatalogRepository.updateVersion(
        versionId,
        {
          status: 'published',
          publishedAt: new Date(),
        },
        { transaction },
      );

      return updated;
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: versionId,
      action: 'PUBLISH_FLOW_VERSION',
      afterJson: { versionId, checksum, flowKey: flow.flowKey },
    });

    try {
      await flowLoader.reloadFlow(flow.flowKey);
    } catch (err) {
      console.warn(`[FlowPublish] Runtime reload falló: ${err.message}`);
    }

    return { version: published, validation };
  }
}

const flowPublishDbService = new FlowPublishDbService();
export default flowPublishDbService;
