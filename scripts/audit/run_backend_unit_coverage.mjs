#!/usr/bin/env node
// Cobertura de las pruebas unitarias del backend (sin integración SQL).
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = path.join(repo, 'whatsapp-bot');
const src = path.join(backend, 'src');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

function isIntegration(file) {
  const name = path.basename(file);
  return name.endsWith('.integration.test.js') || name === 'conversation-takeover.distributed.test.js';
}

const files = (await walk(src)).filter((file) => !isIntegration(file)).sort();
if (files.length === 0) {
  console.error('run_backend_unit_coverage: no hay pruebas unitarias');
  process.exit(1);
}

const args = [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.js',
  '--test-coverage-exclude=src/**/*.test.js',
  '--test-reporter=spec',
  ...files,
];

const child = spawn(process.execPath, args, { cwd: backend, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
