import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDetalleForExport,
  pickExportClassification,
  resolveConversationClassification,
} from './conversationClassification/classificationResolver.service.js';
import conversationSheetFormatterService from './conversationSheetFormatter.service.js';

const VISITED = ['welcome', 'si_menu', 'si_dist_menu', 'si_dist_lic_a', 'human_handoff'];

test('ruta histórica Licenciatura A — consulta, detalle, recorrido y humano', () => {
  const resolution = resolveConversationClassification({
    flowId: 'main-menu',
    flowVersion: 'v62',
    visitedNodes: VISITED,
    answers: {},
    userMessages: [],
  });
  const classification = pickExportClassification(resolution, 'enabled');
  assert.equal(classification.primaryQuery, 'Carreras a distancia');

  const detalle = formatDetalleForExport(classification);
  assert.equal(detalle, 'Licenciatura A');

  const formatted = conversationSheetFormatterService.formatHumanRecord({
    session: {
      visitedNodes: VISITED,
      answers: {},
      startedAt: '2026-05-01T12:00:00.000Z',
    },
    finalStatus: 'human_handoff',
    context: { requiresHuman: true, reason: 'human_handoff' },
    nowIso: '2026-05-01T12:10:00.000Z',
    exportClassification: classification,
    detalleConsulta: detalle,
  });

  assert.equal(formatted.row[4], 'Carreras a distancia');
  assert.equal(formatted.row[5], 'Licenciatura A');
  assert.equal(formatted.row[7], 'Sí');
  assert.equal(
    formatted.row[10],
    'Inicio → Estudiante/egresado → A distancia → Licenciatura A → Humano',
  );
});