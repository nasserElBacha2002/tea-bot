import test from 'node:test';
import assert from 'node:assert/strict';
import conversationSheetFormatterService, {
  CONVERSATION_ID_COLUMN_HEADER,
  findSheetRowByConversationId,
  resolveManagedSheetRow,
} from './conversationSheetFormatter.service.js';

test('findSheetRowByConversationId devuelve null con IDs duplicados', () => {
  const headers = conversationSheetFormatterService.humanHeaders();
  const idIdx = headers.indexOf(CONVERSATION_ID_COLUMN_HEADER);
  const row = new Array(headers.length).fill('—');
  row[idIdx] = 'conv-dup';
  const resolved = resolveManagedSheetRow(headers, [row, [...row]], 'conv-dup');
  assert.equal(resolved.status, 'duplicate');
  assert.equal(findSheetRowByConversationId(headers, [row, [...row]], 'conv-dup'), null);
});