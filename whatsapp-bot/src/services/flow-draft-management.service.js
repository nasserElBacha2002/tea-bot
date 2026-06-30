import { withTransaction } from '../db/index.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import flowCatalogRepository from '../repositories/flow-catalog.repository.js';
import flowDbRepository from '../repositories/flow-db.repository.js';
import flowPublishDbService from './flow-publish-db.service.js';
import auditLogService from './audit-log.service.js';
import { flowAppError } from '../utils/flow-management-errors.js';

class FlowDraftManagementService {
  async ensureDb() {
    const ready = await ensureConversationDbReady();
    if (!ready.ok) {
      throw flowAppError('FLOW_DB_UNAVAILABLE', ready.message, 503, ready);
    }
  }

  async createDraftFromVersion(flowId, baseVersionId, { actorUserId = null } = {}) {
    await this.ensureDb();
    const flow = await flowCatalogRepository.getFlowById(flowId);
    if (!flow) throw flowAppError('FLOW_NOT_FOUND', undefined, 404);

    const base = await flowCatalogRepository.getVersionById(baseVersionId);
    if (!base || base.flowId !== flowId) {
      throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    }

    const existingDraft = await flowCatalogRepository.getLatestDraftVersion(flowId);
    if (existingDraft) {
      throw flowAppError('FLOW_DRAFT_ALREADY_EXISTS', undefined, 409, {
        draftVersionId: existingDraft.id,
      });
    }

    const nextNumber = (await flowCatalogRepository.getMaxVersionNumber(flowId)) + 1;
    const versionLabel = `v${nextNumber}`;

    const draft = await withTransaction(async (transaction) => {
      const created = await flowCatalogRepository.createVersion(
        {
          flowId,
          versionNumber: nextNumber,
          versionLabel,
          status: 'draft',
          entryNodeKey: base.entryNodeKey,
          fallbackNodeKey: base.fallbackNodeKey,
          metadataJson: base.metadataJson,
        },
        { transaction },
      );
      await flowCatalogRepository.copyVersionContent(baseVersionId, created.id, {
        transaction,
      });
      return created;
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: draft.id,
      action: 'CREATE_DRAFT',
      afterJson: { flowId, baseVersionId, draftVersionId: draft.id },
    });

    return draft;
  }

  /**
   * Reemplaza el contenido del borrador actual con una versión publicada (o cualquier base),
   * sin crear una nueva fila de versión ni incrementar el número.
   */
  async replaceDraftFromVersion(flowId, baseVersionId, { actorUserId = null } = {}) {
    await this.ensureDb();
    const flow = await flowCatalogRepository.getFlowById(flowId);
    if (!flow) throw flowAppError('FLOW_NOT_FOUND', undefined, 404);

    const base = await flowCatalogRepository.getVersionById(baseVersionId);
    if (!base || base.flowId !== flowId) {
      throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    }

    const draft = await flowCatalogRepository.getLatestDraftVersion(flowId);
    if (!draft) {
      return this.createDraftFromVersion(flowId, baseVersionId, { actorUserId });
    }

    const sourceNodes = await flowCatalogRepository.listNodes(baseVersionId);
    const sourceTransitions = await flowCatalogRepository.listTransitionsByVersion(baseVersionId);

    await withTransaction(async (transaction) => {
      await flowCatalogRepository.updateVersion(
        draft.id,
        {
          entryNodeKey: base.entryNodeKey,
          fallbackNodeKey: base.fallbackNodeKey,
          metadataJson: base.metadataJson,
        },
        { transaction },
      );
      await flowDbRepository.deleteVersionChildren(draft.id, { transaction });
      await flowCatalogRepository.copyVersionContent(baseVersionId, draft.id, {
        transaction,
        nodes: sourceNodes,
        transitions: sourceTransitions,
      });
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: draft.id,
      action: 'REPLACE_DRAFT_FROM_VERSION',
      afterJson: { flowId, baseVersionId, draftVersionId: draft.id },
    });

    return draft;
  }

  async discardDraft(versionId, { actorUserId = null } = {}) {
    await this.ensureDb();
    const version = await flowCatalogRepository.getVersionById(versionId);
    if (!version) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    if (version.status !== 'draft') {
      throw flowAppError('FLOW_VERSION_NOT_DRAFT', undefined, 400);
    }

    await withTransaction(async (transaction) => {
      await flowCatalogRepository.deleteDraftVersion(versionId, { transaction });
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: versionId,
      action: 'DISCARD_DRAFT',
      beforeJson: { versionId, flowId: version.flowId },
    });
  }

  async rollback(versionId, { publishImmediately = false, actorUserId = null } = {}) {
    await this.ensureDb();
    const source = await flowCatalogRepository.getVersionById(versionId);
    if (!source) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);

    const draft = await this.createDraftFromVersion(source.flowId, versionId, {
      actorUserId,
    });

    if (!publishImmediately) {
      await auditLogService.record({
        actorUserId,
        entityType: 'flow_version',
        entityId: draft.id,
        action: 'ROLLBACK_FLOW_VERSION',
        afterJson: { sourceVersionId: versionId, draftVersionId: draft.id },
      });
      return { draft, published: null };
    }

    const published = await flowPublishDbService.publishDraft(draft.id, { actorUserId });
    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: draft.id,
      action: 'ROLLBACK_FLOW_VERSION',
      afterJson: { sourceVersionId: versionId, publishedVersionId: draft.id, immediate: true },
    });
    return { draft: published.version, published: published.version, validation: published.validation };
  }
}

const flowDraftManagementService = new FlowDraftManagementService();
export default flowDraftManagementService;
