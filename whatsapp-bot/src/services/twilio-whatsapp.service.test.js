import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TwilioWhatsAppService,
  toTwilioWhatsAppAddress,
} from './twilio-whatsapp.service.js';

test('toTwilioWhatsAppAddress formatea E.164 a whatsapp:', () => {
  assert.equal(toTwilioWhatsAppAddress('+5491157109151'), 'whatsapp:+5491157109151');
});

test('assertConfigured falla sin variables Twilio', () => {
  const prev = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
  };
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;

  const service = new TwilioWhatsAppService();
  assert.throws(
    () => service.assertConfigured(),
    (err) => err.code === 'TWILIO_NOT_CONFIGURED',
  );

  if (prev.TWILIO_ACCOUNT_SID) process.env.TWILIO_ACCOUNT_SID = prev.TWILIO_ACCOUNT_SID;
  if (prev.TWILIO_AUTH_TOKEN) process.env.TWILIO_AUTH_TOKEN = prev.TWILIO_AUTH_TOKEN;
  if (prev.TWILIO_WHATSAPP_FROM) process.env.TWILIO_WHATSAPP_FROM = prev.TWILIO_WHATSAPP_FROM;
});
