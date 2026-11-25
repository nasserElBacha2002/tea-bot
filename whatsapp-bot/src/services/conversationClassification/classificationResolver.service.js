import { config } from '../../config.js';
import {
  CLASSIFIER_VERSION,
  EXPORT_DISPLAY_FALLBACK,
  SOURCE_PRIORITY_INDEX,
} from './classification.constants.js';
import { classifyLegacy } from './legacyInference.service.js';
import { classifyFromExplicitTrack, classifyFromNodeRoute, buildPrimaryQueryFromDimensions } from './nodeClassification.service.js';
import { classifyFromTextRules } from './textClassification.service.js';
import classificationLoggingService from './classificationLogging.service.js';
import classificationMetricsService from './classificationMetrics.service.js';
import { buildDetalleFromDimensions } from './classification.rules.js';
import {
  PROGRAM_NAME_LABELS,
  PROGRAM_TYPE_LABELS,
  SPECIFIC_REASON_LABELS,
} from './classification.constants.js';

function emptyFallback(input) {
  return {
    primaryQuery: null,
    modality: null,
    programType: null,
    programName: null,
    specificReason: null,
    responsibleArea: null,
    source: 'fallback',
    confidence: 0,
    matchedRule: 'no_evidence',
    matchedNode: null,
    flowId: input.flowId || null,
    flowVersion: input.flowVersion || null,
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}

function mergePartial(base, patch) {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    primaryQuery: patch.primaryQuery || base?.primaryQuery || buildPrimaryQueryFromDimensions(patch) || base?.primaryQuery || null,
    source: patch.source || base?.source || 'fallback',
    confidence: Math.max(base?.confidence || 0, patch.confidence || 0),
    matchedRule: patch.matchedRule || base?.matchedRule || null,
    matchedNode: patch.matchedNode || base?.matchedNode || null,
    classifierVersion: CLASSIFIER_VERSION,
    classifiedAt: new Date().toISOString(),
  };
}

function compareSourcePriority(a, b) {
  const left = SOURCE_PRIORITY_INDEX[a?.source] ?? 99;
  const right = SOURCE_PRIORITY_INDEX[b?.source] ?? 99;
  if (left !== right) return left - right;
  return (b?.confidence || 0) - (a?.confidence || 0);
}

/**
 * @param {import('./classification.types.js').ClassificationInput} input
 * @returns {import('./classification.types.js').ClassificationResolution}
 */
export function resolveConversationClassification(input) {
  const legacyClassification = classifyLegacy(input.answers || {}, input.visitedNodes || []);

  if (input.manualOverride) {
    const classification = {
      ...input.manualOverride,
      source: 'manual',
      classifierVersion: CLASSIFIER_VERSION,
      classifiedAt: new Date().toISOString(),
    };
    return finalizeResolution(input, classification, legacyClassification);
  }

  const candidates = [
    classifyFromExplicitTrack(input),
    classifyFromNodeRoute(input),
  ].filter(Boolean);

  let best = candidates.sort(compareSourcePriority)[0] || null;

  if (config.conversationClassificationTextRulesEnabled) {
    const textPatch = classifyFromTextRules(input, best);
    if (textPatch) {
      if (!best || compareSourcePriority(textPatch, best) <= 0 || (best.confidence || 0) < 0.9) {
        best = mergePartial(best, textPatch);
      } else if (!best.specificReason && textPatch.specificReason) {
        best = mergePartial(best, { ...textPatch, primaryQuery: best.primaryQuery, source: best.source });
      }
    }
  }

  if (!best?.primaryQuery && !best?.modality && !best?.programType && !best?.specificReason) {
    best = emptyFallback(input);
  } else if (!best.primaryQuery) {
    best = {
      ...best,
      primaryQuery: buildPrimaryQueryFromDimensions(best),
    };
  }

  return finalizeResolution(input, best, legacyClassification);
}

function finalizeResolution(input, classification, legacyClassification) {
  const shadowDiff =
    Boolean(classification?.primaryQuery)
    && classification.primaryQuery !== legacyClassification.primaryQuery;

  const resolution = {
    classification,
    legacyClassification,
    shadowDiff,
    shadowReason: shadowDiff ? 'primary_query_diff' : null,
  };

  classificationLoggingService.logClassificationEvent({
    conversationId: input.conversationId,
    classification,
    legacyClassification,
    shadowDiff,
    sheetOperation: null,
  });
  classificationMetricsService.recordClassification(classification, {
    flowVersion: input.flowVersion,
    shadowDiff,
  });

  return resolution;
}

export function pickExportClassification(resolution, mode = config.conversationClassificationMode) {
  if (mode === 'enabled') {
    return resolution.classification;
  }
  return resolution.legacyClassification;
}

export function resolveExportClassification(input) {
  const resolution = resolveConversationClassification(input);
  return {
    ...resolution,
    exportClassification: pickExportClassification(resolution),
  };
}

export function formatPrimaryQueryForExport(classification) {
  return classification?.primaryQuery || EXPORT_DISPLAY_FALLBACK;
}

const MATCHED_NODE_DETALLE_LABELS = {
  si_dist_lic_a: 'Licenciatura A',
  si_dist_lic_b: 'Licenciatura B',
  si_pg_lic_a: 'Licenciatura A',
  si_pg_lic_b: 'Licenciatura B',
  si_pd_lic_a: 'Licenciatura A',
  si_pd_lic_b: 'Licenciatura B',
};

function labelFromMatchedNode(matchedNode) {
  if (!matchedNode) return null;
  const direct = MATCHED_NODE_DETALLE_LABELS[matchedNode];
  if (direct) return direct;
  const match = String(matchedNode).match(/lic_([a-z])$/i);
  if (match) return `Licenciatura ${match[1].toUpperCase()}`;
  return null;
}

function pushUnique(parts, value) {
  const text = String(value || '').trim();
  if (!text) return;
  if (!parts.some((item) => item.toLowerCase() === text.toLowerCase())) {
    parts.push(text);
  }
}

export function formatDetalleForExport(classification) {
  if (!classification) return '—';
  const parts = [];
  const fromDimensions = buildDetalleFromDimensions(classification);
  if (fromDimensions) {
    for (const chunk of fromDimensions.split(' - ')) {
      pushUnique(parts, chunk);
    }
  }

  if (classification.programType === 'posgrado' && classification.programName !== 'periodismo_general') {
    pushUnique(parts, PROGRAM_TYPE_LABELS.posgrado || 'Posgrado');
  }
  if (classification.programType === 'curso') {
    pushUnique(parts, PROGRAM_TYPE_LABELS.curso || 'Curso');
  }
  if (classification.programType === 'licenciatura') {
    const nodeLabel = labelFromMatchedNode(classification.matchedNode);
    if (nodeLabel) {
      pushUnique(parts, nodeLabel);
    } else {
      pushUnique(parts, PROGRAM_TYPE_LABELS.licenciatura || 'Licenciatura');
    }
  }

  if (classification.responsibleArea === 'direccion' || classification.specificReason === 'direccion') {
    pushUnique(parts, 'Dirección');
  }
  if (classification.programName) {
    pushUnique(parts, PROGRAM_NAME_LABELS[classification.programName]
      || classification.programName.replace(/_/g, ' '));
  }
  if (classification.specificReason) {
    pushUnique(
      parts,
      SPECIFIC_REASON_LABELS[classification.specificReason] || classification.specificReason,
    );
  }

  return parts.length > 0 ? parts.join(' - ') : '—';
}
