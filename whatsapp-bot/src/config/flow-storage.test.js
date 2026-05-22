import test from 'node:test';
import assert from 'node:assert/strict';
import { getFlowStorageMode, isDbFlowStorageEnabled } from './flow-storage.js';

test('getFlowStorageMode default db', () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  delete process.env.FLOW_STORAGE_MODE;
  assert.equal(getFlowStorageMode(), 'db');
  assert.equal(isDbFlowStorageEnabled(), true);
  if (prev) process.env.FLOW_STORAGE_MODE = prev;
});

test('getFlowStorageMode legacy json maps to db', () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  process.env.FLOW_STORAGE_MODE = 'json';
  assert.equal(getFlowStorageMode(), 'db');
  if (prev === undefined) delete process.env.FLOW_STORAGE_MODE;
  else process.env.FLOW_STORAGE_MODE = prev;
});
