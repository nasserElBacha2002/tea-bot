import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFlowMatchText, includesAsTokens } from './flow-match-text.js';
import { parseEnumeratedMenuOptions } from './flow-menu-options.js';
import { buildNodeTransitionIndex, resolveIndexedTransition } from './flow-transition-index.js';

test('normaliza keycaps, tildes, mayúsculas y espacios', () => {
  assert.equal(normalizeFlowMatchText('  Dirección   de estudios '), 'direccion de estudios');
  assert.equal(normalizeFlowMatchText('DIRECCIÓN DE ESTUDIOS'), 'direccion de estudios');
  assert.equal(normalizeFlowMatchText('3️⃣'), '3');
  assert.equal(normalizeFlowMatchText('3\uFE0F\u20E3'), '3');
  assert.equal(normalizeFlowMatchText('Direccion de estudios'), 'direccion de estudios');
});

test('includes exige tokens y no toma si dentro de inscripciones', () => {
  assert.equal(includesAsTokens('inscripciones', 'si'), false);
  assert.equal(includesAsTokens('quiero comprar ahora', 'comprar'), true);
  assert.equal(includesAsTokens('direccion de estudios', 'direccion'), true);
});

test('dos etiquetas iguales quedan ambiguas', () => {
  const node = {
    id: 'menu',
    message: '1️⃣ *Info*\n2️⃣ *Info*\n',
    transitions: [
      { type: 'match', value: '1', nextNode: 'a' },
      { type: 'match', value: '2', nextNode: 'b' },
    ],
  };
  const index = buildNodeTransitionIndex(node);
  const result = resolveIndexedTransition(node, index, 'info', null);
  assert.equal(result.reason, 'ambiguous_label');
  assert.equal(result.nextNodeId, 'menu');
  assert.equal(result.matchedTransition, null);
});

test('dos aliases normalizados con distinto destino quedan ambiguos', () => {
  const node = {
    id: 'menu',
    message: 'Elegí',
    transitions: [
      { type: 'match', value: 'dirección', nextNode: 'a' },
      { type: 'matchAny', value: ['direccion'], nextNode: 'b' },
    ],
  };
  const index = buildNodeTransitionIndex(node);
  assert.equal(index.exact.has('direccion'), false);
  assert.equal(index.ambiguousExact.has('direccion'), true);
  const result = resolveIndexedTransition(node, index, 'direccion', 'fb');
  assert.equal(result.reason, 'ambiguous_exact');
  assert.equal(result.nextNodeId, 'menu');
});

test('parsea la etiqueta visible de una opción numerada', () => {
  const options = parseEnumeratedMenuOptions('3️⃣ *Dirección de estudios*\n');
  assert.deepEqual(options, [{ digit: '3', label: 'direccion de estudios' }]);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productionPath = path.join(__dirname, '../../../main-menu.json');

test('el menú de producción asocia la etiqueta 3 con si_pd_direccion', () => {
  const flow = JSON.parse(fs.readFileSync(productionPath, 'utf8'));
  const node = flow.nodes.find((item) => item.id === 'si_pd_menu');
  const index = buildNodeTransitionIndex(node);
  const selected = resolveIndexedTransition(node, index, 'direccion de estudios', flow.fallbackNode);
  assert.equal(flow.version, 'v62');
  assert.equal(selected.nextNodeId, 'si_pd_direccion');
  assert.equal(selected.reason, 'enumerated_label');
  const fullLabel = resolveIndexedTransition(
    node,
    index,
    'blanqueo de mail institucional',
    flow.fallbackNode,
  );
  assert.equal(fullLabel.nextNodeId, 'si_pd_mail_inst');
  const ambiguous = resolveIndexedTransition(
    node,
    index,
    'blanqueo de mail',
    flow.fallbackNode,
  );
  assert.equal(ambiguous.reason, 'ambiguous_include');
});
