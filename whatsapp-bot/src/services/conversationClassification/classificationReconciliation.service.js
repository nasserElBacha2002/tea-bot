import conversationMessageRepository from '../../repositories/conversation-message.repository.js';
import conversationClassificationRepository from '../../repositories/conversation-classification.repository.js';
import {
  pickExportClassification,
  resolveConversationClassification,
} from './classificationResolver.service.js';
import classificationPersistenceService from './classificationPersistence.service.js';

function buildTrackingFromSession(session) {
  return {
    answers: session?.answers || {},
    visitedNodes: session?.visitedNodes || [],
    transitionTrail: session?.transitionTrail || [],
    flowId: session?.flowId || null,
    flowVersion: session?.flowVersion || null,
  };
}

export function buildClassificationInputFromSession(session, conversationId = null, userMessages = []) {
  return {
    conversationId,
    flowId: session?.flowId || null,
    flowVersion: session?.flowVersion || null,
    answers: session?.answers || {},
    visitedNodes: session?.visitedNodes || [],
    transitionTrail: session?.transitionTrail || [],
    userMessages,
  };
}

export async function loadUserMessagesForConversation(conversationId, limit = 20) {
  if (!conversationId) return [];
  const messages = await conversationMessageRepository.listByConversationId(conversationId, { limit: 200 });
  return messages
    .filter((msg) => msg.direction === 'inbound' && msg.senderType === 'user')
    .slice(-limit)
    .map((msg) => String(msg.body || '').slice(0, 500));
}

class ClassificationReconciliationService {
  async classifySessionForExport(session, conversationId, options = {}) {
    const userMessages =
      options.userMessages
      || (conversationId ? await loadUserMessagesForConversation(conversationId) : []);

    const input = buildClassificationInputFromSession(session, conversationId, userMessages);
    if (conversationId && classificationPersistenceService.isEnabled()) {
      const active = await classificationPersistenceService.getActiveClassification(conversationId);
      if (active?.source === 'manual') {
        input.manualOverride = {
          primaryQuery: active.primaryQuery,
          modality: active.modality,
          programType: active.programType,
          programName: active.programName,
          specificReason: active.specificReason,
          responsibleArea: active.responsibleArea,
          source: 'manual',
          confidence: active.confidence,
          matchedRule: active.matchedRule,
          matchedNode: active.matchedNode,
          flowId: active.flowId,
          flowVersion: active.flowVersion,
          classifiedAt: active.classifiedAt,
          classifierVersion: active.classifierVersion,
        };
      }
    }

    const resolution = resolveConversationClassification(input);

    if (conversationId && classificationPersistenceService.isEnabled() && options.persist !== false) {
      await classificationPersistenceService.persistClassification(
        conversationId,
        resolution.classification,
      );
    }

    return {
      ...resolution,
      exportClassification: pickExportClassification(resolution),
    };
  }

  async reconcileConversation(conversationId, session, options = {}) {
    const resolution = await this.classifySessionForExport(session, conversationId, options);
    return resolution;
  }

  async listUnclassifiedConversationIds(options = {}) {
    if (!conversationClassificationRepository.isEnabled()) return [];
    return conversationClassificationRepository.listUnclassifiedConversationIds(options);
  }

  buildSessionFromDbSession(conversation, dbSession) {
    const tracking = dbSession?.trackingJson && typeof dbSession.trackingJson === 'object'
      ? dbSession.trackingJson
      : {};
    return {
      flowId: dbSession?.flowId || conversation?.currentFlowId || null,
      flowVersion: dbSession?.flowVersion || conversation?.currentFlowVersion || null,
      answers: tracking.answers || {},
      visitedNodes: Array.isArray(tracking.visitedNodes) ? tracking.visitedNodes : [],
      transitionTrail: Array.isArray(tracking.transitionTrail) ? tracking.transitionTrail : [],
      lastUserMessage: tracking.lastUserMessage || '',
      startedAt: tracking.startedAt || conversation?.startedAt || null,
    };
  }
}

const classificationReconciliationService = new ClassificationReconciliationService();
export default classificationReconciliationService;
export { buildTrackingFromSession };
