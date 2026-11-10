import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlowEngine } from './flow-engine.service.js';
import sessionService from './session.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productionPath = path.join(__dirname, '../../../main-menu.json');
const flow = JSON.parse(fs.readFileSync(productionPath, 'utf8'));
const USER = 'flow-nav-prod-user';

function engineArgs(text, conversationContext = { id: 'c-nav', contactEmail: 'alumno@example.com' }) {
  return {
    userId: USER,
    text,
    flowId: flow.id,
    flowSnapshot: flow,
    conversationContext,
  };
}

async function atNode(nodeId, history = ['si_presenciales_tipo']) {
  await sessionService.resetSession(USER);
  await sessionService.createSession(USER, flow.id, nodeId, {
    flowVersion: flow.version,
    history,
    simulatorFlowOverride: flow,
  });
}

beforeEach(async () => {
  await sessionService.resetSession(USER);
});

afterEach(async () => {
  await sessionService.resetSession(USER);
});

test('producción v62: número, keycap y etiqueta eligen Dirección de estudios', async () => {
  assert.equal(flow.version, 'v62');
  const engine = new FlowEngine();
  const inputs = [
    '3',
    '3️⃣',
    'Dirección de estudios',
    'Direccion de estudios',
    'DIRECCIÓN DE ESTUDIOS',
    ' Dirección de estudios ',
    'Dirección   de   estudios',
  ];
  for (const text of inputs) {
    await atNode('si_pd_menu');
    const result = await engine.resolveIncomingMessage(engineArgs(text));
    assert.equal(result.currentNodeId, 'si_pd_direccion', text);
    assert.match(result.reply, /direcciondeportea@teaydeportea\.edu\.ar/);
    const session = sessionService.getSession(USER);
    assert.equal(session.currentNode, 'si_pd_direccion');
    assert.equal(session.variables.unmatchedOptionCount, undefined);
  }
});

test('producción v62: el resto de las opciones del menú sigue eligiendo su destino', async () => {
  const engine = new FlowEngine();
  const cases = [
    ['1', 'si_pd_sec_menu'],
    ['secretaria', 'si_pd_sec_menu'],
    ['2', 'si_pd_admin_menu'],
    ['Administración', 'si_pd_admin_menu'],
    ['9', 'si_pd_profesores'],
    ['Mail de profesores/as', 'si_pd_profesores'],
    ['5', 'si_pd_mail_inst'],
    ['Blanqueo de mail institucional', 'si_pd_mail_inst'],
  ];
  for (const [text, nodeId] of cases) {
    await atNode('si_pd_menu');
    const result = await engine.resolveIncomingMessage(engineArgs(text));
    assert.equal(result.currentNodeId, nodeId, text);
  }
});

test('producción v62: dos preguntas libres no repiten el menú sin explicación', async () => {
  const engine = new FlowEngine();
  await atNode('si_pd_menu');
  const first = await engine.resolveIncomingMessage(
    engineArgs('Una consulta, mañana miércoles 11 de noviembre hay clases?'),
  );
  const second = await engine.resolveIncomingMessage(engineArgs('¿Mañana hay clases?'));
  assert.equal(first.currentNodeId, 'si_pd_menu');
  assert.equal(second.currentNodeId, 'si_pd_menu');
  assert.match(first.reply, /No reconocí esa respuesta/);
  assert.match(second.reply, /Sigo sin encontrar/);
  assert.notEqual(first.reply, second.reply);
  assert.match(first.reply, /Dirección de estudios/);
  assert.match(second.reply, /humano/);
  assert.equal(/noviembre|hay clases/i.test(first.reply), false);
  const session = sessionService.getSession(USER);
  assert.equal(session.currentNode, 'si_pd_menu');
  assert.equal(session.variables.unmatchedOptionCount, 2);
  assert.deepEqual(session.history, ['si_presenciales_tipo']);
});

test('producción v62: Menú vuelve al inicio y Atrás usa el historial', async () => {
  const engine = new FlowEngine();
  await atNode('si_pd_menu', ['si_presenciales_tipo']);
  const menu = await engine.resolveIncomingMessage(engineArgs('Menú'));
  assert.equal(menu.currentNodeId, 'welcome');
  assert.match(menu.reply, /estudiante o egresado/);
  assert.deepEqual(sessionService.getSession(USER).history, []);

  await atNode('si_pd_menu', ['si_presenciales_tipo']);
  const menuPlain = await engine.resolveIncomingMessage(engineArgs('menu'));
  assert.equal(menuPlain.currentNodeId, 'welcome');

  await atNode('si_pd_direccion', ['si_presenciales_tipo', 'si_pd_menu']);
  const back = await engine.resolveIncomingMessage(engineArgs('Atrás'));
  assert.equal(back.currentNodeId, 'si_pd_menu');
  const backPlain = await engine.resolveIncomingMessage(engineArgs('atras'));
  assert.equal(backPlain.currentNodeId, 'si_presenciales_tipo');
});

test('producción v62: sin email, Menú abre la entrada collect_email', async () => {
  const engine = new FlowEngine();
  await atNode('si_pd_menu');
  const result = await engine.resolveIncomingMessage(engineArgs('MENU', { id: 'c-nav' }));
  assert.equal(result.currentNodeId, 'collect_email');
  assert.match(result.reply, /correo electrónico/i);
});

test('un nodo de captura conserva el texto libre', async () => {
  const captureFlow = {
    id: 'capture-flow',
    version: 'v1',
    entryNode: 'ask',
    fallbackNode: 'ask',
    nodes: [
      {
        id: 'ask',
        type: 'capture',
        variableName: 'nombre',
        message: 'Decime tu nombre',
        transitions: [{ type: 'default', nextNode: 'ask' }],
      },
    ],
  };
  const engine = new FlowEngine();
  await sessionService.createSession(USER, captureFlow.id, 'ask', {
    simulatorFlowOverride: captureFlow,
  });
  const result = await engine.resolveIncomingMessage({
    userId: USER,
    text: '  María Pérez  ',
    flowId: captureFlow.id,
    flowSnapshot: captureFlow,
    conversationContext: { id: 'c-cap' },
  });
  assert.equal(result.currentNodeId, 'ask');
  assert.equal(result.reply, 'Decime tu nombre');
  assert.equal(result.variables.nombre, 'María Pérez');
  assert.equal(result.unmatchedOption, undefined);
});
