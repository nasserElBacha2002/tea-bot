import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EXIT_SCANNER,
  allowlistMatches,
  collectHighCritical,
  evaluateFindings,
  loadAllowlist,
  parseAuditReport,
} from './audit-policy.mjs';

const allowlist = [
  {
    id: 'GHSA-aaaa-bbbb-cccc',
    package: 'left-pad',
    severity: 'high',
    review_by: '2099-01-01',
    affected_range: '*',
    allow_wildcard_range: true,
    reason: 'test',
  },
];

function report(via) {
  return {
    metadata: { vulnerabilities: { high: 1 } },
    vulnerabilities: {
      'left-pad': {
        severity: 'high',
        via: [via],
      },
    },
  };
}

test('valid empty report', () => {
  const parsed = parseAuditReport(JSON.stringify({ vulnerabilities: {}, metadata: {} }), 0);
  assert.equal(parsed.ok, true);
  assert.equal(collectHighCritical(parsed.report).length, 0);
});

test('new advisory fails policy', () => {
  const parsed = parseAuditReport(
    JSON.stringify(
      report({
        source: 1,
        name: 'left-pad',
        title: 'new',
        url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx',
        severity: 'high',
        range: '<1.0.0',
      }),
    ),
    1,
  );
  assert.equal(parsed.ok, true);
  const unexpected = evaluateFindings(allowlist, collectHighCritical(parsed.report));
  assert.equal(unexpected.length, 1);
  assert.equal(unexpected[0].id, 'GHSA-zzzz-yyyy-xxxx');
});

test('allowlisted advisory matches by GHSA id', () => {
  const parsed = parseAuditReport(
    JSON.stringify(
      report({
        source: 1,
        name: 'left-pad',
        title: 'known',
        url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
        severity: 'high',
        range: '<1.0.0',
      }),
    ),
    1,
  );
  assert.equal(evaluateFindings(allowlist, collectHighCritical(parsed.report)).length, 0);
});

test('expired review_by does not match', () => {
  const finding = { id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', severity: 'high', range: '<1' };
  assert.equal(allowlistMatches({ ...allowlist[0], review_by: '2000-01-01' }, finding), false);
});

test('package name without GHSA id is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-allow-'));
  writeFileSync(
    join(dir, 'audit-allowlist.json'),
    JSON.stringify([
      {
        id: 'left-pad',
        package: 'left-pad',
        severity: 'high',
        review_by: '2099-01-01',
        affected_range: '*',
        allow_wildcard_range: true,
      },
    ]),
  );
  assert.throws(() => loadAllowlist(dir), /GHSA/);
  rmSync(dir, { recursive: true, force: true });
});

test('high advisory without GHSA id is unexpected', () => {
  const parsed = parseAuditReport(
    JSON.stringify(report({ source: 99, name: 'left-pad', title: 'no-id', url: 'https://example.test/99' })),
    1,
  );
  const found = collectHighCritical(parsed.report);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, '');
  assert.equal(evaluateFindings(allowlist, found).length, 1);
});

test('registry error is a scanner failure', () => {
  const parsed = parseAuditReport(JSON.stringify({ error: { message: 'registry down' } }), 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, EXIT_SCANNER);
});

test('operational exit above 1 is a scanner failure', () => {
  const parsed = parseAuditReport(JSON.stringify({ vulnerabilities: {}, metadata: {} }), 3);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, EXIT_SCANNER);
});
