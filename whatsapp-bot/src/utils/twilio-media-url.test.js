import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTwilioMediaUrl, fetchTwilioMediaWithRedirects } from './twilio-media-url.js';

test('rechaza HTTP y hosts no Twilio', () => {
  assert.throws(() => assertTwilioMediaUrl('http://api.twilio.com/x'), /url_not_allowed/);
  assert.throws(() => assertTwilioMediaUrl('https://evil.example/x'), /url_not_allowed/);
  assert.doesNotThrow(() => assertTwilioMediaUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Media/x'));
  assert.doesNotThrow(() => assertTwilioMediaUrl('https://mms.twiliocdn.com/signed/blob'));
  assert.doesNotThrow(() => assertTwilioMediaUrl('https://media.twiliocdn.com/signed/blob'));
});

test('redirección fuera de Twilio se rechaza sin enviar credenciales al destino', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers?.Authorization });
    if (url === 'https://api.twilio.com/start') {
      return {
        status: 302,
        headers: { get: (name) => (name === 'location' ? 'https://evil.example/blob' : null) },
      };
    }
    throw new Error('must_not_reach');
  };
  await assert.rejects(
    () => fetchTwilioMediaWithRedirects('https://api.twilio.com/start', {
      authHeader: 'Basic secret',
      timeoutMs: 1000,
      maxBytes: 1000,
      fetchImpl,
    }),
    /url_not_allowed/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, 'Basic secret');
});