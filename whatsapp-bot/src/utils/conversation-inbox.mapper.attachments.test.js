import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAttachmentPublic, mapMessagePublic } from './conversation-inbox.mapper.js';

test('mapAttachmentPublic no expone storage ni source', () => {
  const mapped = mapAttachmentPublic({
    id: 'a1',
    ordinal: 0,
    mimeType: 'image/jpeg',
    byteSize: 1200,
    originalName: 'foto.jpg',
    status: 'stored',
    storageKey: 'secret-key',
    sourceUrl: 'https://api.twilio.com/media',
  });
  assert.deepEqual(mapped, {
    id: 'a1',
    ordinal: 0,
    mimeType: 'image/jpeg',
    byteSize: 1200,
    originalName: 'foto.jpg',
    status: 'stored',
  });
  assert.equal('storageKey' in mapped, false);
  assert.equal('sourceUrl' in mapped, false);
});

test('mapMessagePublic incluye attachments vacíos por defecto', () => {
  const msg = mapMessagePublic({
    id: 'm1',
    conversationId: 'c1',
    direction: 'inbound',
    senderType: 'user',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  assert.deepEqual(msg.attachments, []);
});

test('mapMessagePublic adjunta metadatos por mensaje', () => {
  const msg = mapMessagePublic(
    {
      id: 'm1',
      conversationId: 'c1',
      direction: 'inbound',
      senderType: 'user',
      body: '',
      provider: 'twilio',
      providerMessageId: null,
      metadataJson: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      attachments: [{
        id: 'att-1',
        ordinal: 0,
        mimeType: 'application/pdf',
        byteSize: 900,
        originalName: 'doc.pdf',
        status: 'stored',
      }],
    },
  );
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].mimeType, 'application/pdf');
});