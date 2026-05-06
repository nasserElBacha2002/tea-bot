import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTwilioWhatsappPhone,
  toCanonicalTwilioInboundEvent,
} from './twilio-inbound.adapter.js';

test('normalizeTwilioWhatsappPhone elimina prefijo whatsapp', () => {
  assert.equal(normalizeTwilioWhatsappPhone('whatsapp:+5491157109151'), '+5491157109151');
});

test('normalizeTwilioWhatsappPhone mantiene numero limpio', () => {
  assert.equal(normalizeTwilioWhatsappPhone('+5491157109151'), '+5491157109151');
});

test('normalizeTwilioWhatsappPhone maneja vacio', () => {
  assert.equal(normalizeTwilioWhatsappPhone(''), 'No informado');
});

test('normalizeTwilioWhatsappPhone maneja null', () => {
  assert.equal(normalizeTwilioWhatsappPhone(null), 'No informado');
});

test('normalizeTwilioWhatsappPhone maneja undefined', () => {
  assert.equal(normalizeTwilioWhatsappPhone(undefined), 'No informado');
});

test('toCanonicalTwilioInboundEvent conserva userId y agrega phone normalizado', () => {
  const event = toCanonicalTwilioInboundEvent({
    flowId: 'main-menu',
    body: {
      From: 'whatsapp:+5491157109151',
      Body: 'hola',
      MessageSid: 'SM123',
    },
  });

  assert.equal(event.userId, 'twilio:whatsapp:+5491157109151');
  assert.equal(event.phone, '+5491157109151');
  assert.equal(event.provider, 'twilio');
});
