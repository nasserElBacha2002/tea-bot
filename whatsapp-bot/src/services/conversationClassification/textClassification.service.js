const GREETING_ONLY = /^(hola|buen[oa]s|buenas tardes|buenos dias|buen dia|gracias|ok|dale|si|sí|no|humano|menu|menú|informacion|información)$/i;

const NEGATION_CORRECTION = /no\s+(?:pregunt[ée]|quiero|es)\s+[^,.;]+[,.;]?\s*(?:pregunt[ée]|quiero)\s+(.+)/i;

/** @type {Array<{ id: string, reason: string, weight: number, patterns: RegExp[] }>} */
export const TEXT_CLASSIFICATION_RULES = [
  {
    id: 'aranceles',
    reason: 'aranceles',
    weight: 0.85,
    patterns: [/arancel/i, /cuota/i, /matr[ií]cula/i, /precio/i, /costo/i, /valor/i, /pago mensual/i, /pago anual/i],
  },
  {
    id: 'inscripcion',
    reason: 'inscripcion',
    weight: 0.9,
    patterns: [/inscripci[oó]n/i, /inscribir/i, /anotarme/i, /preinscripci[oó]n/i, /ingreso/i, /comenzar/i, /inicio de clases/i, /cuatrimestre/i, /\b20\d{2}\b/],
  },
  {
    id: 'charla',
    reason: 'charla',
    weight: 0.88,
    patterns: [/charla informativa/i, /charla/i, /reuni[oó]n informativa/i, /conocer la carrera/i],
  },
  {
    id: 'becas',
    reason: 'becas',
    weight: 0.9,
    patterns: [/beca/i, /ayuda econ[oó]mica/i],
  },
  {
    id: 'certificado',
    reason: 'certificado',
    weight: 0.92,
    patterns: [/certificado/i, /constancia/i, /anal[ií]tico/i],
  },
  {
    id: 'diploma',
    reason: 'diploma',
    weight: 0.92,
    patterns: [/diploma/i, /t[ií]tulo/i],
  },
  {
    id: 'secretaria',
    reason: 'secretaria',
    weight: 0.9,
    patterns: [/secretar[ií]a/i, /inasistencia/i, /final/i, /receso/i, /turno/i],
  },
  {
    id: 'administracion',
    reason: 'administracion',
    weight: 0.88,
    patterns: [/administraci[oó]n/i, /comprobante/i, /problemas con pagos/i],
  },
  {
    id: 'visita',
    reason: 'visita',
    weight: 0.9,
    patterns: [/recorrer/i, /visita/i, /conocer el lugar/i, /conocer la facultad/i],
  },
  {
    id: 'ubicacion',
    reason: 'ubicacion',
    weight: 0.88,
    patterns: [/ubicaci[oó]n/i, /direcci[oó]n/i, /d[oó]nde qued/i, /sede/i],
  },
  {
    id: 'periodismo_deportivo',
    reason: 'otro',
    weight: 0.95,
    patterns: [/periodismo deportivo/i, /relato deportivo/i],
  },
  {
    id: 'periodismo_general',
    reason: 'otro',
    weight: 0.95,
    patterns: [/periodismo general/i],
  },
  {
    id: 'curso',
    reason: 'otro',
    weight: 0.82,
    patterns: [/\bcursos?\b/i],
  },
  {
    id: 'licenciatura',
    reason: 'otro',
    weight: 0.82,
    patterns: [/licenciatura/i],
  },
  {
    id: 'posgrado',
    reason: 'otro',
    weight: 0.82,
    patterns: [/posgrado/i],
  },
];

export function normalizeMessageText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGreetingOrNoise(text) {
  const normalized = normalizeMessageText(text);
  if (!normalized) return true;
  if (GREETING_ONLY.test(normalized)) return true;
  if (normalized.length <= 2) return true;
  return false;
}

function extractCorrectedSegment(text) {
  const match = String(text || '').match(NEGATION_CORRECTION);
  return match?.[1]?.trim() || text;
}

/**
 * @param {string[]} userMessages
 * @returns {{ ruleId: string, reason: string, confidence: number, matchedTextLength: number } | null}
 */
export function classifyFromUserMessages(userMessages) {
  const candidates = [];
  const messages = Array.isArray(userMessages) ? userMessages : [];

  for (const raw of messages) {
    const corrected = extractCorrectedSegment(raw);
    if (isGreetingOrNoise(corrected)) continue;
    const normalized = normalizeMessageText(corrected);
    if (!normalized || normalized === 'informacion') continue;

    for (const rule of TEXT_CLASSIFICATION_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) {
        candidates.push({
          ruleId: rule.id,
          reason: rule.reason,
          confidence: rule.weight,
          matchedTextLength: normalized.length,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.confidence - a.confidence || b.matchedTextLength - a.matchedTextLength);
  return candidates[0];
}

/**
 * @param {import('./classification.types.js').ClassificationInput} input
 * @param {import('./classification.types.js').ConversationClassification | null} partial
 * @returns {import('./classification.types.js').ConversationClassification | null}
 */
export function classifyFromTextRules(input, partial = null) {
  const messages = Array.isArray(input.userMessages) ? input.userMessages : [];
  const match = classifyFromUserMessages(messages);
  if (!match) return null;

  /** @type {import('./classification.types.js').ConversationClassification} */
  const result = {
    primaryQuery: partial?.primaryQuery || null,
    modality: partial?.modality || null,
    programType: partial?.programType || null,
    programName: partial?.programName || null,
    specificReason: partial?.specificReason || match.reason,
    responsibleArea: partial?.responsibleArea || null,
    source: 'message_rules',
    confidence: Math.min(match.confidence, partial ? 0.8 : match.confidence),
    matchedRule: `text:${match.ruleId}`,
    matchedNode: null,
    flowId: input.flowId || null,
    flowVersion: input.flowVersion || null,
    classifiedAt: new Date().toISOString(),
    classifierVersion: 'v2.0.0',
  };

  if (match.ruleId === 'periodismo_deportivo') {
    result.programName = 'periodismo_deportivo';
    result.modality = result.modality || 'presencial';
    result.programType = result.programType || 'carrera';
    result.primaryQuery = result.primaryQuery || 'Carrera presencial - Periodismo deportivo';
  } else if (match.ruleId === 'periodismo_general') {
    result.programName = 'periodismo_general';
    result.modality = result.modality || 'presencial';
    result.programType = result.programType || 'carrera';
    result.primaryQuery = result.primaryQuery || 'Carrera presencial - Periodismo general';
  } else if (match.ruleId === 'curso') {
    result.programType = result.programType || 'curso';
    result.primaryQuery = result.primaryQuery || 'Cursos';
  } else if (match.ruleId === 'licenciatura') {
    result.programType = result.programType || 'licenciatura';
    result.primaryQuery = result.primaryQuery || 'Licenciatura';
  } else if (match.ruleId === 'posgrado') {
    result.programType = result.programType || 'posgrado';
    result.primaryQuery = result.primaryQuery || 'Posgrado';
  } else if (!result.primaryQuery && result.specificReason) {
    const labels = {
      aranceles: 'Aranceles',
      inscripcion: 'Inscripción',
      charla: 'Charla informativa',
      becas: 'Becas',
      certificado: 'Certificados',
      diploma: 'Diploma',
      secretaria: 'Secretaría',
      administracion: 'Administración',
      visita: 'Visita institucional',
      ubicacion: 'Información institucional',
    };
    result.primaryQuery = labels[result.specificReason] || null;
  }

  return result.primaryQuery || result.specificReason ? result : null;
}
