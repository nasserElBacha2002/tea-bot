import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPermanentInboundMediaFailure,
  sniffInboundMediaContent,
} from './inbound-media-policy.js';

test('sniff rechaza contenido vacío o falsificado', () => {
  assert.equal(sniffInboundMediaContent(Buffer.alloc(0)), null);
  assert.equal(sniffInboundMediaContent(Buffer.from('not-media')), null);
  assert.equal(sniffInboundMediaContent(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 'image/jpeg');
});

test('fallos 4xx HTTP son permanentes salvo 429', () => {
  assert.equal(isPermanentInboundMediaFailure('download_http_404'), true);
  assert.equal(isPermanentInboundMediaFailure('download_http_429'), false);
  assert.equal(isPermanentInboundMediaFailure('download_failed'), false);
});