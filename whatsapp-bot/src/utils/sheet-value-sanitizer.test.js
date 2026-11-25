import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSheetCellValue } from './sheet-value-sanitizer.js';

test('sanitizeSheetCellValue conserva literales RAW', () => {
  assert.equal(sanitizeSheetCellValue('+54911'), '+54911');
  assert.equal(sanitizeSheetCellValue('-1200'), '-1200');
  assert.equal(sanitizeSheetCellValue('user@example.com'), 'user@example.com');
  assert.equal(sanitizeSheetCellValue('Carreras a distancia'), 'Carreras a distancia');
});

test('sanitizeSheetCellValue neutraliza fórmulas solo en modo CSV', () => {
  assert.equal(sanitizeSheetCellValue('=1+1', { rawLiteral: false }), "'=1+1");
  assert.equal(sanitizeSheetCellValue('+54911', { rawLiteral: false }), '+54911');
});