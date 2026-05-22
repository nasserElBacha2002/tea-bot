import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import flowCatalogRepository from '../repositories/flow-catalog.repository.js';
import flowDraftManagementService from './flow-draft-management.service.js';
import flowPublishDbService from './flow-publish-db.service.js';
import flowValidationManagementService from './flow-validation-management.service.js';
import auditLogService from './audit-log.service.js';
import flowValidator from '../utils/flow-validator.js';
import { flowAppError } from '../utils/flow-management-errors.js';

class FlowManagementService {
  async ensureDb() {
    const ready = await ensureConversationDbReady();
    if (!ready.ok) {
      throw flowAppError('FLOW_DB_UNAVAILABLE', ready.message, 503, ready);
    }
  }

  async assertDraftVersion(versionId) {
    const version = await flowCatalogRepository.getVersionById(versionId);
    if (!version) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);
    if (version.status !== 'draft') {
      throw flowAppError('FLOW_VERSION_NOT_DRAFT', undefined, 400);
    }
    return version;
  }

  async listFlows() {
    await this.ensureDb();
    const items = await flowCatalogRepository.listFlows();
    return { items };
  }

  async getFlowDetail(flowId) {
    await this.ensureDb();
    const flow = await flowCatalogRepository.getFlowById(flowId);
    if (!flow) throw flowAppError('FLOW_NOT_FOUND', undefined, 404);

    const published = await flowCatalogRepository.getLatestPublishedVersion(flowId);
    const draft = await flowCatalogRepository.getLatestDraftVersion(flowId);
    const versions = await flowCatalogRepository.listVersions(flowId);

    let nodesCount = 0;
    let transitionsCount = 0;
    if (published) {
      nodesCount = await flowCatalogRepository.countNodes(published.id);
      transitionsCount = await flowCatalogRepository.countTransitions(published.id);
    }

    return {
      flow,
      publishedVersion: published,
      draftVersion: draft,
      versionsCount: versions.length,
      nodesCount,
      transitionsCount,
    };
  }

  async listFlowVersions(flowId) {
    await this.ensureDb();
    const flow = await flowCatalogRepository.getFlowById(flowId);
    if (!flow) throw flowAppError('FLOW_NOT_FOUND', undefined, 404);
    const items = await flowCatalogRepository.listVersions(flowId);
    return { flow, items };
  }

  async getVersionDetail(versionId) {
    await this.ensureDb();
    const graph = await flowCatalogRepository.getVersionGraph(versionId);
    if (!graph) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);

    const validation = await flowValidationManagementService.validateVersion(versionId);

    return {
      version: graph.version,
      flow: graph.flow,
      nodes: graph.nodes,
      transitions: graph.transitions,
      snapshot: graph.snapshot
        ? {
            checksum: graph.snapshot.checksum,
            createdAt: graph.snapshot.createdAt,
          }
        : null,
      validation,
    };
  }

  async getVersionSnapshot(versionId) {
    await this.ensureDb();
    const version = await flowCatalogRepository.getVersionById(versionId);
    if (!version) throw flowAppError('FLOW_VERSION_NOT_FOUND', undefined, 404);

    let snapshot = await flowCatalogRepository.getLatestSnapshot(versionId);
    if (!snapshot) {
      const generated = await flowPublishDbService.generateSnapshotFromVersion(versionId);
      snapshot = {
        snapshotJson: generated.snapshotJson,
        checksum: generated.checksum,
        createdAt: null,
      };
    }

    let parsed;
    try {
      parsed =
        typeof snapshot.snapshotJson === 'string'
          ? JSON.parse(snapshot.snapshotJson)
          : snapshot.snapshotJson;
    } catch {
      throw flowAppError('FLOW_SNAPSHOT_GENERATION_FAILED', undefined, 500);
    }

    return {
      versionId,
      checksum: snapshot.checksum,
      createdAt: snapshot.createdAt,
      snapshot: parsed,
    };
  }

  async updateVersionMetadata(versionId, patch, { actorUserId = null } = {}) {
    await this.assertDraftVersion(versionId);
    const before = await flowCatalogRepository.getVersionById(versionId);
    const updated = await flowCatalogRepository.updateVersion(versionId, {
      entryNodeKey: patch.entryNodeKey,
      fallbackNodeKey: patch.fallbackNodeKey,
      metadataJson: patch.metadata,
    });
    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: versionId,
      action: 'UPDATE_FLOW_VERSION',
      beforeJson: before,
      afterJson: updated,
    });
    return updated;
  }

  async createNode(versionId, body, { actorUserId = null } = {}) {
    const version = await this.assertDraftVersion(versionId);
    const existing = await flowCatalogRepository.getNodeByKey(versionId, body.nodeKey);
    if (existing) throw flowAppError('FLOW_NODE_KEY_DUPLICATED', undefined, 409);

    if (!body.type || !flowValidator.supportedTypes.includes(body.type)) {
      throw flowAppError('FLOW_NODE_TYPE_UNSUPPORTED', undefined, 400);
    }

    const node = await flowCatalogRepository.createNode({
      flowVersionId: versionId,
      nodeKey: body.nodeKey,
      type: body.type,
      message: body.message ?? null,
      title: body.title ?? null,
      metadataJson: body.metadata ?? null,
      positionX: body.positionX ?? null,
      positionY: body.positionY ?? null,
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_node',
      entityId: node.id,
      action: 'CREATE_FLOW_NODE',
      afterJson: node,
      metadata: { flowId: version.flowId, versionId },
    });
    return node;
  }

  async updateNode(nodeId, patch, { actorUserId = null } = {}) {
    const node = await flowCatalogRepository.getNodeById(nodeId);
    if (!node) throw flowAppError('FLOW_NODE_NOT_FOUND', undefined, 404);
    await this.assertDraftVersion(node.flowVersionId);

    if (patch.type && !flowValidator.supportedTypes.includes(patch.type)) {
      throw flowAppError('FLOW_NODE_TYPE_UNSUPPORTED', undefined, 400);
    }

    const before = node;
    const updated = await flowCatalogRepository.updateNode(nodeId, {
      type: patch.type,
      message: patch.message,
      title: patch.title,
      metadataJson: patch.metadata,
      positionX: patch.positionX,
      positionY: patch.positionY,
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_node',
      entityId: nodeId,
      action: 'UPDATE_FLOW_NODE',
      beforeJson: before,
      afterJson: updated,
    });
    return updated;
  }

  async deleteNode(nodeId) {
    const node = await flowCatalogRepository.getNodeById(nodeId);
    if (!node) throw flowAppError('FLOW_NODE_NOT_FOUND', undefined, 404);
    const version = await this.assertDraftVersion(node.flowVersionId);
    const graph = await flowCatalogRepository.getVersionGraph(version.id);

    if (node.nodeKey === version.entryNodeKey) {
      throw flowAppError('FLOW_CANNOT_DELETE_ENTRY', undefined, 400);
    }
    if (version.fallbackNodeKey && node.nodeKey === version.fallbackNodeKey) {
      throw flowAppError('FLOW_CANNOT_DELETE_FALLBACK', undefined, 400);
    }

    const refs = await flowCatalogRepository.findReferencesToNode(version.id, node.nodeKey);
    if (refs.length > 0) {
      throw flowAppError('FLOW_NODE_REFERENCED_BY_TRANSITIONS', undefined, 409, { transitions: refs });
    }

    await flowCatalogRepository.deleteNode(nodeId);
    await auditLogService.record({
      entityType: 'flow_node',
      entityId: nodeId,
      action: 'DELETE_FLOW_NODE',
      beforeJson: node,
      metadata: { flowId: graph.flow.id },
    });
  }

  async createTransition(nodeId, body, { actorUserId = null } = {}) {
    const node = await flowCatalogRepository.getNodeById(nodeId);
    if (!node) throw flowAppError('FLOW_NODE_NOT_FOUND', undefined, 404);
    const version = await this.assertDraftVersion(node.flowVersionId);

    const target = await flowCatalogRepository.getNodeByKey(version.id, body.nextNodeKey);
    if (!target) throw flowAppError('FLOW_TRANSITION_TARGET_MISSING', undefined, 400);

    if (body.type && !flowValidator.supportedTransitions.includes(body.type)) {
      throw flowAppError('FLOW_TRANSITION_TYPE_UNSUPPORTED', undefined, 400);
    }

    const transition = await flowCatalogRepository.createTransition({
      flowNodeId: nodeId,
      type: body.type,
      value: body.value ?? null,
      nextNodeKey: body.nextNodeKey,
      priority: body.priority ?? 0,
      metadataJson: body.metadata ?? null,
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_transition',
      entityId: transition.id,
      action: 'CREATE_FLOW_TRANSITION',
      afterJson: transition,
    });
    return transition;
  }

  async updateTransition(transitionId, patch, { actorUserId = null } = {}) {
    const transition = await flowCatalogRepository.getTransitionById(transitionId);
    if (!transition) throw flowAppError('FLOW_TRANSITION_NOT_FOUND', undefined, 404);

    const node = await flowCatalogRepository.getNodeById(transition.flowNodeId);
    const version = await this.assertDraftVersion(node.flowVersionId);

    if (patch.nextNodeKey) {
      const target = await flowCatalogRepository.getNodeByKey(version.id, patch.nextNodeKey);
      if (!target) throw flowAppError('FLOW_TRANSITION_TARGET_MISSING', undefined, 400);
    }

    if (patch.type && !flowValidator.supportedTransitions.includes(patch.type)) {
      throw flowAppError('FLOW_TRANSITION_TYPE_UNSUPPORTED', undefined, 400);
    }

    const updated = await flowCatalogRepository.updateTransition(transitionId, {
      type: patch.type,
      value: patch.value,
      nextNodeKey: patch.nextNodeKey,
      priority: patch.priority,
      metadataJson: patch.metadata,
    });

    await auditLogService.record({
      actorUserId,
      entityType: 'flow_transition',
      entityId: transitionId,
      action: 'UPDATE_FLOW_TRANSITION',
      beforeJson: transition,
      afterJson: updated,
    });
    return updated;
  }

  async deleteTransition(transitionId, { actorUserId = null } = {}) {
    const transition = await flowCatalogRepository.getTransitionById(transitionId);
    if (!transition) throw flowAppError('FLOW_TRANSITION_NOT_FOUND', undefined, 404);
    const node = await flowCatalogRepository.getNodeById(transition.flowNodeId);
    await this.assertDraftVersion(node.flowVersionId);
    await flowCatalogRepository.deleteTransition(transitionId);
    await auditLogService.record({
      actorUserId,
      entityType: 'flow_transition',
      entityId: transitionId,
      action: 'DELETE_FLOW_TRANSITION',
      beforeJson: transition,
    });
  }

  async validateVersion(versionId, { actorUserId = null } = {}) {
    await this.ensureDb();
    const result = await flowValidationManagementService.validateVersion(versionId);
    await auditLogService.record({
      actorUserId,
      entityType: 'flow_version',
      entityId: versionId,
      action: 'VALIDATE_FLOW_VERSION',
      afterJson: result,
    });
    return result;
  }

  createDraft(flowId, baseVersionId, opts) {
    return flowDraftManagementService.createDraftFromVersion(flowId, baseVersionId, opts);
  }

  discardDraft(versionId, opts) {
    return flowDraftManagementService.discardDraft(versionId, opts);
  }

  publishDraft(versionId, opts) {
    return flowPublishDbService.publishDraft(versionId, opts);
  }

  rollback(versionId, opts) {
    return flowDraftManagementService.rollback(versionId, opts);
  }
}

const flowManagementService = new FlowManagementService();
export default flowManagementService;
