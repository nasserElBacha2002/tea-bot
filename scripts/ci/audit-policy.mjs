/**
 * npm audit --omit=dev policy (fail-closed).
 * Mismo evaluador en local y en CI.
 * Exit codes: 0 ok, 1 policy violation (advisory nuevo), 2 scanner / reporte inválido.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_OK = 0;
export const EXIT_POLICY = 1;
export const EXIT_SCANNER = 2;

/**
 * @param {string} raw
 * @param {number | undefined} npmExitCode
 */
export function parseAuditReport(raw, npmExitCode) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, code: EXIT_SCANNER, reason: 'empty audit output' };
  }

  let report;
  const start = trimmed.indexOf('{');
  const jsonText = start >= 0 ? trimmed.slice(start) : trimmed;
  try {
    report = JSON.parse(jsonText);
  } catch {
    return { ok: false, code: EXIT_SCANNER, reason: 'invalid JSON from npm audit' };
  }

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, code: EXIT_SCANNER, reason: 'unexpected JSON root (not an object)' };
  }

  if (report.error && typeof report.error === 'object') {
    const msg = report.error.message || report.error.summary || JSON.stringify(report.error);
    return { ok: false, code: EXIT_SCANNER, reason: `npm audit error: ${msg}` };
  }

  const meta = report.metadata;
  if (meta?.error) {
    return { ok: false, code: EXIT_SCANNER, reason: `audit metadata error: ${meta.error}` };
  }

  const hasVulnMap = report.vulnerabilities && typeof report.vulnerabilities === 'object' && !Array.isArray(report.vulnerabilities);
  const hasAdvisories =
    report.advisories && typeof report.advisories === 'object' && !Array.isArray(report.advisories);
  const hasMeta = meta && typeof meta === 'object';

  if (!hasVulnMap && !hasAdvisories) {
    if (npmExitCode !== undefined && npmExitCode > 1) {
      return { ok: false, code: EXIT_SCANNER, reason: `npm audit exit ${npmExitCode} without advisory maps` };
    }
    return { ok: false, code: EXIT_SCANNER, reason: 'missing vulnerabilities/advisories section' };
  }

  if (!hasMeta && !hasVulnMap && Object.keys(hasAdvisories ? report.advisories : {}).length === 0) {
    return { ok: false, code: EXIT_SCANNER, reason: 'incomplete report: no metadata and empty advisories' };
  }

  if (npmExitCode !== undefined && npmExitCode > 1) {
    return { ok: false, code: EXIT_SCANNER, reason: `npm audit operational failure (exit ${npmExitCode})` };
  }

  return { ok: true, report };
}

/**
 * @param {Record<string, unknown>} report
 */
export function collectHighCritical(report) {
  const items = new Map();
  const vulns = report.vulnerabilities || {};
  for (const [name, vuln] of Object.entries(vulns)) {
    const parentSeverity = String(vuln.severity || '').toLowerCase();
    if (parentSeverity !== 'high' && parentSeverity !== 'critical') continue;
    for (const via of vuln.via || []) {
      if (!via || typeof via !== 'object') continue;
      const severity = String(via.severity || parentSeverity).toLowerCase();
      if (severity !== 'high' && severity !== 'critical') continue;
      const url = String(via.url || '');
      const match = url.match(/GHSA-[a-z0-9-]+/i);
      const source = via.source != null ? String(via.source) : '';
      const id = match ? match[0] : (source.startsWith('GHSA-') ? source : '');
      const key = id || `unidentified:${name}:${via.title || source || 'advisory'}`;
      items.set(key, {
        id,
        severity,
        package: via.name || name,
        title: via.title || '',
        url,
        range: via.range || '',
      });
    }
  }
  for (const advisory of Object.values(report.advisories || {})) {
    const severity = String(advisory.severity || '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') continue;
    const rawId = String(advisory.github_advisory_id || '');
    const id = rawId.startsWith('GHSA-') ? rawId : '';
    const key = id || `unidentified:${advisory.module_name}:${advisory.id || advisory.title || 'advisory'}`;
    items.set(key, {
      id,
      severity,
      package: advisory.module_name,
      title: advisory.title || '',
      url: advisory.url || '',
      range: advisory.vulnerable_versions || '',
    });
  }
  return [...items.values()];
}

/**
 * @param {object} entry
 * @param {{ id: string, package?: string, severity?: string, range?: string }} finding
 */
