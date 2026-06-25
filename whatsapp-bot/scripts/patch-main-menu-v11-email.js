#!/usr/bin/env node
/**
 * Adds collect_email entry step to main-menu v11 and validates the result.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import flowValidator from '../src/utils/flow-validator.js';
import { compileFlow } from '../src/utils/compile-flow.js';
import {
  COLLECT_EMAIL_NODE_ID,
  DEFAULT_INVALID_EMAIL_REPLY,
} from '../src/constants/contact-email-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOW_PATH = path.join(__dirname, '../data/flows/published/main-menu/v11.json');

const COLLECT_EMAIL_NODE = {
  id: COLLECT_EMAIL_NODE_ID,
  type: 'message',
  message:
    '👋 *Bienvenido/a a Tea y Deportea*\n\n'
    + 'Soy *TyD*, tu asistente virtual 🤖\n\n'
    + 'Antes de continuar, necesitamos tu *correo electrónico* para poder ayudarte mejor.\n\n'
    + '📧 Por favor, enviá tu email (por ejemplo: *nombre@ejemplo.com*).',
  metadata: {
    invalidEmailMessage: DEFAULT_INVALID_EMAIL_REPLY,
  },
  ui: {
    position: { x: 80, y: 0 },
  },
  transitions: [
    {
      type: 'default',
      nextNode: COLLECT_EMAIL_NODE_ID,
      priority: 0,
    },
  ],
};

async function main() {
  const raw = await fs.readFile(FLOW_PATH, 'utf8');
  const flow = JSON.parse(raw);

  if (flow.entryNode === COLLECT_EMAIL_NODE_ID) {
    const existing = flow.nodes.find((n) => n.id === COLLECT_EMAIL_NODE_ID);
    if (existing) {
      console.log('collect_email already present; entryNode already set.');
      return;
    }
  }

  const withoutCollect = flow.nodes.filter((n) => n.id !== COLLECT_EMAIL_NODE_ID);
  flow.nodes = [COLLECT_EMAIL_NODE, ...withoutCollect];
  flow.entryNode = COLLECT_EMAIL_NODE_ID;
  flow.version = 'v11';

  try {
    flowValidator.validate(flow);
  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }

  compileFlow(flow);
  await fs.writeFile(FLOW_PATH, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
  console.log(`Patched ${FLOW_PATH}: entryNode=${flow.entryNode}, nodes=${flow.nodes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
