import test from 'node:test';
import assert from 'node:assert/strict';
import { getFlowStorageMode, isDbFlowStorageEnabled } from './flow-storage.js';

test('getFlowStorageMode default json', () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  delete process.env.FLOW_STORAGE_MODE;
  assert.equal(getFlowStorageMode(), 'json');
  assert.equal(isDbFlowStorageEnabled(), false);
  if (prev) process.env.FLOW_STORAGE_MODE = prev;
});

test('getFlowStorageMode db_with_json_fallback', () => {
  const prev = process.env.FLOW_STORAGE_MODE;
  process.env.FLOW_STORAGE_MODE = 'db_with_json_fallback';
  assert.equal(getFlowStorageMode(), 'db_with_json_fallback');
  assert.equal(isDbFlowStorageEnabled(), true);
  if (prev === undefined) delete process.env.FLOW_STORAGE_MODE;
  else process.env.FLOW_STORAGE_MODE = prev;
});