export function allowlistMatches(entry, finding) {
  if (entry.id !== finding.id) return false;
  if (entry.package && entry.package !== finding.package) return false;
  if (entry.severity && String(entry.severity).toLowerCase() !== String(finding.severity).toLowerCase()) {
    return false;
  }
  if (entry.affected_range !== '*' && finding.range) {
    if (finding.range !== entry.affected_range && !finding.range.includes(entry.affected_range)) {
      return false;
    }
  }
  const reviewBy = entry.review_by ? Date.parse(entry.review_by) : NaN;
  if (!Number.isFinite(reviewBy) || Date.now() > reviewBy) return false;
  return true;
}

/**
 * @param {unknown[]} allowlist
 * @param {ReturnType<typeof collectHighCritical>} found
 */
export function evaluateFindings(allowlist, found) {
  const allowed = allowlist.filter((x) => x && typeof x === 'object');
  const unexpected = [];
  for (const item of found) {
    if (!item.id || !String(item.id).startsWith('GHSA-')) {
      unexpected.push(item);
      continue;
    }
    const match = allowed.find((e) => allowlistMatches(e, item));
    if (match) {
      console.log(`[audit] allowlisted ${item.severity} ${item.id} ${item.package} (${match.reason || 'listed'})`);
      continue;
    }
    unexpected.push(item);
  }
  return unexpected;
}

function validateAllowlistEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`allowlist[${index}]: not an object`);
  }
  if (!entry.id || typeof entry.id !== 'string' || !entry.id.startsWith('GHSA-')) {
    throw new Error(`allowlist[${index}]: id must be a GHSA advisory id`);
  }
  if (!entry.package || typeof entry.package !== 'string') {
    throw new Error(`allowlist[${index}]: missing package for ${entry.id}`);
  }
  if (!entry.severity || typeof entry.severity !== 'string') {
    throw new Error(`allowlist[${index}]: missing severity for ${entry.id}`);
  }
  const sev = String(entry.severity).toLowerCase();
  if (!['high', 'critical'].includes(sev)) {
    throw new Error(`allowlist[${index}]: severity must be high/critical`);
  }
  const reviewBy = entry.review_by ? Date.parse(entry.review_by) : NaN;
  if (!Number.isFinite(reviewBy)) {
    throw new Error(`allowlist[${index}]: invalid review_by for ${entry.id}`);
  }
  if (Date.now() > reviewBy) {
    throw new Error(`allowlist[${index}]: expired review_by for ${entry.id}`);
  }
  if (entry.affected_range === '*' && !entry.allow_wildcard_range) {
    throw new Error(`allowlist[${index}]: wildcard affected_range requires allow_wildcard_range for ${entry.id}`);
  }
  if (!entry.affected_range) {
    throw new Error(`allowlist[${index}]: missing affected_range for ${entry.id}`);
  }
  if (sev === 'critical' && !entry.critical_waiver) {
    throw new Error(`allowlist[${index}]: critical ${entry.id} requires explicit critical_waiver`);
  }
}

export function loadAllowlist(rootDir) {
  const path = join(rootDir, 'audit-allowlist.json');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error('audit-allowlist.json must be an array');
  }
  data.forEach((entry, index) => validateAllowlistEntry(entry, index));
  return data;
}

export function runFromStdin(rootDir) {
  const npmExit = process.env.NPM_AUDIT_EXIT_CODE
    ? Number(process.env.NPM_AUDIT_EXIT_CODE)
    : undefined;
  const raw = readFileSync(0, 'utf8');
  const parsed = parseAuditReport(raw, npmExit);
  if (!parsed.ok) {
    console.error(`[audit] scanner: ${parsed.reason}`);
    process.exit(parsed.code);
  }
  let allowlist;
  try {
    allowlist = loadAllowlist(rootDir);
  } catch (err) {
    console.error(`[audit] scanner: ${err.message}`);
    process.exit(EXIT_SCANNER);
  }
  const found = collectHighCritical(parsed.report);
  const unexpected = evaluateFindings(allowlist, found);
  if (unexpected.length > 0) {
    console.error('[audit] new HIGH/CRITICAL production advisories (not in allowlist):');
    for (const item of unexpected) {
      console.error(`  ${item.severity} ${item.id} ${item.package} ${item.url}`);
    }
    process.exit(EXIT_POLICY);
  }
  console.log(`[audit] policy ok (${found.length} inherited HIGH/CRITICAL, 0 new)`);
  process.exit(EXIT_OK);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = dirname(fileURLToPath(import.meta.url));
  runFromStdin(root);
}
