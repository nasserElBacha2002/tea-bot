import test from 'node:test';
import assert from 'node:assert/strict';
import flowValidator from './flow-validator.js';
import { compileFlow } from './compile-flow.js';
import { inspectFlowTextFields } from './flow-text-field-inspector.js';
import { FlowFieldValidationError } from './flow-field-validation.js';

function buildFlow(overrides = {}) {
  return {
    id: 'main-menu',
    name: 'Main',
    version: 'v10',
    status: 'published',
    entryNode: 'start',
    fallbackNode: 'fallback',
    nodes: [
      {
        id: 'start',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'match', value: '1', nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
    ...overrides,
  };
}

test('valid text string passes validation and compile', () => {
  const flow = buildFlow();
  assert.doesNotThrow(() => flowValidator.validate(flow));
  assert.doesNotThrow(() => compileFlow(flow));
  assert.equal(inspectFlowTextFields(flow).length, 0);
});

test('invalid message object fails with clear path', () => {
  const flow = buildFlow({
    nodes: [
      {
        id: 'start',
        type: 'message',
        message: { text: 'hola' },
        transitions: [{ type: 'default', nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  assert.throws(
    () => flowValidator.validate(flow),
    (err) =>
      err instanceof FlowFieldValidationError
      && err.message.includes('main-menu v10')
      && err.message.includes('nodes.start.message')
      && err.message.includes('received object'),
  );
});

test('invalid transition value object fails with clear path', () => {
  const flow = buildFlow({
    nodes: [
      {
        id: 'start',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'match', value: { text: '1', id: 'btn' }, nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  assert.throws(
    () => flowValidator.validate(flow),
    /nodes\.start\.transitions\[0\]\.value must be a string, received object/,
  );
});

test('invalid matchAny array item fails with clear path', () => {
  const flow = buildFlow({
    nodes: [
      {
        id: 'start',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'matchAny', value: ['si', { text: 'ok' }], nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  assert.throws(
    () => flowValidator.validate(flow),
    /nodes\.start\.transitions\[0\]\.value\[1\] must be a string, received object/,
  );
});

test('numeric transition value fails validation but compiles with defensive coercion', () => {
  const flow = buildFlow({
    entryNode: 'no_menu',
    nodes: [
      {
        id: 'no_menu',
        type: 'message',
        message: 'Menú',
        transitions: [{ type: 'match', value: 1, nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });

  assert.throws(
    () => flowValidator.validate(flow),
    /nodes\.no_menu\.transitions\[0\]\.value must be a string, received number/,
  );

  const compiled = compileFlow(flow);
  assert.equal(compiled.exactMatchByNodeId.get('no_menu').get('1').nextNode, 'end');
});

test('inspector reports invalid published-like snapshot fields', () => {
  const flow = buildFlow({
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'matchIncludes', value: 2, nextNode: 'end' }],
      },
      { id: 'fallback', type: 'message', message: 'No entendí', nextNode: 'end' },
      { id: 'end', type: 'end', message: 'Bye' },
    ],
  });
  const issues = inspectFlowTextFields(flow, { flowKey: 'main-menu', version: 'v10' });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, 'nodes.welcome.transitions[0].value');
  assert.equal(issues[0].actualType, 'number');
});
