import {
  GENERIC_NODES,
  PROGRAM_NAME_LABELS,
  PROGRAM_TYPE_LABELS,
  RESPONSIBLE_AREA_LABELS,
  SPECIFIC_REASON_LABELS,
} from './classification.constants.js';

/**
 * Pattern rules derived from main-menu v11 node ids (no_/si_ parity).
 * Version-specific overrides can extend this map.
 */
export const FLOW_CLASSIFICATION_RULES = {
  'main-menu': {
    default: {
      nodePatterns: [
        {
          id: 'presenciales_menu',
          match: /(?:^|_)(presenciales_menu|presenciales_tipo)$/,
          patch: { modality: 'presencial', programType: 'carrera', matchedRule: 'node_family:presenciales' },
        },
        {
          id: 'distancia',
          match: /(?:^|_)(distancia_menu|dist_menu|dist_informes|dist_charla|dist_)/,
          patch: { modality: 'distancia', programType: 'carrera', matchedRule: 'node_family:distancia' },
        },
        {
          id: 'pd',
          match: /(?:^|_)(pd_menu|pd_informes|pd_charla|pd_sec|pd_admin|pd_direccion|pd_lic|pd_)/,
          patch: {
            modality: 'presencial',
            programType: 'carrera',
            programName: 'periodismo_deportivo',
            matchedRule: 'node_family:pd',
          },
        },
        {
          id: 'pg',
          match: /(?:^|_)(pg_menu|pg_informes|pg_charla|pg_sec|pg_admin|pg_direccion|pg_lic|pg_)/,
          patch: {
            modality: 'presencial',
            programType: 'carrera',
            programName: 'periodismo_general',
            matchedRule: 'node_family:pg',
          },
        },
        {
          id: 'cursos',
          match: /(?:^|_)cursos(?:_|$)/,
          patch: { programType: 'curso', matchedRule: 'node_family:cursos' },
        },
        {
          id: 'licenciatura',
          match: /(?:^|_)(licenciatura_info|lic_menu|lic_[ab])$/,
          patch: { programType: 'licenciatura', matchedRule: 'node_family:licenciatura' },
        },
        {
          id: 'posgrado',
          match: /(?:^|_)pg_(menu|direccion)/,
          patch: { programType: 'posgrado', matchedRule: 'node_family:posgrado' },
        },
        {
          id: 'informes',
          match: /_informes$/,
          patch: { specificReason: 'informes', matchedRule: 'node_suffix:informes' },
        },
        {
          id: 'charla',
          match: /_charla$/,
          patch: { specificReason: 'charla', matchedRule: 'node_suffix:charla' },
        },
        {
          id: 'secretaria',
          match: /_sec_/,
          patch: { responsibleArea: 'secretaria', specificReason: 'secretaria', matchedRule: 'node_family:secretaria' },
        },
        {
          id: 'administracion',
          match: /_admin_/,
          patch: {
            responsibleArea: 'administracion',
            specificReason: 'administracion',
            matchedRule: 'node_family:administracion',
          },
        },
        {
          id: 'direccion',
          match: /_direccion$/,
          patch: { responsibleArea: 'direccion', specificReason: 'direccion', matchedRule: 'node_suffix:direccion' },
        },
        {
          id: 'archivo',
          match: /^archivo_info$/,
          patch: { responsibleArea: 'archivo', specificReason: 'archivo', matchedRule: 'node:archivo_info' },
        },
        {
          id: 'rrhh',
          match: /^rrhh_info$/,
          patch: { responsibleArea: 'rrhh', specificReason: 'rrhh', matchedRule: 'node:rrhh_info' },
        },
        {
          id: 'prensa',
          match: /^prensa_info$/,
          patch: { responsibleArea: 'prensa', specificReason: 'prensa', matchedRule: 'node:prensa_info' },
        },
        {
          id: 'streaming',
          match: /^streaming_info$/,
          patch: { specificReason: 'otro', matchedRule: 'node:streaming_info' },
        },
        {
          id: 'camaras',
          match: /^camaras_info$/,
          patch: { specificReason: 'otro', matchedRule: 'node:camaras_info' },
        },
        {
          id: 'otros',
          match: /^no_otros_menu$/,
          patch: { specificReason: 'otro', matchedRule: 'node:no_otros_menu' },
        },
      ],
    },
  },
};

export function getFlowRules(flowId, flowVersion) {
  const flowRules = FLOW_CLASSIFICATION_RULES[flowId];
  if (!flowRules) return null;
  if (flowVersion && flowRules[flowVersion]) return flowRules[flowVersion];
  return flowRules.default || null;
}

