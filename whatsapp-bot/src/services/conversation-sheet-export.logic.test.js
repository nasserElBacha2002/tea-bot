import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSheetExportAction,
  mapRowValuesToSheetHeaders,
  findDuplicateHeaders,
} from './conversation-sheet-export.logic.js';
import { SHEET_EXPORT_OUTCOMES } from './sheet-export-outcome.js';

test('decideSheetExportAction aborta append ante ID duplicado', () => {
  const decision = decideSheetExportAction({
    resolved: { status: 'duplicate', reason: 'duplicate_conversation_id_rows' },
    existingLedger: null,
    escalation: false,
    updateEnabled: true,
  });
  assert.equal(decision.action, 'abort');
  assert.equal(decision.outcome, SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT);
});

test('decideSheetExportAction permite append solo cuando not_found', () => {
  const decision = decideSheetExportAction({
    resolved: { status: 'not_found' },
    existingLedger: null,
    escalation: false,
    updateEnabled: false,
  });
  assert.equal(decision.action, 'append');
});

test('decideSheetExportAction bloquea append si fila existe sin update', () => {
  const decision = decideSheetExportAction({
    resolved: { status: 'unique', sheetRow: 12 },
    existingLedger: null,
    escalation: false,
    updateEnabled: false,
  });
  assert.equal(decision.action, 'abort');
  assert.equal(decision.outcome, SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT);
});

test('mapRowValuesToSheetHeaders respeta orden de planilla', () => {
  const sheetHeaders = ['Observaciones', 'Email', 'Conversation ID'];
  const sourceHeaders = ['Conversation ID', 'Email', 'Observaciones'];
  const sourceRow = ['cid-1', 'user@example.com', 'admin'];
  const mapped = mapRowValuesToSheetHeaders(sheetHeaders, sourceHeaders, sourceRow);
  assert.deepEqual(mapped, ['admin', 'user@example.com', 'cid-1']);
});

test('findDuplicateHeaders detecta encabezados duplicados', () => {
  const dupes = findDuplicateHeaders(['A', 'B', 'A', 'C', 'B']);
  assert.deepEqual(dupes.sort(), ['A', 'B']);
});