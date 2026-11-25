import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeLikeLiteral,
  buildLikePattern,
  validateSearchQuery,
  findMatchRange,
  buildSnippet,
  decodeSearchCursor,
  encodeSearchCursor,
  parseSearchLimit,
  parseSearchGroups,
  searchTermFingerprint,
} from './conversation-search.js';

test('escapeLikeLiteral escapa comodines SQL', () => {
  assert.equal(escapeLikeLiteral('100%'), '100\\%');
  assert.equal(escapeLikeLiteral('a_b'), 'a\\_b');
  assert.equal(escapeLikeLiteral('[x]'), '\\[x\\]');
  assert.equal(escapeLikeLiteral('a\\b'), 'a\\\\b');
});

test('buildLikePattern incluye comodines externos', () => {
  assert.equal(buildLikePattern('tea'), '%tea%');
  assert.equal(buildLikePattern('100%'), '%100\\%%');
});

test('validateSearchQuery aplica límites', () => {
  assert.equal(validateSearchQuery('a').ok, false);
  assert.equal(validateSearchQuery('ab').ok, true);
  assert.equal(validateSearchQuery('x'.repeat(129)).ok, false);
  assert.equal(validateSearchQuery(42).ok, false);
});

test('findMatchRange es insensible a mayúsculas y acentos', () => {
  const match = findMatchRange('Quería café con leche', 'CAFE');
  assert.ok(match);
  assert.equal('Quería café con leche'.slice(match.start, match.end).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(), 'café'.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
});

test('buildSnippet centra coincidencia', () => {
  const long = `${'a'.repeat(80)}INSCRIPCIÓN${'z'.repeat(80)}`;
  const { snippet, highlightStart, highlightEnd } = buildSnippet(long, 'inscripcion');
  assert.match(snippet, /INSCRIPCIÓN/i);
  assert.ok(highlightEnd > highlightStart);
});

test('parseSearchLimit rechaza límites inválidos', () => {
  assert.equal(parseSearchLimit(0).ok, false);
  assert.equal(parseSearchLimit(51).ok, false);
  assert.equal(parseSearchLimit('x').ok, false);
  assert.equal(parseSearchLimit(25).ok, true);
});

test('parseSearchGroups valida alcance', () => {
  assert.equal(parseSearchGroups('contacts').ok, true);
  assert.equal(parseSearchGroups('bogus').ok, false);
});

test('cursores v2 base64url roundtrip y contexto', () => {
  const ctx = { scope: 'message_global', q: 'café' };
  const raw = encodeSearchCursor({
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-01-15T12:34:56.7890123Z',
  }, ctx);
  assert.ok(raw);
  const decoded = decodeSearchCursor(raw, ctx);
  assert.equal(decoded.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(decoded.createdAt, '2026-01-15T12:34:56.7890123Z');
  assert.equal(decodeSearchCursor(raw, { scope: 'contact', q: 'café' }), null);
  assert.equal(decodeSearchCursor('not-json', ctx), null);
  const nullDate = encodeSearchCursor({
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: null,
  }, { scope: 'contact', q: 'ab' });
  const decodedNull = decodeSearchCursor(nullDate, { scope: 'contact', q: 'ab' });
  assert.equal(decodedNull.createdAt, null);
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  assert.equal(parsed.qh, searchTermFingerprint('café'));
  assert.equal(parsed.q, undefined);
});