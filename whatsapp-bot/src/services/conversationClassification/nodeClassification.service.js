import { CLASSIFIER_VERSION } from './classification.constants.js';
import {
  accumulateNodeDimensions,
  buildDetalleFromDimensions,
  buildPrimaryQueryFromDimensions,
} from './classification.rules.js';

/**
 * @param {import('./classification.types.js').ClassificationInput} input
 * @returns {import('./classification.types.js').ConversationClassification | null}
 */
export function classifyFromExplicitTrack(input) {
  const answers = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const hasExplicit =
    answers.consulta_principal
    || answers.modalidad
    || answers.modalidad_consulta
    || answers.programa
    || answers.program_type
    || answers.motivo
    || answers.detalle_consulta;

  if (!hasExplicit) return null;

  const modalityRaw = String(answers.modalidad || answers.modalidad_consulta || '').trim().toLowerCase();
  const modality =
    modalityRaw.includes('dist') ? 'distancia'
      : modalityRaw.includes('pres') ? 'presencial'
        : null;

  const programNameRaw = String(answers.programa || '').trim().toLowerCase();
  const programName =
    programNameRaw.includes('deport') ? 'periodismo_deportivo'
      : programNameRaw.includes('general') ? 'periodismo_general'
        : programNameRaw || null;

  const dimensions = {
    modality,
    programType: answers.program_type ? String(answers.program_type) : null,
    programName,
    specificReason: answers.motivo ? String(answers.motivo) : null,
  };

  const primaryQuery =
    answers.consulta_principal
      ? String(answers.consulta_principal)
      : buildPrimaryQueryFromDimensions(dimensions);

  if (!primaryQuery && !dimensions.modality && !dimensions.programType) return null;

  return {
    primaryQuery: primaryQuery || null,
    modality: dimensions.modality || null,
    programType: dimensions.programType || null,
    programName: dimensions.programName || null,
    specificReason: dimensions.specificReason || null,
    responsibleArea: null,
    source: 'explicit_track',
    confidence: 0.98,
    matchedRule: 'answers.explicit_track',
    matchedNode: null,
    flowId: input.flowId || null,
    flowVersion: input.flowVersion || null,
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}

/**
 * @param {import('./classification.types.js').ClassificationInput} input
 * @returns {import('./classification.types.js').ConversationClassification | null}
 */
export function classifyFromNodeRoute(input) {
  const visitedNodes = Array.isArray(input.visitedNodes) ? input.visitedNodes : [];
  if (visitedNodes.length === 0) return null;

  const dimensions = accumulateNodeDimensions(
    visitedNodes,
    input.flowId || 'main-menu',
    input.flowVersion || null,
  );

  if (!dimensions.matchedNode) return null;

  const primaryQuery = buildPrimaryQueryFromDimensions(dimensions);
  const hasSignal =
    primaryQuery
    || dimensions.modality
    || dimensions.programType
    || dimensions.programName
    || dimensions.specificReason
    || dimensions.responsibleArea;

  if (!hasSignal) return null;

  return {
    primaryQuery,
    modality: dimensions.modality || null,
    programType: dimensions.programType || null,
    programName: dimensions.programName || null,
    specificReason: dimensions.specificReason || null,
    responsibleArea: dimensions.responsibleArea || null,
    source: 'node_route',
    confidence: 0.95,
    matchedRule: dimensions.matchedRule || null,
    matchedNode: dimensions.matchedNode || null,
    flowId: input.flowId || null,
    flowVersion: input.flowVersion || null,
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}

export function buildDetalleConsultaFromClassification(classification) {
  if (!classification) return null;
  return buildDetalleFromDimensions(classification);
}

export { buildPrimaryQueryFromDimensions, buildDetalleFromDimensions };
