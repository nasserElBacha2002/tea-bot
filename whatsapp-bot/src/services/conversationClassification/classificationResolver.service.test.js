import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickExportClassification,
  resolveConversationClassification,
} from './classificationResolver.service.js';

test('manual override gana sobre node_route', () => {
  const resolution = resolveConversationClassification({
    conversationId: 'conv-1',
    flowId: 'main-menu',
    flowVersion: 'v11',
    answers: {},
    visitedNodes: ['no_menu', 'no_pd_menu', 'no_pd_informes'],
    transitionTrail: [],
    userMessages: [],
    manualOverride: {
      primaryQuery: 'Override manual',
      source: 'manual',
      confidence: 1,
      matchedRule: 'manual.edit',
      matchedNode: null,
      modality: null,
      programType: null,
      programName: null,
      specificReason: null,
      responsibleArea: null,
      flowId: 'main-menu',
      flowVersion: 'v11',
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'v2.0.0',
    },
  });

  assert.equal(resolution.classification.source, 'manual');
  assert.equal(resolution.classification.primaryQuery, 'Override manual');
});

test('node_route clasifica no_pd_informes acumulando dimensiones', () => {
  const resolution = resolveConversationClassification({
    conversationId: 'conv-2',
    flowId: 'main-menu',
    flowVersion: 'v11',
    answers: { es_estudiante: 'NO' },
    visitedNodes: ['welcome', 'no_menu', 'no_presenciales_menu', 'no_pd_menu', 'no_pd_informes', 'human_handoff'],
    transitionTrail: [],
    userMessages: [],
  });

  assert.equal(resolution.classification.source, 'node_route');
  assert.equal(resolution.classification.modality, 'presencial');
  assert.equal(resolution.classification.programName, 'periodismo_deportivo');
  assert.equal(resolution.classification.specificReason, 'informes');
  assert.match(resolution.classification.primaryQuery, /Periodismo deportivo/i);
  assert.notEqual(resolution.legacyClassification.primaryQuery, resolution.classification.primaryQuery);
});

test('nodos genéricos finales no borran clasificación previa', () => {
  const resolution = resolveConversationClassification({
    flowId: 'main-menu',
    visitedNodes: ['no_pd_charla', 'conversation_resolved'],
    answers: {},
    userMessages: [],
  });

  assert.equal(resolution.classification.specificReason, 'charla');
  assert.match(resolution.classification.primaryQuery, /Periodismo deportivo/i);
});

test('fallback sin evidencia devuelve primaryQuery null', () => {
  const resolution = resolveConversationClassification({
    flowId: 'main-menu',
    visitedNodes: ['welcome', 'human_handoff'],
    answers: {},
    userMessages: ['Hola'],
  });

  assert.equal(resolution.classification.source, 'fallback');
  assert.equal(resolution.classification.primaryQuery, null);
  assert.equal(resolution.classification.confidence, 0);
});

test('pickExportClassification respeta modo legacy y enabled', () => {
  const resolution = resolveConversationClassification({
    flowId: 'main-menu',
    visitedNodes: ['si_dist_menu'],
    answers: {},
    userMessages: [],
  });

  assert.equal(pickExportClassification(resolution, 'legacy').primaryQuery, 'Carreras a distancia');
  assert.equal(pickExportClassification(resolution, 'enabled').primaryQuery, 'Carreras a distancia');
});
