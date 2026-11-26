#!/usr/bin/env node
/**
 * Métricas por función con ESLint programático.
 * Reglas: complexity, max-lines-per-function, max-params, max-depth, max-statements.
 * Los tests quedan fuera. Escribe audit/raw/function-metrics.json.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const requireFromFrontend = createRequire(path.join(repoRoot, 'frontend/package.json'));

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);
const TEST_RE = /\.(test|spec|integration\.test)\.[cm]?[jt]sx?$/;

function loadThresholds() {
  const raw = readFileSync(path.join(repoRoot, 'scripts/audit/config/thresholds.json'), 'utf8');
  return JSON.parse(raw);
}

function isTest(rel) {
  return TEST_RE.test(rel) || rel.includes('/__tests__/');
}

async function walk(dir, acc = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (SOURCE_EXT.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

function ruleValue(message, pattern) {
  const match = pattern.exec(message);
  return match ? Number(match[1]) : null;
}

function functionName(message) {
  const named = /(?:function|method) '([^']+)'/i.exec(message);
  if (named) return named[1];
  if (/arrow function/i.test(message)) return '(arrow)';
  return '(anonymous)';
}

/**
 * Lint one source. Exported for unit tests.
 * @param {string} code
 * @param {string} filename
 * @param {{ Linter: any, tsParser: any, thresholds: any }} tools
 */
export function lintSource(code, filename, tools) {
  const { Linter, tsParser, thresholds } = tools;
  const smells = thresholds.code_smells || {};
  const ccHigh = Number(thresholds?.complexity?.function_cyclomatic_high ?? 25);
  const lineWarn = Number(smells.method_lines?.warning ?? 80);
  const paramWarn = Number(smells.param_count?.warning ?? 6);
  const maxDepth = Number(smells.max_depth ?? 4);
  const maxStatements = Number(smells.max_statements ?? 50);
  const ext = path.extname(filename);
  const useTs = ext === '.ts' || ext === '.tsx' || ext === '.jsx';
  const linter = new Linter({ configType: 'flat' });
  const config = [
    {
      files: ['**/*.{js,jsx,ts,tsx,mjs}'],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: useTs ? tsParser : undefined,
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      rules: {
        // ESLint reports when the value is greater than max.
        // complexity max 24 ⇒ CC >= 25 (function_cyclomatic_high).
        complexity: ['warn', Math.max(0, ccHigh - 1)],
        'max-lines-per-function': ['warn', { max: lineWarn, skipBlankLines: false, skipComments: false, IIFEs: true }],
        'max-params': ['warn', paramWarn],
        'max-depth': ['warn', maxDepth],
        'max-statements': ['warn', maxStatements],
      },
    },
  ];
  let messages = [];
  try {
    messages = linter.verify(code, config, { filename });
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error), functions: [] };
  }
  const fatal = messages.find((item) => item.fatal);
  if (fatal) {
    return { ok: false, error: fatal.message, functions: [] };
  }
  const functions = [];
  for (const message of messages) {
    if (!message.ruleId) continue;
    const name = functionName(message.message || '');
    const row = {
      file: filename,
      name,
      line: message.line || 1,
      rule: message.ruleId,
      message: message.message,
    };
    if (message.ruleId === 'complexity') row.complexity = ruleValue(message.message, /complexity of (\d+)/);
    if (message.ruleId === 'max-lines-per-function') row.lines = ruleValue(message.message, /too many lines \((\d+)\)/);
    if (message.ruleId === 'max-params') row.params = ruleValue(message.message, /too many parameters \((\d+)\)/);
    if (message.ruleId === 'max-depth') row.depth = ruleValue(message.message, /too deeply \((\d+)\)/);
    if (message.ruleId === 'max-statements') row.statements = ruleValue(message.message, /too many statements \((\d+)\)/);
    functions.push(row);
  }
  return { ok: true, functions };
}

async function main() {
  const outDir = path.join(repoRoot, 'audit/raw');
  const outFile = path.join(outDir, 'function-metrics.json');
  await mkdir(outDir, { recursive: true });
  let Linter;
  let tsParser;
  let thresholds;
  try {
    ({ Linter } = requireFromFrontend('eslint'));
    tsParser = requireFromFrontend('typescript-eslint').parser;
    thresholds = loadThresholds();
  } catch (error) {
    const payload = { ok: false, error: `missing_tool: ${error.message}` };
    await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
    console.error(payload.error);
    process.exit(2);
  }
  const roots = (thresholds.scan_roots || ['whatsapp-bot/src', 'frontend/src']).map((rel) => path.join(repoRoot, rel));
  const files = [];
  for (const root of roots) {
    const found = await walk(root);
    files.push(...found);
  }
  const tools = { Linter, tsParser, thresholds };
  const rows = [];
  const parseErrors = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (isTest(rel)) continue;
    const code = await readFile(file, 'utf8');
    const result = lintSource(code, rel, tools);
    if (!result.ok) {
      parseErrors.push({ file: rel, error: result.error });
      continue;
    }
    rows.push(...result.functions);
  }
  const payload = {
    ok: true,
    function_count: rows.length,
    parse_errors: parseErrors.slice(0, 40),
    functions: rows,
  };
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  const cc = rows.filter((row) => row.rule === 'complexity').length;
  const long = rows.filter((row) => row.rule === 'max-lines-per-function').length;
  const params = rows.filter((row) => row.rule === 'max-params').length;
  console.log(`function-metrics cc=${cc} long=${long} params=${params} parse_errors=${parseErrors.length}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
