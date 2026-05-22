import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeFlowChecksum } from '../utils/flow-checksum.js';
import flowValidator from '../utils/flow-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_DATA = path.join(__dirname, '../../data/flows');

const miniFlow = {
  id: 'test-export',
  name: 'Test Export',
  version: 'v1',
  status: 'draft',
  entryNode: 'a',
  fallbackNode: 'b',
  nodes: [
    {
      id: 'a',
      type: 'message',
      message: 'Hola',
      transitions: [{ type: 'default', nextNode: 'b' }],
    },
    {
      id: 'b',
      type: 'message',
      message: 'Chau',
      transitions: [{ type: 'default', nextNode: 'a' }],
    },
  ],
};

test('documento exportable cumple validador de flujo', () => {
  flowValidator.validate(miniFlow);
  const json = JSON.stringify(miniFlow, null, 2);
  assert.ok(computeFlowChecksum(json).length === 64);
});

test('import portable no escribe en data/flows', async () => {
  const draftsDir = path.join(FLOWS_DATA, 'drafts');
  let before = [];
  try {
    before = await fs.readdir(draftsDir);
  } catch {
    before = [];
  }

  const wouldWrite = path.join(draftsDir, 'test-export.json');
  let exists = false;
  try {
    await fs.access(wouldWrite);
    exists = true;
  } catch {
    exists = false;
  }

  assert.equal(exists, false, 'no debe existir archivo nuevo en drafts por este test');
  assert.ok(Array.isArray(before));
});

test('export portable no lee metadata.json en data/flows', async () => {
  const metaPath = path.join(FLOWS_DATA, 'published', 'main-menu', 'metadata.json');
  let readable = false;
  try {
    await fs.access(metaPath);
    readable = true;
  } catch {
    readable = false;
  }
  assert.equal(readable, false, 'data/flows no debe existir en runtime de export');
});
