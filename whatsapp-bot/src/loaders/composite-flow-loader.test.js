import test from 'node:test';
import assert from 'node:assert/strict';
import compositeFlowLoader from './composite-flow-loader.js';
import dbFlowLoader from './db-flow-loader.js';

test('CompositeFlowLoader siempre usa modo db', () => {
  assert.equal(compositeFlowLoader.getMode(), 'db');
});

test('loadActivePublished delega en dbFlowLoader', async () => {
  const orig = dbFlowLoader.loadActivePublished;
  let called = false;
  dbFlowLoader.loadActivePublished = async (key) => {
    called = true;
    return { flow: { id: key }, source: { storage: 'db' } };
  };
  const result = await compositeFlowLoader.loadActivePublished('main-menu');
  assert.equal(called, true);
  assert.equal(result.source.storage, 'db');
  dbFlowLoader.loadActivePublished = orig;
});
