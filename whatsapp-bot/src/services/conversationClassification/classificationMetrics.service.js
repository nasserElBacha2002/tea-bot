import { config } from '../../config.js';

class ClassificationMetricsService {
  constructor() {
    this.counters = {
      conversation_classification_total: 0,
      conversation_classification_fallback_total: 0,
      conversation_classification_by_source: {},
      conversation_classification_by_flow_version: {},
      conversation_classification_confidence_bucket: {
        '0.0': 0,
        '0.1-0.5': 0,
        '0.5-0.8': 0,
        '0.8-1.0': 0,
      },
      conversation_classification_changed_total: 0,
      conversation_sheet_append_total: 0,
      conversation_sheet_update_total: 0,
      conversation_sheet_duplicate_prevented_total: 0,
    };
  }

  bucketConfidence(confidence) {
    const value = Number(confidence || 0);
    if (value <= 0) return '0.0';
    if (value < 0.5) return '0.1-0.5';
    if (value < 0.8) return '0.5-0.8';
    return '0.8-1.0';
  }

  recordClassification(classification, { flowVersion = null, shadowDiff = false } = {}) {
    if (!config.conversationClassificationMetricsEnabled) return;
    this.counters.conversation_classification_total += 1;
    const source = classification?.source || 'fallback';
    this.counters.conversation_classification_by_source[source] =
      (this.counters.conversation_classification_by_source[source] || 0) + 1;
    if (flowVersion) {
      this.counters.conversation_classification_by_flow_version[flowVersion] =
        (this.counters.conversation_classification_by_flow_version[flowVersion] || 0) + 1;
    }
    const bucket = this.bucketConfidence(classification?.confidence);
    this.counters.conversation_classification_confidence_bucket[bucket] += 1;
    if (source === 'fallback') this.counters.conversation_classification_fallback_total += 1;
    if (shadowDiff) this.counters.conversation_classification_changed_total += 1;
  }

  recordSheetOperation(operation, { duplicatePrevented = false } = {}) {
    if (!config.conversationClassificationMetricsEnabled) return;
    if (operation === 'append') this.counters.conversation_sheet_append_total += 1;
    if (operation === 'update') this.counters.conversation_sheet_update_total += 1;
    if (duplicatePrevented) this.counters.conversation_sheet_duplicate_prevented_total += 1;
  }

  snapshot() {
    return { ...this.counters, conversation_classification_by_source: { ...this.counters.conversation_classification_by_source } };
  }
}

const classificationMetricsService = new ClassificationMetricsService();
export default classificationMetricsService;
