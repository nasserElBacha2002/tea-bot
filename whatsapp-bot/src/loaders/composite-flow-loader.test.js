import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositeFlowLoader } from './composite-flow-loader.js';
import jsonFlowLoader from './json-flow-loader.js';
import dbFlowLoader from './db-flow-loader.js';

test('modo json delega sin requerir DB', async () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  process.env.FLOW_STORAGE_MODE = 'json';
  const loader = new CompositeFlowLoader();
  assert.equal(loader.getMode(), 'json');
  if (prev === undefined) delete process.env.FLOW_STORAGE_MODE;
  else process.env.FLOW_STORAGE_MODE = prev;
});

test('modo db no usa jsonFlowLoader en loadActivePublished', async () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  process.env.FLOW_STORAGE_MODE = 'db';

  const origDb = dbFlowLoader.loadActivePublished;
  const origJson = jsonFlowLoader.loadActivePublished;
  let jsonCalled = false;

  dbFlowLoader.loadActivePublished = async () => ({
    flow: { id: 'x', entryNode: 'a', nodes: [{ id: 'a', type: 'message', message: 'm' }] },
    source: { flowId: 'x', version: 'v1', storage: 'db' },
  });
  jsonFlowLoader.loadActivePublished = async () => {
    jsonCalled = true;
    return null;
  };

  const loader = new CompositeFlowLoader();
  const result = await loader.loadActivePublished('x');
  assert.equal(result.source.storage, 'db');
  assert.equal(jsonCalled, false);

  dbFlowLoader.loadActivePublished = origDb;
  jsonFlowLoader.loadActivePublished = origJson;
  if (prev === undefined) delete process.env.FLOW_STORAGE_MODE;
  else process.env.FLOW_STORAGE_MODE = prev;
});