export function isGenericNode(nodeId) {
  if (!nodeId) return true;
  const normalized = String(nodeId).trim().toLowerCase();
  if (GENERIC_NODES.has(normalized)) return true;
  if (normalized.endsWith('_menu') && (normalized === 'si_menu' || normalized === 'no_menu')) return true;
  return false;
}

export function findLastSemanticNode(visitedNodes, registry = null) {
  const nodes = Array.isArray(visitedNodes) ? visitedNodes : [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = String(nodes[index] || '').trim();
    if (!node || isGenericNode(node)) continue;
    if (registry?.hasClassification?.(node)) return node;
    if (matchNodePattern(node)) return node;
  }
  return null;
}

export function matchAllNodePatterns(nodeId, flowId = 'main-menu', flowVersion = null) {
  const rules = getFlowRules(flowId, flowVersion);
  if (!rules?.nodePatterns || !nodeId) return [];
  const normalized = String(nodeId).trim().toLowerCase();
  const patches = [];
  for (const pattern of rules.nodePatterns) {
    if (pattern.match.test(normalized)) {
      patches.push({
        ...pattern.patch,
        matchedNode: nodeId,
        matchedRule: pattern.patch.matchedRule || pattern.id,
      });
    }
  }
  return patches;
}

export function matchNodePattern(nodeId, flowId = 'main-menu', flowVersion = null) {
  const patches = matchAllNodePatterns(nodeId, flowId, flowVersion);
  return patches[0] || null;
}

export function accumulateNodeDimensions(visitedNodes, flowId, flowVersion) {
  const nodes = Array.isArray(visitedNodes) ? visitedNodes : [];
  /** @type {Record<string, unknown>} */
  const acc = {};
  let lastMatchedNode = null;
  let lastMatchedRule = null;

  for (const rawNode of nodes) {
    const nodeId = String(rawNode || '').trim();
    if (!nodeId || isGenericNode(nodeId)) continue;
    const patches = matchAllNodePatterns(nodeId, flowId, flowVersion);
    if (patches.length === 0) continue;
    lastMatchedNode = nodeId;
    lastMatchedRule = patches[patches.length - 1].matchedRule || null;
    for (const patch of patches) {
      if (patch.modality) acc.modality = patch.modality;
      if (patch.programType) acc.programType = patch.programType;
      if (patch.programName) acc.programName = patch.programName;
      if (patch.specificReason) acc.specificReason = patch.specificReason;
      if (patch.responsibleArea) acc.responsibleArea = patch.responsibleArea;
    }
  }

  return {
    ...acc,
    matchedNode: lastMatchedNode,
    matchedRule: lastMatchedRule,
  };
}

export function buildPrimaryQueryFromDimensions(dimensions) {
  const parts = [];
  if (dimensions.modality === 'distancia') {
    parts.push('Carreras a distancia');
  } else if (dimensions.modality === 'presencial' && dimensions.programName) {
    parts.push(`Carrera presencial - ${PROGRAM_NAME_LABELS[dimensions.programName] || dimensions.programName}`);
  } else if (dimensions.modality === 'presencial') {
    parts.push('Carreras presenciales');
  } else if (dimensions.programType === 'curso') {
    parts.push('Cursos');
  } else if (dimensions.programType === 'licenciatura') {
    parts.push('Licenciatura');
  } else if (dimensions.programType === 'posgrado') {
    parts.push('Posgrado');
  }

  if (!parts.length && dimensions.responsibleArea) {
    parts.push(RESPONSIBLE_AREA_LABELS[dimensions.responsibleArea] || dimensions.responsibleArea);
  }

  if (!parts.length && dimensions.specificReason) {
    parts.push(SPECIFIC_REASON_LABELS[dimensions.specificReason] || dimensions.specificReason);
  }

  if (parts.length === 1 && dimensions.specificReason && dimensions.specificReason !== 'otro') {
    const reasonLabel = SPECIFIC_REASON_LABELS[dimensions.specificReason];
    if (reasonLabel && !parts[0].includes(reasonLabel)) {
      return `${parts[0]} - ${reasonLabel}`;
    }
  }

  return parts[0] || null;
}

export function buildDetalleFromDimensions(dimensions) {
  const chunks = [];
  if (dimensions.programType === 'posgrado') chunks.push('Posgrado');
  if (dimensions.responsibleArea === 'direccion') chunks.push('Dirección');
  if (dimensions.programName) {
    chunks.push(PROGRAM_NAME_LABELS[dimensions.programName] || dimensions.programName);
  }
  if (dimensions.specificReason) {
    chunks.push(SPECIFIC_REASON_LABELS[dimensions.specificReason] || dimensions.specificReason);
  }
  return chunks.length > 0 ? chunks.join(' - ') : null;
}

export function hasNodeClassification(nodeId, flowId = 'main-menu', flowVersion = null) {
  return Boolean(matchNodePattern(nodeId, flowId, flowVersion));
}
