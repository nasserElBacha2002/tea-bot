import { test } from 'node:test';
import assert from 'node:assert/strict';
import flowValidator from './flow-validator.js';
import {
  buildFlowDocumentFromTables,
  buildSnapshotPayload,
} from './flow-snapshot-builder.js';
import { computeFlowChecksum } from './flow-checksum.js';

const flow = { flowKey: 'main-menu', name: 'Menú Test' };
const version = {
  versionLabel: 'v99',
  entryNodeKey: 'welcome',
  fallbackNodeKey: 'fallback_global',
  status: 'draft',
  metadataJson: { schemaVersion: 1 },
};

const nodes = [
  { nodeKey: 'welcome', type: 'message', message: 'Hola editado', title: null, metadataJson: null, positionX: 10, positionY: 20 },
  { nodeKey: 'fallback_global', type: 'message', message: 'Fallback', title: null, metadataJson: null },
  { nodeKey: 'next_step', type: 'message', message: 'Siguiente', title: null, metadataJson: null },
];

const transitionsByNodeKey = new Map([
  [
    'welcome',
    [
      { type: 'match', value: '1', nextNodeKey: 'next_step', priority: 0, metadataJson: null },
      { type: 'default', value: null, nextNodeKey: 'fallback_global', priority: 1, metadataJson: null },
    ],
  ],
]);

test('snapshot generado es válido para FlowEngine', () => {
  const doc = buildFlowDocumentFromTables(flow, version, nodes, transitionsByNodeKey);
  assert.equal(doc.id, 'main-menu');
  assert.equal(doc.entryNode, 'welcome');
  assert.equal(doc.nodes.find((n) => n.id === 'welcome').message, 'Hola editado');
  flowValidator.validate(doc);
});

test('snapshot incluye transiciones editadas', () => {
  const doc = buildFlowDocumentFromTables(flow, version, nodes, transitionsByNodeKey);
  const welcome = doc.nodes.find((n) => n.id === 'welcome');
  assert.ok(welcome.transitions.some((t) => t.nextNode === 'next_step' && t.value === '1'));
});

test('checksum cambia tras editar mensaje', () => {
  const a = buildSnapshotPayload(flow, version, nodes, transitionsByNodeKey);
  const nodes2 = nodes.map((n) =>
    n.nodeKey === 'welcome' ? { ...n, message: 'Otro texto' } : n,
  );
  const b = buildSnapshotPayload(flow, version, nodes2, transitionsByNodeKey);
  assert.notEqual(a.checksum, b.checksum);
});

test('snapshot builder coerces numeric transition values to strings', () => {
  const numericTransitions = new Map([
    [
      'welcome',
      [
        { type: 'match', value: 1, nextNodeKey: 'next_step', priority: 0, metadataJson: null },
      ],
    ],
  ]);
  const doc = buildFlowDocumentFromTables(flow, version, nodes, numericTransitions);
  const welcome = doc.nodes.find((n) => n.id === 'welcome');
  assert.equal(welcome.transitions[0].value, '1');
  assert.doesNotThrow(() => flowValidator.validate(doc));
});

test('checksum estable sin cambios', () => {
  const a = buildSnapshotPayload(flow, version, nodes, transitionsByNodeKey);
  const b = buildSnapshotPayload(flow, version, nodes, transitionsByNodeKey);
  assert.equal(a.checksum, b.checksum);
  assert.equal(computeFlowChecksum(a.snapshotJson), computeFlowChecksum(b.snapshotJson));
});
