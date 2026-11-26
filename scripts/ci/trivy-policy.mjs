#!/usr/bin/env node
/**
 * Trivy fs policy. HIGH/CRITICAL vulnerabilities block unless the advisory id
 * (CVE- or GHSA-) is allowlisted with a review_by date. Package name alone is not an allowlist key.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_RE = /^(CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)$/i;

export function collectVulns(report) {
  const items = new Map();
  for (const result of report.Results || []) {
    for (const vuln of result.Vulnerabilities || []) {
      const severity = String(vuln.Severity || '').toUpperCase();
      if (severity !== 'HIGH' && severity !== 'CRITICAL') continue;
      const id = String(vuln.VulnerabilityID || '');
      const pkg = vuln.PkgName || '';
      const key = ID_RE.test(id) ? `${id}|${pkg}` : `unidentified:${pkg}:${vuln.Title || 'vuln'}`;
      items.set(key, {
        id: ID_RE.test(id) ? id : '',
        severity: severity.toLowerCase(),
        package: vuln.PkgName || '',
        title: vuln.Title || '',
        range: vuln.InstalledVersion || '',
      });
    }
  }
  return [...items.values()];
}

export function allowlistMatches(entry, finding) {
  if (!finding.id || entry.id !== finding.id) return false;
  if (entry.package && entry.package !== finding.package) return false;
  if (entry.severity && String(entry.severity).toLowerCase() !== finding.severity) return false;
  const reviewBy = entry.review_by ? Date.parse(entry.review_by) : NaN;
  if (!Number.isFinite(reviewBy) || Date.now() > reviewBy) return false;
  return true;
}

function validate(entry, index) {
  if (!entry || typeof entry !== 'object') throw new Error(`trivy allowlist[${index}]: not an object`);
  if (!entry.id || !ID_RE.test(entry.id)) {
    throw new Error(`trivy allowlist[${index}]: id must be CVE- or GHSA-`);
  }
  if (!entry.package || typeof entry.package !== 'string') {
    throw new Error(`trivy allowlist[${index}]: missing package for ${entry.id}`);
  }
  const sev = String(entry.severity || '').toLowerCase();
  if (!['high', 'critical'].includes(sev)) {
    throw new Error(`trivy allowlist[${index}]: severity must be high/critical`);
  }
  const reviewBy = entry.review_by ? Date.parse(entry.review_by) : NaN;
  if (!Number.isFinite(reviewBy)) throw new Error(`trivy allowlist[${index}]: invalid review_by`);
  if (Date.now() > reviewBy) throw new Error(`trivy allowlist[${index}]: expired review_by for ${entry.id}`);
  if (sev === 'critical' && !entry.critical_waiver) {
    throw new Error(`trivy allowlist[${index}]: critical ${entry.id} requires critical_waiver`);
  }
}

export function loadAllowlist(rootDir) {
  const data = JSON.parse(readFileSync(join(rootDir, 'trivy-allowlist.json'), 'utf8'));
  if (!Array.isArray(data)) throw new Error('trivy-allowlist.json must be an array');
  data.forEach(validate);
  return data;
}

function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('[trivy] scanner: report path required');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.error(`[trivy] scanner: invalid report (${err.message})`);
    process.exit(2);
  }
  let allowlist;
  try {
    allowlist = loadAllowlist(dirname(fileURLToPath(import.meta.url)));
  } catch (err) {
    console.error(`[trivy] scanner: ${err.message}`);
    process.exit(2);
  }
  const found = collectVulns(report);
  const unexpected = [];
  for (const item of found) {
    if (!item.id) {
      unexpected.push(item);
      continue;
    }
    const match = allowlist.find((entry) => allowlistMatches(entry, item));
    if (match) {
      console.log(`[trivy] allowlisted ${item.severity} ${item.id} ${item.package}`);
      continue;
    }
    unexpected.push(item);
  }
  if (unexpected.length > 0) {
    console.error('[trivy] new HIGH/CRITICAL vulnerabilities:');
    for (const item of unexpected) {
      console.error(`  ${item.severity} ${item.id || '(sin id)'} ${item.package} ${item.title}`);
    }
    process.exit(1);
  }
  console.log(`[trivy] policy ok (${found.length} inherited HIGH/CRITICAL, 0 new)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
