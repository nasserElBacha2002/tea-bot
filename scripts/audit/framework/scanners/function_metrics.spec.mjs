import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintSource } from './function_metrics.mjs';

const requireFromFrontend = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../frontend/package.json'),
);

test('eslint flags CC, length and processNode-style parameter lists', () => {
  const { Linter } = requireFromFrontend('eslint');
  const tsParser = requireFromFrontend('typescript-eslint').parser;
  const thresholds = {
    complexity: { function_cyclomatic_high: 25 },
    code_smells: {
      method_lines: { warning: 80 },
      param_count: { warning: 6 },
      max_depth: 4,
      max_statements: 50,
    },
  };
  const params = Array.from({ length: 10 }, (_, index) => `p${index}`).join(', ');
  const body = Array.from({ length: 90 }, (_, index) => `  if (p0 && p1) { return ${index}; }`).join('\n');
  const code = `export function processNode(${params}) {\n${body}\n}\n`;
  const result = lintSource(code, 'whatsapp-bot/src/services/flow-engine.service.js', {
    Linter,
    tsParser,
    thresholds,
  });
  assert.equal(result.ok, true, result.error);
  const byRule = Object.groupBy(result.functions, (row) => row.rule);
  assert.ok(byRule.complexity?.some((row) => row.name === 'processNode' && row.complexity >= 25));
  assert.ok(byRule['max-lines-per-function']?.some((row) => row.name === 'processNode' && row.lines > 80));
  assert.ok(byRule['max-params']?.some((row) => row.name === 'processNode' && row.params === 10));
  assert.ok(byRule['max-statements']?.some((row) => row.name === 'processNode' && row.statements > 50));
});
