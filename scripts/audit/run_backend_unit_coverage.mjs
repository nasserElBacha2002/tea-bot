#!/usr/bin/env node
// Cobertura de las pruebas unitarias del backend (sin integración SQL).
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = path.join(repo, 'whatsapp-bot');
const src = path.join(backend, 'src');
const rawDir = path.join(repo, 'audit/raw');

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

function classifyLine(line) {
  if (/AssertionError|ERR_ASSERTION/.test(line)) return 'assertion';
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|ERR_REQUIRE_ESM/.test(line)) return 'config';
  if (/ECONN|ETIMEOUT|SQL Server|ConnectionError/i.test(line)) return 'infra';
  return 'other';
}

function summarizeOutput(text, exitCode) {
  const kinds = { assertion: 0, config: 0, infra: 0, other: 0 };
  let failCount = 0;
  const summary = text.match(/# fail (\d+)/);
  if (summary) {
    failCount = Number(summary[1]);
  } else {
    const failLines = text.match(/^✖\s.+$/gm) || [];
    failCount = failLines.length;
  }
  const blocks = text.split(/\n(?=# Subtest:|^✖ )/gm);
  for (const block of blocks) {
    if (!/^✖/.test(block.trim()) && !block.includes('✖')) continue;
    const kind = classifyLine(block);
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  if (!Object.values(kinds).some((n) => n > 0) && failCount > 0) {
    kinds.assertion = failCount;
  }
  if (exitCode !== 0 && failCount === 0) {
    failCount = 1;
    kinds.other = 1;
  }
  return { fail_count: failCount, failure_kinds: kinds };
}

const files = (await walk(src)).filter((file) => !isIntegration(file)).sort();
if (files.length === 0) {
  console.error('run_backend_unit_coverage: no hay pruebas unitarias');
  process.exit(1);
}

await mkdir(rawDir, { recursive: true });
const logPath = path.join(rawDir, 'backend-unit-tests.log');
const jsonOut = path.join(rawDir, 'backend-unit-tests.json');
const tapPath = path.join(rawDir, 'backend-unit-tests.tap');

const args = [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.js',
  '--test-coverage-exclude=src/**/*.test.js',
  '--test-reporter=spec',
  '--test-reporter=tap',
  '--test-reporter-destination=stdout',
  '--test-reporter-destination',
  tapPath,
  ...files,
];

const child = spawn(process.execPath, args, { cwd: backend, stdio: ['inherit', 'pipe', 'pipe'] });
let captured = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  captured += text;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  captured += text;
  process.stderr.write(chunk);
});
child.on('exit', async (code, signal) => {
  const exitCode = signal ? 1 : (code ?? 1);
  await writeFile(logPath, captured);
  let tapText = '';
  try {
    const { readFile } = await import('node:fs/promises');
    tapText = await readFile(tapPath, 'utf8');
  } catch {
    tapText = '';
  }
  const parsed = summarizeOutput(`${captured}\n${tapText}`, exitCode);
  const summary = {
    exit_code: exitCode,
    ...parsed,
    files_executed: files.length,
  };
  await writeFile(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(exitCode);
});