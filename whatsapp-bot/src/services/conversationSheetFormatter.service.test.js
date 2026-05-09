import test from 'node:test';
import assert from 'node:assert/strict';
import conversationSheetFormatterService from './conversationSheetFormatter.service.js';

function baseSession(overrides = {}) {
  return {
    provider: 'simulator',
    phone: 'sim-main-menu-123',
    startedAt: '2026-05-05T15:00:00.000Z',
    updatedAt: '2026-05-05T15:00:10.000Z',
    visitedNodes: ['si_menu', 'si_presenciales_tipo', 'si_pg_menu', 'si_pg_direccion', 'human_handoff'],
    answers: { es_estudiante: 'SI' },
    lastUserMessage: 'humano',
    ...overrides,
  };
}

test('formatHumanRecord produce exactamente 13 columnas alineadas con headers', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: { reason: 'human_handoff', requiresHuman: true },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.headers.length, 13);
  assert.equal(result.row.length, 13);
  assert.deepEqual(result.headers, conversationSheetFormatterService.humanHeaders());
});

test('human_handoff con provider simulator formatea campos humanos clave', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: { reason: 'human_handoff', requiresHuman: true },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[2], 'Simulador');
  assert.equal(result.row[6], 'Derivado a humano');
  assert.equal(result.row[7], 'Sí');
  assert.equal(result.row[8], 'El usuario pidió hablar con una persona.');
  assert.equal(result.row[9], 'Contactar al usuario');
});

test('completed devuelve estado y acción esperada', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({ provider: 'meta', phone: 'whatsapp:+5491111111111' }),
    finalStatus: 'completed',
    context: { reason: 'completed' },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[6], 'Conversación finalizada');
  assert.equal(result.row[7], 'No');
  assert.equal(result.row[8], 'El usuario llegó al final del flujo.');
  assert.equal(result.row[9], 'No requiere acción');
});

test('recorrido conocido usa etiquetas humanas esperadas', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[10], 'Estudiante/egresado → Presenciales → Posgrado → Dirección → Humano');
});

test('answers.es_estudiante SI devuelve tipo estudiante/egresado', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({ answers: { es_estudiante: 'SI' } }),
    finalStatus: 'completed',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[3], 'Estudiante / egresado');
});

test('estado desconocido devuelve estado no identificado; técnico solo en technicalData', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'rare_status',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[6], 'Estado no identificado');
  assert.match(JSON.stringify(result.technicalData), /"finalStatus":"rare_status"/);
});

test('si flow tiene label de nodo, se prioriza sobre fallback', () => {
  const flow = {
    nodes: [
      { id: 'si_menu', label: 'Menu Estudiante' },
      { id: 'human_handoff', label: 'Atencion Humana' },
    ],
  };
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({ visitedNodes: ['si_menu', 'human_handoff'] }),
    finalStatus: 'human_handoff',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow,
  });
  assert.equal(result.row[10], 'Menu Estudiante → Atencion Humana');
});

test('flujo distancia infiere consulta, detalle y recorrido humano', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({
      visitedNodes: ['si_menu', 'si_dist_menu', 'si_dist_lic_a', 'human_handoff'],
      provider: 'simulator',
      phone: 'sim-main-menu-xyz',
      lastUserMessage: 'humano',
    }),
    finalStatus: 'human_handoff',
    context: { requiresHuman: true },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[2], 'Simulador');
  assert.equal(result.row[3], 'Estudiante / egresado');
  assert.equal(result.row[4], 'Carreras a distancia');
  assert.equal(result.row[5], 'Licenciatura A');
  assert.equal(result.row[6], 'Derivado a humano');
  assert.equal(result.row[7], 'Sí');
  assert.equal(result.row[8], 'El usuario pidió hablar con una persona.');
  assert.equal(result.row[9], 'Contactar al usuario');
  assert.equal(result.row[10], 'Estudiante/egresado → A distancia → Licenciatura A → Humano');
});
