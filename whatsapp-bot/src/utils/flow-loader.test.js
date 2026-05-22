import test from 'node:test';
import assert from 'node:assert/strict';
import flowLoader from './flow-loader.js';
import compositeFlowLoader from '../loaders/composite-flow-loader.js';

function buildLoaded(version = 'v1', storage = 'json') {
  return {
    flow: {
      id: 'main-menu',
      version,
      entryNode: 'a',
      fallbackNode: 'b',
      nodes: [
        { id: 'a', type: 'message', message: 'hola', transitions: [{ type: 'default', nextNode: 'b' }] },
        { id: 'b', type: 'message', message: 'chau' },
      ],
    },
    source: {
      flowId: 'main-menu',
      version,
      file: `${version}.json`,
      storage,
    },
  };
}

test('getFlow usa cache tras primera carga', async () => {
  const original = compositeFlowLoader.loadActivePublished;
  let calls = 0;
  compositeFlowLoader.loadActivePublished = async () => {
    calls += 1;
    return buildLoaded('v1');
  };
  try {
    flowLoader.invalidateFlow('main-menu');
    const one = await flowLoader.getFlow('main-menu');
    const two = await flowLoader.getFlow('main-menu');
    assert.equal(one.version, 'v1');
    assert.equal(two.version, 'v1');
    assert.equal(calls, 1);
  } finally {
    compositeFlowLoader.loadActivePublished = original;
    flowLoader.invalidateFlow('main-menu');
  }
});

test('reloadFlow reemplaza cache con nueva version', async () => {
  const original = compositeFlowLoader.loadActivePublished;
  let version = 'v1';
  compositeFlowLoader.loadActivePublished = async () => buildLoaded(version);
  try {
    flowLoader.invalidateFlow('main-menu');
    await flowLoader.getFlow('main-menu');
    version = 'v2';
    await flowLoader.reloadFlow('main-menu');
    const info = flowLoader.getCacheInfo('main-menu');
    assert.equal(info.version, 'v2');
  } finally {
    compositeFlowLoader.loadActivePublished = original;
    flowLoader.invalidateFlow('main-menu');
  }
});

test('invalidateFlow fuerza recarga en siguiente getFlow', async () => {
  const original = compositeFlowLoader.loadActivePublished;
  let calls = 0;
  compositeFlowLoader.loadActivePublished = async () => {
    calls += 1;
    return buildLoaded(`v${calls}`);
  };
  try {
    flowLoader.invalidateFlow('main-menu');
    await flowLoader.getFlow('main-menu');
    flowLoader.invalidateFlow('main-menu');
    const flow = await flowLoader.getFlow('main-menu');
    assert.equal(flow.version, 'v2');
    assert.equal(calls, 2);
  } finally {
    compositeFlowLoader.loadActivePublished = original;
    flowLoader.invalidateFlow('main-menu');
  }
});
