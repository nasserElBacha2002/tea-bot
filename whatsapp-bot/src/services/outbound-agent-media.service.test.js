import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentOutboundAttachment } from './outbound-agent-media.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test('parseAgentOutboundAttachment valida PNG', () => {
  const parsed = parseAgentOutboundAttachment({
    mimeType: 'image/png',
    fileName: 'foto.png',
    contentBase64: PNG.toString('base64'),
  });
  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.byteSize, PNG.length);
});

test('parseAgentOutboundAttachment rechaza MIME no permitido', () => {
  assert.throws(
    () => parseAgentOutboundAttachment({
      mimeType: 'text/plain',
      contentBase64: Buffer.from('hola').toString('base64'),
    }),
    (err) => err.code === 'MIME_NOT_ALLOWED',
  );
});

test('parseAgentOutboundAttachment rechaza contenido inconsistente', () => {
  assert.throws(
    () => parseAgentOutboundAttachment({
      mimeType: 'image/png',
      contentBase64: Buffer.from('%PDF-1.4').toString('base64'),
    }),
    (err) => err.code === 'ATTACHMENT_INVALID',
  );
});