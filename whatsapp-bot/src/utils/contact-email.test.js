import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactEmail, validateContactEmail } from './contact-email.js';

test('normalizeContactEmail trims and lowercases', () => {
  assert.equal(normalizeContactEmail('  Ana@Example.COM '), 'ana@example.com');
});

test('validateContactEmail accepts common formats', () => {
  const samples = [
    'user@example.com',
    'name.surname@school.edu.ar',
    'a+b@domain.co.uk',
  ];
  for (const sample of samples) {
    const result = validateContactEmail(sample);
    assert.equal(result.valid, true, sample);
    assert.equal(result.normalized, sample.toLowerCase());
  }
});

test('validateContactEmail rejects empty and invalid values', () => {
  for (const sample of ['', '   ', 'hola', 'bad@', '@bad.com', 'a @b.com']) {
    const result = validateContactEmail(sample);
    assert.equal(result.valid, false, sample);
  }
});
