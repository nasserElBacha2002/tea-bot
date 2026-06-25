import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTransitionValueAtPublish,
  coerceTransitionValueForDocument,
} from './flow-transition-value.js';
import { toFlowValidationErrorDetail } from './flow-validation-errors.js';
import flowValidator from './flow-validator.js';

test('coerces numeric transition values before publish validation', () => {
  assert.doesNotThrow(() =>
    validateTransitionValueAtPublish('match', 1, {
      flowKey: 'main-menu',
      version: 'draft',
      nodeId: 'welcome',
      path: 'nodes.welcome.transitions[0].value',
    }),
  );
  assert.equal(
    coerceTransitionValueForDocument(1, {
      flowKey: 'main-menu',
      nodeId: 'welcome',
      path: 'nodes.welcome.transitions[0].value',
    }),
    '1',
  );
});

test('rejects match transition without value', () => {
  assert.throws(
    () =>
      validateTransitionValueAtPublish('match', undefined, {
        flowKey: 'main-menu',
        version: 'draft',
        nodeId: 'si_cursos_menu',
        path: 'nodes.si_cursos_menu.transitions[3].value',
      }),
    /must be a string/,
  );
});

test('formats structured validation error with priority', () => {
  try {
    validateTransitionValueAtPublish('match', undefined, {
      flowKey: 'main-menu',
      version: 'draft',
      nodeId: 'si_cursos_menu',
      path: 'nodes.si_cursos_menu.transitions[3].value',
    });
    assert.fail('expected throw');
  } catch (err) {
    const detail = toFlowValidationErrorDetail(err, {
      nodeKey: 'si_cursos_menu',
      transitionType: 'match',
      priority: 3,
      transitionIndex: 3,
    });
    assert.equal(detail.code, 'FLOW_TRANSITION_VALUE_INVALID');
    assert.match(detail.message, /si_cursos_menu/);
    assert.match(detail.message, /priority 3/);
    assert.match(detail.message, /match/);
    assert.equal(detail.expectedType, 'string');
  }
});

test('flowValidator rejects match without value in flow document', () => {
  const flow = {
    id: 'f1',
    entryNode: 'a',
    fallbackNode: 'b',
    nodes: [
      {
        id: 'a',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'match', nextNode: 'b' }],
      },
      { id: 'b', type: 'end', message: 'Chau' },
    ],
  };
  assert.throws(() => flowValidator.validate(flow), /must be a string/);
});

test('flowValidator accepts numeric match values in flow document', () => {
  const flow = {
    id: 'f1',
    entryNode: 'a',
    fallbackNode: 'b',
    nodes: [
      {
        id: 'a',
        type: 'message',
        message: 'Hola',
        transitions: [{ type: 'match', value: 1, nextNode: 'b' }],
      },
      { id: 'b', type: 'end', message: 'Chau' },
    ],
  };
  assert.doesNotThrow(() => flowValidator.validate(flow));
});
