/**
 * @typedef {'presencial' | 'distancia' | null} ClassificationModality
 */

/**
 * @typedef {'carrera' | 'curso' | 'licenciatura' | 'posgrado' | null} ClassificationProgramType
 */

/**
 * @typedef {
 *   'informes' | 'charla' | 'aranceles' | 'inscripcion' | 'becas' | 'certificado' | 'diploma'
 *   | 'secretaria' | 'administracion' | 'direccion' | 'archivo' | 'rrhh' | 'prensa'
 *   | 'ubicacion' | 'visita' | 'otro' | null
 * } ClassificationSpecificReason
 */

/**
 * @typedef {
 *   'explicit_track' | 'node_route' | 'transition_trail' | 'message_rules'
 *   | 'legacy_inference' | 'manual' | 'fallback'
 * } ClassificationSource
 */

/**
 * @typedef {Object} ConversationClassification
 * @property {string | null} primaryQuery
 * @property {ClassificationModality} modality
 * @property {ClassificationProgramType} programType
 * @property {string | null} programName
 * @property {ClassificationSpecificReason} specificReason
 * @property {string | null} responsibleArea
 * @property {ClassificationSource} source
 * @property {number} confidence
 * @property {string | null} matchedRule
 * @property {string | null} matchedNode
 * @property {string | null} flowId
 * @property {string | null} flowVersion
 * @property {string} classifiedAt
 * @property {string} classifierVersion
 */

/**
 * @typedef {Object} ClassificationInput
 * @property {string | null} [conversationId]
 * @property {string | null} [flowId]
 * @property {string | null} [flowVersion]
 * @property {Record<string, unknown>} [answers]
 * @property {string[]} [visitedNodes]
 * @property {Array<{ from?: string, to?: string, label?: string }>} [transitionTrail]
 * @property {string[]} [userMessages]
 * @property {ConversationClassification | null} [existingClassification]
 * @property {ConversationClassification | null} [manualOverride]
 */

/**
 * @typedef {Object} ClassificationResolution
 * @property {ConversationClassification} classification
 * @property {ConversationClassification | null} legacyClassification
 * @property {boolean} shadowDiff
 * @property {string | null} shadowReason
 */

export {};
