import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTwilioWhatsappNumber } from './twilio-phone.js';

test('normalizeTwilioWhatsappNumber elimina prefijo whatsapp', () => {
  assert.equal(normalizeTwilioWhatsappNumber('whatsapp:+5491157109151'), '+5491157109151');
});

test('normalizeTwilioWhatsappNumber mantiene E.164', () => {
  assert.equal(normalizeTwilioWhatsappNumber('+5491157109151'), '+5491157109151');
});

test('normalizeTwilioWhatsappNumber rechaza vacio', () => {
  assert.equal(normalizeTwilioWhatsappNumber(''), null);
  assert.equal(normalizeTwilioWhatsappNumber(null), null);
  assert.equal(normalizeTwilioWhatsappNumber(undefined), null);
});

test('normalizeTwilioWhatsappNumber no devuelve literal whatsapp', () => {
  assert.notEqual(normalizeTwilioWhatsappNumber('whatsapp:+5491157109151'), 'whatsapp');
});

test('normalizeTwilioWhatsappNumber normaliza digitos sin plus', () => {
  assert.equal(normalizeTwilioWhatsappNumber('5491157109151'), '+5491157109151');
});
