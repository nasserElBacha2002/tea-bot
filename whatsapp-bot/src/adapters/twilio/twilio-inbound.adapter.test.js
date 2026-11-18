import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasInboundMedia,
  inboundEventHasProcessableContent,
  normalizeTwilioWhatsappPhone,
  parseTwilioInboundMedia,
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

test('parseTwilioInboundMedia lee NumMedia y campos indexados', () => {
  const media = parseTwilioInboundMedia({
    NumMedia: '2',
    MediaUrl0: 'https://api.twilio.com/0',
    MediaContentType0: 'image/jpeg',
    MediaFilename0: 'a.jpg',
    MediaUrl1: 'https://api.twilio.com/1',
    MediaContentType1: 'application/pdf',
  });
  assert.equal(media.length, 2);
  assert.equal(media[0].contentType, 'image/jpeg');
  assert.equal(media[1].fileName, null);
});

test('inboundEventHasProcessableContent incluye media sin texto', () => {
  assert.equal(inboundEventHasProcessableContent({ text: '', media: [{ index: 0, url: 'u', contentType: 'image/png' }] }), true);
  assert.equal(inboundEventHasProcessableContent({ text: 'hola', media: [] }), true);
  assert.equal(inboundEventHasProcessableContent({ text: '', media: [] }), false);
  assert.equal(hasInboundMedia({ media: [{ index: 0 }] }), true);
});
