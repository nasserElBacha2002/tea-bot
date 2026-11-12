#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

async function testFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(full));
    else if (entry.name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

// Esos archivos escriben tea-bot a la vez. En paralelo, el UPDLOCK de handoffs
// y el DELETE en cascada de conversations cruzan range locks con los INSERT.
// Cada archivo sigue corriendo sus pruebas; no se reintenta ni se omite.
function sharesDatabase(file) {
  const name = path.basename(file);
  return name.endsWith('.integration.test.js')
    || name === 'conversation-takeover.distributed.test.js';
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

const files = (await testFiles(src)).sort();
const database = files.filter(sharesDatabase);
const isolated = files.filter((file) => !sharesDatabase(file));
if (isolated.length === 0 || database.length === 0) {
  console.error('run-test-suite: el reparto de archivos quedó vacío');
  process.exit(1);
}

console.error(`# unitarias en paralelo: ${isolated.length} archivos`);
const unitCode = await run(['--test', ...isolated]);
if (unitCode !== 0) process.exit(unitCode);

console.error(`# integracion SQL en serie: ${database.length} archivos`);
process.exit(await run(['--test', '--test-concurrency=1', ...database]));
