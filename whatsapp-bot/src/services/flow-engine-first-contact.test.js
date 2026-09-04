import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FlowEngine } from './flow-engine.service.js';
import sessionService from './session.service.js';

const TEST_USER = 'test-first-contact-user';

function buildMenuFlow() {
  return {
    id: 'first-contact-flow',
    version: 'v1',
    entryNode: 'welcome',
    fallbackNode: 'fallback',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: '¡Hola! Bienvenido/a a Tea y Deportea. Elegí una opción.',
        transitions: [
          { type: 'match', value: '1', nextNode: 'info', priority: 0 },
        ],
      },
      {
        id: 'info',
        type: 'message',
        message: 'Info de inscripciones',
        transitions: [],
      },
      {
        id: 'fallback',
        type: 'message',
        message: 'No pude entender tu respuesta. Por favor, elegí una opción válida del menú.',
        transitions: [],
      },
      {
        id: 'human_handoff',
        type: 'message',
        message: 'Te vamos a derivar con una persona del equipo.',
        transitions: [],
      },
    ],
  };
}

function engineArgs(text, flow, conversationContext = { id: 'c-new' }) {
  return {
    userId: TEST_USER,
    text,
    flowId: flow.id,
    flowSnapshot: flow,
    conversationContext,
  };
}

beforeEach(async () => {
  await sessionService.resetSession(TEST_USER);
});

afterEach(async () => {
  await sessionService.resetSession(TEST_USER);
});

test('primer contacto con Hola inicia el flujo y no usa fallback', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  const result = await engine.resolveIncomingMessage(engineArgs('Hola', flow));
  assert.equal(result.currentNodeId, 'welcome');
  assert.match(result.reply, /Bienvenido/i);
  assert.equal(/No pude entender/i.test(result.reply), false);
});

test('primer contacto con consulta libre inicia el flujo', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  const result = await engine.resolveIncomingMessage(
    engineArgs('Hola, quería consultar por las inscripciones', flow),
  );
  assert.equal(result.currentNodeId, 'welcome');
  assert.match(result.reply, /Bienvenido/i);
  assert.equal(/No pude entender/i.test(result.reply), false);
});

test('primer contacto con humano deriva a handoff', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  const result = await engine.resolveIncomingMessage(engineArgs('humano', flow));
  assert.equal(result.currentNodeId, 'human_handoff');
});

test('primer contacto con quiero hablar con una persona deriva a handoff', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  const result = await engine.resolveIncomingMessage(
    engineArgs('quiero hablar con una persona', flow),
  );
  assert.equal(result.currentNodeId, 'human_handoff');
});

test('después del menú un texto inválido usa el fallback del nodo', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  await engine.resolveIncomingMessage(engineArgs('Hola', flow, { id: 'c1', currentNodeKey: null }));
  const second = await engine.resolveIncomingMessage(
    engineArgs('cualquier texto inválido', flow, { id: 'c1', currentNodeKey: 'welcome' }),
  );
  assert.equal(second.currentNodeId, 'fallback');
  assert.match(second.reply, /No pude entender/i);
});

test('después del menú humano deriva a handoff', async () => {
  const engine = new FlowEngine();
  const flow = buildMenuFlow();
  await engine.resolveIncomingMessage(engineArgs('Hola', flow));
  const second = await engine.resolveIncomingMessage(engineArgs('humano', flow, {
    id: 'c1',
    currentNodeKey: 'welcome',
  }));
  assert.equal(second.currentNodeId, 'human_handoff');
});
