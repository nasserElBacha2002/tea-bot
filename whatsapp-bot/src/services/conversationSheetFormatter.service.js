const HUMAN_STATE_MAP = {
  completed: 'Conversación finalizada',
  info_provided: 'Información brindada',
  human_handoff: 'Derivado a humano',
  fallback_handoff: 'Derivado por falta de comprensión',
  cancelled_by_user: 'Cancelado por el usuario',
  error: 'Error del sistema',
};

const HUMAN_REASON_MAP = {
  completed: 'El usuario llegó al final del flujo.',
  info_provided: 'El bot brindó la información solicitada.',
  human_handoff: 'El usuario pidió hablar con una persona.',
  fallback_handoff: 'El bot no pudo interpretar la consulta y derivó a una persona.',
  cancelled_by_user: 'El usuario canceló o finalizó la conversación.',
  error: 'La conversación terminó por un error del sistema.',
  inactivity_timeout: 'La conversación quedó inactiva por demasiado tiempo.',
  abandoned: 'La conversación quedó abandonada por inactividad.',
};

const KNOWN_NODE_LABELS = {
  welcome: 'Inicio',
  si_menu: 'Estudiante/egresado',
  no_menu: 'No estudiante',
  si_presenciales_tipo: 'Presenciales',
  si_pg_menu: 'Posgrado',
  si_pg_direccion: 'Dirección',
  si_dist_menu: 'A distancia',
  si_dist_sec_menu: 'Secretaría (a distancia)',
  si_dist_sec_a: 'Constancia de alumno regular',
  si_dist_sec_b: 'Solicitud de baja',
  si_dist_sec_c: 'Programas',
  si_dist_sec_d: 'Analíticos',
  si_dist_sec_e: 'Inasistencias',
  si_dist_admin_menu: 'Administración (a distancia)',
  si_dist_admin_a: 'Problemas con pagos',
  si_dist_admin_b: 'Medios de pago',
  si_dist_lic_a: 'Licenciatura A',
  human_handoff: 'Humano',
  fallback_global: 'No entendido',
};

/** Orden fijo de columnas en la pestaña principal de Google Sheets (14 valores por fila). */
export const EMAIL_COLUMN_HEADER = 'Email';

const HUMAN_COLUMNS = [
  'Fecha de inicio',
  'Fecha de cierre',
  'Teléfono',
  'Tipo de usuario',
  'Consulta principal',
  'Detalle de consulta',
  'Estado de la conversación',
  'Requiere atención humana',
  'Motivo de cierre',
  'Acción sugerida',
  'Recorrido resumido',
  'Último mensaje del usuario',
  'Observaciones',
  EMAIL_COLUMN_HEADER,
];

