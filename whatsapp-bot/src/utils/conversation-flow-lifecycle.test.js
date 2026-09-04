import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFlowPresentedToUser,
  resolveHydrationNodeKey,
  shouldHydrateRuntimeSession,
} from './conversation-flow-lifecycle.js';

test('conversación nueva sin nodo no está inicializada', () => {
  assert.equal(isFlowPresentedToUser({ id: 'c1', currentNodeKey: null }, { currentNodeKey: null }), false);
  assert.equal(shouldHydrateRuntimeSession({ currentNodeKey: null }, { currentNodeKey: null }), false);
  assert.equal(resolveHydrationNodeKey({ currentNodeKey: null }, { currentNodeKey: null }), null);
});

test('sesión o conversación con currentNodeKey sí está inicializada', () => {
  assert.equal(
    isFlowPresentedToUser({ currentNodeKey: 'welcome' }, { currentNodeKey: null }),
    true,
  );
  assert.equal(
    shouldHydrateRuntimeSession({ currentNodeKey: 'welcome' }, { currentNodeKey: null }),
    true,
  );
  assert.equal(
    resolveHydrationNodeKey({ currentNodeKey: 'si_menu' }, { currentNodeKey: 'welcome' }),
    'si_menu',
  );
  assert.equal(
    resolveHydrationNodeKey({ currentNodeKey: null }, { currentNodeKey: 'welcome' }),
    'welcome',
  );
});

test('devolver al bot con resume node no es first contact', () => {
  assert.equal(
    shouldHydrateRuntimeSession(
      { currentNodeKey: 'welcome' },
      { status: 'bot', currentNodeKey: 'welcome' },
    ),
    true,
  );
});
