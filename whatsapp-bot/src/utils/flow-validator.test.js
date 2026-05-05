import test from 'node:test';
import assert from 'node:assert/strict';
import flowValidator from './flow-validator.js';

function buildFlow(overrides = {}) {
  return {
    id: 'main-menu',
    name: 'Main',
    version: 'draft',
    status: 'draft',
    entryNode: 'start',
    fallbackNode: 'fallback',
    nodes: [
      { id: 'start', type: 'message', message: 'Hola', transitions: [{ type: 'default', nextNode: 'end' }] },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
    ...overrides,
  };
}

test('valida un flujo correcto', () => {
  assert.doesNotThrow(() => flowValidator.validate(buildFlow()));
});

test('rechaza entryNode inexistente', () => {
  assert.throws(
    () => flowValidator.validate(buildFlow({ entryNode: 'missing' })),
    /entryNode/i
  );
});

test('rechaza transiciones a nodos inexistentes', () => {
  const flow = buildFlow({
    nodes: [
      { id: 'start', type: 'message', message: 'Hola', transitions: [{ type: 'default', nextNode: 'x' }] },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  assert.throws(() => flowValidator.validate(flow), /inexistente/i);
});

test('rechaza nodos duplicados', () => {
  const flow = buildFlow({
    nodes: [
      { id: 'start', type: 'message', message: 'Hola', nextNode: 'end' },
      { id: 'start', type: 'message', message: 'Duplicado', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  assert.throws(() => flowValidator.validate(flow), /duplicados/i);
});