function toDate(isoLike) {
  const date = new Date(isoLike || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(isoLike) {
  const date = toDate(isoLike);
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function normalizeBooleanToHuman(value) {
  return value ? 'Sí' : 'No';
}

function stripPhonePrefixes(phone) {
  return String(phone || '')
    .trim()
    .replace(/^twilio:/i, '')
    .replace(/^meta:/i, '')
    .replace(/^whatsapp:/i, '')
    .trim();
}

export function normalizePhoneDigits(phone) {
  return stripPhonePrefixes(phone).replace(/\D/g, '');
}

export function phonesMatch(sheetPhone, dbPhone) {
  const left = normalizePhoneDigits(sheetPhone);
  const right = normalizePhoneDigits(dbPhone);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.endsWith(right) || right.endsWith(left);
}

function parseSheetDateTimeEsAr(value) {
  const text = String(value || '').trim();
  if (!text || text === '—') return null;

  const match = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*([ap])\.\s*m\.$/i,
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const isPm = match[6].toLowerCase() === 'p';
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  return { year, month, day, hour, minute };
}

function parseDbDateForSheetMatch(dateLike) {
  const date = toDate(dateLike);
  if (!date) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function datePartsMatch(left, right, minuteTolerance = 2) {
  if (!left || !right) return false;
  if (left.year !== right.year || left.month !== right.month || left.day !== right.day) {
    return false;
  }
  const leftMinutes = left.hour * 60 + left.minute;
  const rightMinutes = right.hour * 60 + right.minute;
  return Math.abs(leftMinutes - rightMinutes) <= minuteTolerance;
}

export function sheetDatesMatch(dbDateLike, sheetFormatted, minuteTolerance = 2) {
  const sheetParts = parseSheetDateTimeEsAr(sheetFormatted);
  if (!sheetParts) return false;

  const dbParts = parseDbDateForSheetMatch(dbDateLike);
  if (dbParts && datePartsMatch(dbParts, sheetParts, minuteTolerance)) {
    return true;
  }

  return formatDateTime(dbDateLike) === String(sheetFormatted).trim();
}

function normalizePhone(phone) {
  const raw = stripPhonePrefixes(phone);
  if (!raw) return '—';
  if (raw.startsWith('sim-main-menu-')) return 'Simulador';
  const digits = normalizePhoneDigits(raw);
  if (digits.length >= 8) return digits;
  return raw || '—';
}

function humanizeId(id) {
  return String(id || '')
    .replace(/^(si_|no_)/i, '')
    .replace(/\bmenu\b/gi, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || '—';
}

function isStudent(answers, visitedNodes) {
  const val = answers?.es_estudiante;
  const norm = String(val ?? '').trim().toLowerCase();
  if (['si', 'sí', 'true', 'estudiante', '1'].includes(norm)) return 'Estudiante / egresado';
  if (['no', 'false', '0'].includes(norm)) return 'No estudiante';
  if (Array.isArray(visitedNodes) && visitedNodes.includes('si_menu')) return 'Estudiante / egresado';
  if (Array.isArray(visitedNodes) && visitedNodes.includes('no_menu')) return 'No estudiante';
  return 'No informado';
}

function inferConsultaPrincipal(answers, visitedNodes) {
  if (answers?.consulta_principal) return String(answers.consulta_principal);
  const nodes = Array.isArray(visitedNodes) ? visitedNodes.map((item) => String(item).toLowerCase()) : [];
  const route = nodes.join(' ');
  if (nodes.includes('si_dist_menu') || /dist|distancia|online|virtual/.test(route)) {
    return 'Carreras a distancia';
  }
  if (route.includes('si_presenciales_tipo')) return 'Cursos presenciales';
  if (route.includes('direccion') || route.includes('sede') || route.includes('ubicacion')) {
    return 'Información institucional';
  }
  return 'No informado';
}

function inferDetalleConsulta(answers, visitedNodes, flow, transitionTrailByTarget) {
  if (answers?.detalle_consulta) return String(answers.detalle_consulta);
  const distLicNode = (visitedNodes || []).find((nodeId) => /lic|carrera/i.test(String(nodeId)));
  if (distLicNode) {
    return resolveNodeLabel(distLicNode, flow, transitionTrailByTarget);
  }
  const parts = [];
  const set = new Set(visitedNodes || []);
  if (set.has('si_pg_menu')) parts.push('Posgrado');
  if (set.has('si_pg_direccion')) parts.push('Dirección');
  return parts.length > 0 ? parts.join(' - ') : '—';
}

function humanState(finalStatus) {
  return HUMAN_STATE_MAP[finalStatus] || 'Estado no identificado';
}

function humanReason(finalStatus, contextReason) {
  if (contextReason && HUMAN_REASON_MAP[contextReason]) return HUMAN_REASON_MAP[contextReason];
  return HUMAN_REASON_MAP[finalStatus] || 'Motivo no identificado.';
}

function suggestedAction(finalStatus, requiresHuman) {
  if (requiresHuman) return 'Contactar al usuario';
  if (finalStatus === 'fallback_handoff') return 'Revisar consulta y contactar';
  if (finalStatus === 'completed' || finalStatus === 'cancelled_by_user') return 'No requiere acción';
  if (finalStatus === 'error') return 'Revisar error técnico';
  return 'Revisar caso';
}

function observation(finalStatus, requiresHuman) {
  if (requiresHuman) return 'Contactar al usuario';
  if (finalStatus === 'completed') return 'Conversación resuelta por el bot';
  if (finalStatus === 'fallback_handoff') return 'Revisar manualmente la consulta';
  if (finalStatus === 'error') return 'Revisar logs del sistema';
  if (finalStatus === 'cancelled_by_user') return 'El usuario finalizó la conversación';
  return '—';
}

function resolveNodeLabel(nodeId, flow, transitionTrailByTarget) {
  const node = Array.isArray(flow?.nodes) ? flow.nodes.find((item) => item.id === nodeId) : null;
  if (node) {
    const direct = node.label || node.trackingLabel || node.title || node.name;
    if (direct && String(direct).trim()) return String(direct).trim();
  }
  const fromTrail = transitionTrailByTarget.get(nodeId);
  if (fromTrail) return fromTrail;
  if (KNOWN_NODE_LABELS[nodeId]) return KNOWN_NODE_LABELS[nodeId];
  return humanizeId(nodeId);
}

export function formatContactEmailForSheet(contactEmail) {
  const email = String(contactEmail || '').trim().toLowerCase();
  return email || '—';
}

/**
 * Busca la fila del sheet que corresponde a una conversación (1-based, incluye header).
 * @returns {number | null}
 */
export function findSheetRowMatch(
  headers,
  dataRows,
  { phoneNumber, startedAt, closedAt = null, lastMessageAt = null },
) {
  const phoneIdx = headers.indexOf('Teléfono');
  const startIdx = headers.indexOf('Fecha de inicio');
  const endIdx = headers.indexOf('Fecha de cierre');
  const emailIdx = headers.indexOf(EMAIL_COLUMN_HEADER);
  if (phoneIdx < 0) return null;

  const endReference = closedAt || lastMessageAt;
  const candidates = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i] || [];
    if (!phonesMatch(row[phoneIdx], phoneNumber)) continue;

    const startMatches = Boolean(
      startedAt && startIdx >= 0 && sheetDatesMatch(startedAt, row[startIdx]),
    );
    const endMatches = Boolean(
      endReference && endIdx >= 0 && sheetDatesMatch(endReference, row[endIdx]),
    );
    const emailVal = emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '';
    const emailEmpty = !emailVal || emailVal === '—';

    candidates.push({
      dataIndex: i,
      sheetRow: i + 2,
      startMatches,
      endMatches,
      emailEmpty,
      score: (startMatches ? 100 : 0) + (endMatches ? 50 : 0) + (emailEmpty ? 10 : 0),
    });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].sheetRow;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.startMatches !== a.startMatches) return Number(b.startMatches) - Number(a.startMatches);
    return b.dataIndex - a.dataIndex;
  });

  const withStartMatch = candidates.filter((item) => item.startMatches);
  if (withStartMatch.length === 1) return withStartMatch[0].sheetRow;
  if (withStartMatch.length > 1) {
    const emptyEmail = withStartMatch.filter((item) => item.emailEmpty);
    const pickFrom = emptyEmail.length > 0 ? emptyEmail : withStartMatch;
    return pickFrom[pickFrom.length - 1].sheetRow;
  }

  const withEndMatch = candidates.filter((item) => item.endMatches && item.emailEmpty);
  if (withEndMatch.length === 1) return withEndMatch[0].sheetRow;

  const emptyEmailOnly = candidates.filter((item) => item.emailEmpty);
  if (emptyEmailOnly.length === 1) return emptyEmailOnly[0].sheetRow;

  return null;
}

