import test from 'node:test';
import assert from 'node:assert/strict';
import { columnToLetter } from './googleSheets.service.js';

test('columnToLetter mapea índices de columna', () => {
  assert.equal(columnToLetter(0), 'A');
  assert.equal(columnToLetter(12), 'M');
  assert.equal(columnToLetter(13), 'N');
  assert.equal(columnToLetter(25), 'Z');
  assert.equal(columnToLetter(26), 'AA');
});
