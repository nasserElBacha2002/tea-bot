import { CLASSIFIER_VERSION, EXPORT_DISPLAY_FALLBACK } from './classification.constants.js';

/**
 * Legacy inference preserved for shadow comparison.
 * @param {Record<string, unknown>} answers
 * @param {string[]} visitedNodes
 * @returns {import('./classification.types.js').ConversationClassification}
 */
export function classifyLegacy(answers = {}, visitedNodes = []) {
  if (answers?.consulta_principal) {
    return buildLegacyResult(String(answers.consulta_principal), 'explicit_track', 0.7, 'legacy.explicit_answer');
  }

  const nodes = Array.isArray(visitedNodes) ? visitedNodes.map((item) => String(item).toLowerCase()) : [];
  const route = nodes.join(' ');

  if (nodes.includes('si_dist_menu') || /dist|distancia|online|virtual/.test(route)) {
    return buildLegacyResult('Carreras a distancia', 'legacy_inference', 0.6, 'legacy.dist_route');
  }
  if (route.includes('si_presenciales_tipo')) {
    return buildLegacyResult('Cursos presenciales', 'legacy_inference', 0.6, 'legacy.si_presenciales_tipo');
  }
  if (route.includes('direccion') || route.includes('sede') || route.includes('ubicacion')) {
    return buildLegacyResult('Información institucional', 'legacy_inference', 0.55, 'legacy.direccion_route');
  }

  return buildLegacyResult(null, 'fallback', 0, 'legacy.no_evidence');
}

function buildLegacyResult(primaryQuery, source, confidence, matchedRule) {
  return {
    primaryQuery,
    modality: primaryQuery === 'Carreras a distancia' ? 'distancia' : null,
    programType: primaryQuery === 'Cursos presenciales' ? 'curso' : null,
    programName: null,
    specificReason: null,
    responsibleArea: null,
    source,
    confidence,
    matchedRule,
    matchedNode: null,
    flowId: null,
    flowVersion: null,
    classifiedAt: new Date().toISOString(),
    classifierVersion: 'legacy-v1',
  };
}

export function legacyPrimaryQueryDisplay(classification) {
  return classification?.primaryQuery || EXPORT_DISPLAY_FALLBACK;
}

export { CLASSIFIER_VERSION };
