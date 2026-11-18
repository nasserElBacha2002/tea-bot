import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentDispositionHeader } from './http-content-disposition.js';

test('buildContentDispositionHeader escapa comillas y unicode', () => {
  const header = buildContentDispositionHeader('attachment', 'factura "marzo".pdf');
  assert.match(header, /^attachment; filename="/);
  assert.match(header, /filename\*=UTF-8''factura%20%22marzo%22\.pdf/);
  assert.doesNotMatch(header, /filename="[^"]*"[^;]*"/);
});

test('buildContentDispositionHeader sanea caracteres de control', () => {
  const header = buildContentDispositionHeader('inline', 'foto\n\t.jpg');
  assert.equal(header.includes('\n'), false);
  assert.match(header, /filename=/);
});