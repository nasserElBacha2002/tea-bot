import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactName, validateContactName } from './contact-name.js';

test('normalizeContactName recorta espacios y convierte vacío en null', () => {
  assert.equal(normalizeContactName('  Juan  '), 'Juan');
  assert.equal(normalizeContactName('   '), null);
  assert.equal(normalizeContactName(null), null);
});

test('validateContactName acepta acentos y guiones', () => {
  assert.equal(validateContactName("María O'Connor-Smith"), "María O'Connor-Smith");
});

test('validateContactName rechaza nombre vacío', () => {
  assert.throws(() => validateContactName('   '), (err) => err.code === 'INVALID_CONTACT_NAME');
});

test('validateContactName rechaza nombre demasiado largo', () => {
  assert.throws(
    () => validateContactName('a'.repeat(151)),
    (err) => err.code === 'CONTACT_NAME_TOO_LONG',
  );
});

test('validateContactName rechaza caracteres inválidos', () => {
  assert.throws(() => validateContactName('Juan123'), (err) => err.code === 'INVALID_CONTACT_NAME');
});
