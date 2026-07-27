import { SOURCE_PRIORITY_INDEX } from './classification.constants.js';
import conversationClassificationRepository from '../../repositories/conversation-classification.repository.js';

function shouldReplace(existing, incoming) {
  if (!existing) return true;
  if (existing.source === 'manual') return false;
  if (incoming.source === 'manual') return true;

  const existingPriority = SOURCE_PRIORITY_INDEX[existing.source] ?? 99;
  const incomingPriority = SOURCE_PRIORITY_INDEX[incoming.source] ?? 99;
  if (incomingPriority < existingPriority) return true;
  if (incomingPriority > existingPriority) return false;
  return (incoming.confidence || 0) >= (existing.confidence || 0);
}

class ClassificationPersistenceService {
  isEnabled() {
    return conversationClassificationRepository.isEnabled();
  }

  async getActiveClassification(conversationId) {
    if (!this.isEnabled() || !conversationId) return null;
    return conversationClassificationRepository.findActiveByConversationId(conversationId);
  }

  async persistClassification(conversationId, classification, options = {}) {
    if (!this.isEnabled() || !conversationId || !classification) {
      return { persisted: false, reason: 'disabled_or_missing' };
    }

    if (options.force !== true) {
      const existing = await this.getActiveClassification(conversationId);
      if (existing && !shouldReplace(existing, classification)) {
        return { persisted: false, reason: 'lower_priority', existing };
      }
    }

    await conversationClassificationRepository.deactivateActive(conversationId);
    const saved = await conversationClassificationRepository.insertClassification({
      conversationId,
      classifierVersion: classification.classifierVersion,
      primaryQuery: classification.primaryQuery,
      modality: classification.modality,
      programType: classification.programType,
      programName: classification.programName,
      specificReason: classification.specificReason,
      responsibleArea: classification.responsibleArea,
      source: classification.source,
      confidence: classification.confidence,
      matchedRule: classification.matchedRule,
      matchedNode: classification.matchedNode,
      flowId: classification.flowId,
      flowVersion: classification.flowVersion,
      classifiedAt: classification.classifiedAt,
    });

    return { persisted: true, classification: saved };
  }
}

const classificationPersistenceService = new ClassificationPersistenceService();
export default classificationPersistenceService;
