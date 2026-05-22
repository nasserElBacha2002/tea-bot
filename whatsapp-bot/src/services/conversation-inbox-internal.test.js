import test from 'node:test';
import assert from 'node:assert/strict';

test('provider internal no requiere Twilio', () => {
  const conversation = { channel: 'simulator', provider: 'internal' };
  const shouldTwilio =
    conversation.channel === 'whatsapp' && conversation.provider === 'twilio';
  assert.equal(shouldTwilio, false);
});

test('provider twilio whatsapp requiere Twilio', () => {
  const conversation = { channel: 'whatsapp', provider: 'twilio' };
  const shouldTwilio =
    conversation.channel === 'whatsapp' && conversation.provider === 'twilio';
  assert.equal(shouldTwilio, true);
});
