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

const HUMAN_COLUMNS = [
  'Fecha de inicio',
  'Fecha de cierre',
  'Duración',
  'Teléfono',
  'Canal',
  'Nombre',
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
  'Datos técnicos',
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

function formatDuration(startIso, endIso) {
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (!start || !end) return '—';
  const totalSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} segundos`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} minutos ${seconds} segundos` : `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours} horas ${remMinutes} minutos` : `${hours} horas`;
}

function normalizeBooleanToHuman(value) {
  return value ? 'Sí' : 'No';
}

function normalizeProvider(provider) {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return 'No informado';
  if (['twilio', 'whatsapp', 'meta'].includes(raw)) return 'WhatsApp';
  if (raw === 'simulator') return 'Simulador';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '—';
  if (raw.startsWith('sim-main-menu-')) return 'Simulador';
  return raw
    .replace(/^twilio:/i, '')
    .replace(/^meta:/i, '')
    .replace(/^whatsapp:/i, '')
    .trim() || '—';
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

class ConversationSheetFormatterService {
  humanHeaders() {
    return [...HUMAN_COLUMNS];
  }

  formatHumanRecord({ session, finalStatus, context = {}, nowIso, flow = null }) {
    const answers = session?.answers && typeof session.answers === 'object' ? session.answers : {};
    const visitedNodes = Array.isArray(session?.visitedNodes) ? session.visitedNodes : [];
    const transitionTrail = Array.isArray(session?.transitionTrail) ? session.transitionTrail : [];
    const transitionTrailByTarget = new Map();
    for (const step of transitionTrail) {
      if (!step?.to || !step?.label) continue;
      if (!transitionTrailByTarget.has(step.to)) transitionTrailByTarget.set(step.to, step.label);
    }

    const providerHuman = normalizeProvider(session?.provider);
    const requiresHuman = Boolean(
      finalStatus === 'human_handoff' || finalStatus === 'fallback_handoff' || context.requiresHuman
    );
    const startIso = session?.startedAt || session?.updatedAt || nowIso;
    const phoneHuman = providerHuman === 'Simulador' ? 'Simulador' : normalizePhone(session?.phone);
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
        formatDuration(startIso, nowIso),
        phoneHuman,
        providerHuman,
        answers.nombre || answers.name || '—',
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
        JSON.stringify(technicalData),
      ],
      technicalData,
    };
  }
}

const conversationSheetFormatterService = new ConversationSheetFormatterService();
export default conversationSheetFormatterService;
