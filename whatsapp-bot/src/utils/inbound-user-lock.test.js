import test from 'node:test';
import assert from 'node:assert/strict';
import { withInboundUserLock } from './inbound-user-lock.js';

test('serializa callbacks del mismo userId', async () => {
  const order = [];
  const first = withInboundUserLock('u1', async () => {
    order.push('a-start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('a-end');
    return 'a';
  });
  const second = withInboundUserLock('u1', async () => {
    order.push('b');
    return 'b';
  });
  const values = await Promise.all([first, second]);
  assert.deepEqual(values, ['a', 'b']);
  assert.deepEqual(order, ['a-start', 'a-end', 'b']);
});

test('userIds distintos no se bloquean entre sí', async () => {
  let released = false;
  const slow = withInboundUserLock('u-slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    released = true;
    return 'slow';
  });
  const fast = withInboundUserLock('u-fast', async () => 'fast');
  assert.equal(await fast, 'fast');
  assert.equal(released, false);
  await slow;
});
