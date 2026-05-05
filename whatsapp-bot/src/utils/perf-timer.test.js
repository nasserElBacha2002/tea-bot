import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPerfEnabled,
  measureAsync,
  measureSync,
} from './perf-timer.js';

test('isPerfEnabled defaults to false', () => {
  const prev = process.env.PERF_LOG_ENABLED;
  delete process.env.PERF_LOG_ENABLED;
  assert.equal(isPerfEnabled(), false);
  if (prev == null) delete process.env.PERF_LOG_ENABLED;
  else process.env.PERF_LOG_ENABLED = prev;
});

test('measureAsync returns original result', async () => {
  const result = await measureAsync('test_async', async () => 42);
  assert.equal(result, 42);
});

test('measureSync returns original result', () => {
  const result = measureSync('test_sync', () => 'ok');
  assert.equal(result, 'ok');
});

test('measureAsync propagates errors', async () => {
  await assert.rejects(
    () => measureAsync('test_async_error', async () => {
      throw new Error('boom');
    }),
    /boom/
  );
});