class ConversationSheetFormatterService {
  humanHeaders() {
    return [...HUMAN_COLUMNS];
  }

  formatHumanRecord({ session, finalStatus, context = {}, nowIso, flow = null, contactEmail = null }) {
    const answers = session?.answers && typeof session.answers === 'object' ? session.answers : {};
    const visitedNodes = Array.isArray(session?.visitedNodes) ? session.visitedNodes : [];
    const transitionTrail = Array.isArray(session?.transitionTrail) ? session.transitionTrail : [];
    const transitionTrailByTarget = new Map();
    for (const step of transitionTrail) {
      if (!step?.to || !step?.label) continue;
      if (!transitionTrailByTarget.has(step.to)) transitionTrailByTarget.set(step.to, step.label);
    }

    const requiresHuman = Boolean(
      finalStatus === 'human_handoff' || finalStatus === 'fallback_handoff' || context.requiresHuman
    );
    const startIso = session?.startedAt || session?.updatedAt || nowIso;
    const phoneHuman = normalizePhone(session?.phone);
    const routeHuman = visitedNodes
      .map((nodeId) => resolveNodeLabel(nodeId, flow, transitionTrailByTarget))
      .join(' → ') || '—';

    const technicalData = {
      session,
      finalStatus,
      context,
      visitedNodes,
      transitionTrail,
      answers,
      rawIds: {
        currentNode: session?.currentNode || '',
        lastNodeId: context.lastNodeId || '',
      },
    };

    return {
      headers: this.humanHeaders(),
      row: [
        formatDateTime(startIso),
        formatDateTime(nowIso),
        phoneHuman,
        isStudent(answers, visitedNodes),
        inferConsultaPrincipal(answers, visitedNodes),
        inferDetalleConsulta(answers, visitedNodes, flow, transitionTrailByTarget),
        humanState(finalStatus),
        normalizeBooleanToHuman(requiresHuman),
        humanReason(finalStatus, context.reason),
        suggestedAction(finalStatus, requiresHuman),
        routeHuman,
        session?.lastUserMessage || '—',
        observation(finalStatus, requiresHuman),
        formatContactEmailForSheet(contactEmail),
      ],
      technicalData,
    };
  }
}

const conversationSheetFormatterService = new ConversationSheetFormatterService();
export default conversationSheetFormatterService;
