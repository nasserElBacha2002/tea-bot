import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import flowValidator from '../src/utils/flow-validator.js';
import { compileFlow } from '../src/utils/compile-flow.js';
import { COLLECT_EMAIL_NODE_ID, WELCOME_NODE_ID } from '../src/constants/contact-email-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V11_PATH = path.join(__dirname, '../data/flows/published/main-menu/v11.json');
const V10_PATH = path.join(__dirname, '../data/flows/published/main-menu/v10.json');

test('main-menu v11 validates and starts with collect_email', async () => {
  const raw = await fs.readFile(V11_PATH, 'utf8');
  const flow = JSON.parse(raw);
  assert.equal(flow.version, 'v11');
  assert.equal(flow.entryNode, COLLECT_EMAIL_NODE_ID);
  const collect = flow.nodes.find((n) => n.id === COLLECT_EMAIL_NODE_ID);
  const welcome = flow.nodes.find((n) => n.id === WELCOME_NODE_ID);
  assert.ok(collect, 'collect_email node must exist');
  assert.ok(welcome, 'welcome node must exist');
  try {
    flowValidator.validate(flow);
  } catch (error) {
    assert.fail(error.message);
  }
  compileFlow(flow);
});

test('main-menu v10 file is unchanged when present', async () => {
  try {
    const raw = await fs.readFile(V10_PATH, 'utf8');
    const flow = JSON.parse(raw);
    assert.equal(flow.entryNode, WELCOME_NODE_ID);
    assert.equal(flow.nodes.some((n) => n.id === COLLECT_EMAIL_NODE_ID), false);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
});
