import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsMockStore } from '../testing/google-sheets-mock.store.js';

test('mock stateful conserva fila tras append con respuesta perdida', async () => {
  const store = new GoogleSheetsMockStore();
  store.simulateLostAppendResponse = true;
  const headers = ['Conversation ID', 'Consulta principal'];
  const row = ['conv-1', 'Carreras a distancia'];
  const first = await store.appendRow('Conversaciones', row, { headers });
  assert.equal(first.lostResponse, true);
  assert.equal(store.appendCalls, 1);
  assert.deepEqual(store.getRow('Conversaciones', 2), row);
  await store.appendRow('Conversaciones', ['conv-1', 'Duplicado'], { headers });
  assert.equal(store.appendCalls, 2);
  assert.notDeepEqual(store.getRow('Conversaciones', 3), store.getRow('Conversaciones', 2));
});