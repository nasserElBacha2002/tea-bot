export const CLASSIFIER_VERSION = 'v2.0.0';

export const CLASSIFICATION_MODES = ['legacy', 'shadow', 'enabled'];

/** @type {ReadonlySet<string>} */
export const GENERIC_NODES = new Set([
  'welcome',
  'inicio',
  'human_handoff',
  'humano',
  'conversation_resolved',
  'fallback_global',
  'collect_email',
  'no_entendido',
  'menu',
  'atras',
  'si_menu',
  'no_menu',
]);

/** Priority: lower index = higher priority */
export const SOURCE_PRIORITY = [
  'manual',
  'explicit_track',
  'node_route',
  'transition_trail',
  'message_rules',
  'legacy_inference',
  'fallback',
];

export const SOURCE_PRIORITY_INDEX = Object.fromEntries(
  SOURCE_PRIORITY.map((source, index) => [source, index]),
);

export const PROGRAM_NAME_LABELS = {
  periodismo_deportivo: 'Periodismo deportivo',
  periodismo_general: 'Periodismo general',
};

export const MODALITY_LABELS = {
  presencial: 'Presencial',
  distancia: 'A distancia',
};

export const PROGRAM_TYPE_LABELS = {
  carrera: 'Carrera',
  curso: 'Curso',
  licenciatura: 'Licenciatura',
  posgrado: 'Posgrado',
};

export const SPECIFIC_REASON_LABELS = {
  informes: 'Informes',
  charla: 'Charla informativa',
  aranceles: 'Aranceles',
  inscripcion: 'Inscripción',
  becas: 'Becas',
  certificado: 'Certificado',
  diploma: 'Diploma',
  secretaria: 'Secretaría',
  administracion: 'Administración',
  direccion: 'Dirección',
  archivo: 'Archivo',
  rrhh: 'Recursos humanos',
  prensa: 'Prensa',
  ubicacion: 'Ubicación',
  visita: 'Visita institucional',
  otro: 'Otro',
};

export const RESPONSIBLE_AREA_LABELS = {
  secretaria: 'Secretaría',
  administracion: 'Administración',
  direccion: 'Dirección',
  archivo: 'Archivo',
  rrhh: 'Recursos humanos',
  prensa: 'Prensa',
};

export const EXPORT_DISPLAY_FALLBACK = 'No informado';
