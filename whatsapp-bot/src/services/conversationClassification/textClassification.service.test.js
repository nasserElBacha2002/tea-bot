import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFromTextRules,
  isGreetingOrNoise,
} from './textClassification.service.js';

test('saludos no clasifican', () => {
  assert.equal(isGreetingOrNoise('Hola'), true);
  assert.equal(isGreetingOrNoise('Gracias'), true);
  assert.equal(isGreetingOrNoise('Humano'), true);
  assert.equal(isGreetingOrNoise('Información'), true);
});

test('aranceles e inscripción clasifican con confianza razonable', () => {
  const aranceles = classifyFromTextRules({
    userMessages: ['Quiero saber los aranceles'],
    visitedNodes: [],
    answers: {},
  }, null);
  assert.equal(aranceles?.specificReason, 'aranceles');
  assert.ok((aranceles?.confidence || 0) >= 0.8);

  const inscripcion = classifyFromTextRules({
    userMessages: ['No pregunté por homologación, quiero saber si puedo anotarme'],
    visitedNodes: [],
    answers: {},
  }, null);
  assert.equal(inscripcion?.specificReason, 'inscripcion');
});

test('texto completa motivo parcial sin pisar modalidad confirmada', () => {
  const partial = {
    primaryQuery: 'Carrera presencial - Periodismo deportivo',
    modality: 'presencial',
    programName: 'periodismo_deportivo',
    programType: 'carrera',
    source: 'node_route',
    confidence: 0.95,
  };
  const patch = classifyFromTextRules({
    userMessages: ['Cuánto sale la cuota'],
    visitedNodes: ['no_pd_informes'],
    answers: {},
  }, partial);

  assert.equal(patch?.specificReason, 'aranceles');
  assert.equal(patch?.primaryQuery, partial.primaryQuery);
});

test('periodismo deportivo en texto eleva programName cuando no hay nodo', () => {
  const patch = classifyFromTextRules({
    userMessages: ['Quiero estudiar periodismo deportivo'],
    visitedNodes: ['welcome'],
    answers: {},
  }, null);
  assert.ok(patch?.programName === 'periodismo_deportivo' || patch?.matchedRule?.includes('periodismo'));
});
