#!/usr/bin/env node
/**
 * Builds a validation-ready main-menu flow version from a source JSON document.
 * Fills missing `value` on match/matchIncludes transitions without changing messages.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import flowValidator from '../src/utils/flow-validator.js';
import { compileFlow } from '../src/utils/compile-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(__dirname, '../data/flows/published/main-menu/v11.json');

const EXTRA_KEYWORDS_BY_TARGET = {
  no_presenciales_menu: ['presencial', 'presenciales'],
  no_distancia_menu: ['distancia'],
  no_cursos_info: ['cursos'],
  no_licenciatura_info: ['licenciatura'],
  no_otros_menu: ['otros', 'contactos'],
  si_presenciales_tipo: ['presencial', 'presenciales'],
  si_dist_menu: ['distancia'],
  si_cursos_menu: ['cursos'],
  archivo_info: ['archivo'],
  streaming_info: ['streaming', 'stream'],
  camaras_info: ['cámaras', 'camaras', 'micrófonos', 'microfonos'],
  si_pd_menu: ['deportivo', 'deportea'],
  si_pg_menu: ['general'],
  si_cursos_baja: ['baja'],
  si_cursos_diploma: ['diploma'],
  si_cursos_info: ['información', 'informacion', 'info'],
  si_dist_admin_a: ['problemas', 'pagos'],
  si_dist_admin_b: ['medios', 'pago'],
  si_dist_sec_a: ['regular', 'constancia'],
  si_dist_sec_b: ['baja'],
  si_dist_sec_c: ['programas'],
  si_dist_sec_d: ['analíticos', 'analiticos'],
  si_dist_sec_e: ['inasistencias', 'inasistencia'],
  si_pd_sec_a: ['regular', 'constancia'],
  si_pd_sec_b: ['título', 'titulo', 'trámite', 'tramite'],
  si_pd_sec_c: ['programas'],
  si_pd_sec_d: ['analíticos', 'analiticos'],
  si_pd_sec_e: ['inasistencias', 'inasistencia'],
  si_pd_sec_f: ['acreditaciones', 'acreditación'],
  si_pd_sec_g: ['examen'],
  si_pg_sec_a: ['regular', 'constancia'],
  si_pg_sec_b: ['título', 'titulo', 'trámite', 'tramite'],
  si_pg_sec_c: ['programas'],
  si_pg_sec_d: ['analíticos', 'analiticos'],
  si_pg_sec_e: ['inasistencias', 'inasistencia'],
  si_pg_sec_f: ['acreditaciones', 'acreditación'],
  si_pg_sec_g: ['examen'],
  si_pd_admin_a: ['problemas', 'pagos'],
  si_pd_admin_b: ['medios', 'pago'],
  si_pd_admin_c: ['baja'],
  si_pd_admin_d: ['débito', 'debito', 'cuenta'],
  si_pd_admin_e: ['adhesión', 'adhesion', 'tarjeta'],
  si_pd_admin_f: ['baja débito', 'baja debito'],
  si_pg_admin_a: ['problemas', 'pagos'],
  si_pg_admin_b: ['medios', 'pago'],
  si_pg_admin_c: ['baja'],
  si_pg_admin_d: ['débito', 'debito', 'cuenta'],
  si_pg_admin_e: ['adhesión', 'adhesion', 'tarjeta'],
  si_pg_admin_f: ['baja débito', 'baja debito'],
  si_pd_lic_a: ['ucu', 'usba'],
  si_pd_lic_b: ['convenio', 'universidades'],
  si_pg_lic_a: ['ucu', 'usba'],
  si_pg_lic_b: ['convenio', 'universidades'],
  si_pd_sec_menu: ['secretaría', 'secretaria'],
  si_pd_admin_menu: ['administración', 'administracion'],
  si_pd_direccion: ['dirección', 'direccion', 'estudios'],
  si_pd_clave: ['clave', 'quinttos'],
  si_pd_mail_inst: ['mail', 'institucional'],
  si_pd_lic_menu: ['licenciatura'],
  si_pd_turno: ['turno', 'cambio'],
  si_pd_profesores: ['profesores', 'profesor'],
  si_pg_sec_menu: ['secretaría', 'secretaria'],
  si_pg_admin_menu: ['administración', 'administracion'],
  si_pg_direccion: ['dirección', 'direccion', 'estudios'],
  si_pg_clave: ['clave', 'quinttos'],
  si_pg_mail_inst: ['mail', 'institucional'],
  si_pg_lic_menu: ['licenciatura'],
  si_pg_turno: ['turno', 'cambio'],
  si_pg_profesores: ['profesores', 'profesor'],
  welcome: ['menú', 'menu', 'inicio'],
};

function parseArgs(argv) {
  const args = { input: null, output: DEFAULT_OUT, version: 'v11' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') args.input = argv[++i];
    else if (arg === '--output' || arg === '-o') args.output = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/build-main-menu-v11.js --input <flow.json> [--output path] [--version v11]');
      process.exit(0);
    }
  }
  if (!args.input) {
    console.error('--input is required');
    process.exit(1);
  }
  return args;
}

function extractMenuOptions(message) {
  const options = [];
  const re = /(\d)️⃣\s*\*([^*]+)\*/g;
  let match;
  while ((match = re.exec(message)) !== null) {
    options.push({ num: match[1], label: match[2].trim() });
  }
  return options;
}

function labelToKeywords(label) {
  const lower = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const stop = new Set(['de', 'la', 'el', 'en', 'con', 'para', 'y', 'a', 'los', 'las', 'del', 'al', 'al', 'tu', 'mis']);
  const words = lower.split(/[^a-z0-9]+/).filter((w) => w && !stop.has(w) && w.length >= 3);
  if (words.length === 0) {
    const compact = lower.replace(/\s+/g, ' ').trim();
    return compact ? [compact.slice(0, 24)] : ['opcion'];
  }
  const keywords = [words[0]];
  if (words.length > 1) keywords.push(words[words.length - 1]);
  return keywords;
}

function buildNextNodeKeywordMap(node) {
  const options = extractMenuOptions(node.message || '');
  const map = new Map();
  for (const trans of node.transitions || []) {
    if (trans.type === 'match' && trans.value != null && String(trans.value).match(/^\d+$/)) {
      const opt = options.find((o) => o.num === String(trans.value));
      if (opt) {
        map.set(trans.nextNode, labelToKeywords(opt.label));
      }
    }
  }
  return map;
}

function collectUsedValues(transitions) {
  const used = new Set();
  for (const trans of transitions || []) {
    if (trans.value == null || trans.value === '') continue;
    if (typeof trans.value === 'string') used.add(trans.value.toLowerCase());
  }
  return used;
}

function pickUnusedKeyword(candidates, used) {
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (!used.has(key)) return candidate;
  }
  let i = 2;
  const base = candidates[0] || 'opcion';
  while (used.has(`${base}${i}`.toLowerCase())) i += 1;
  return `${base}${i}`;
}

function fixNodeTransitions(node) {
  const kwMap = buildNextNodeKeywordMap(node);
  const used = collectUsedValues(node.transitions);
  const missing = (node.transitions || []).filter(
    (t) =>
      (t.type === 'match' || t.type === 'matchIncludes') &&
      (t.value === undefined || t.value === null || t.value === ''),
  );

  const byTarget = new Map();
  for (const trans of missing) {
    const list = byTarget.get(trans.nextNode) || [];
    list.push(trans);
    byTarget.set(trans.nextNode, list);
  }

  for (const [nextNode, transList] of byTarget) {
    const fromMenu = kwMap.get(nextNode) || [];
    const fromOverride = EXTRA_KEYWORDS_BY_TARGET[nextNode] || [];
    const fromId = labelToKeywords(nextNode.replace(/_/g, ' '));
    const pool = [...fromMenu, ...fromOverride, ...fromId];

    for (const trans of transList.sort((a, b) => a.priority - b.priority)) {
      const value = pickUnusedKeyword(pool, used);
      trans.value = value;
      used.add(value.toLowerCase());
    }
  }
}

function normalizeTransitionValues(flow) {
  for (const node of flow.nodes) {
    for (const trans of node.transitions || []) {
      if (trans.value != null && typeof trans.value !== 'string' && !Array.isArray(trans.value)) {
        trans.value = String(trans.value);
      }
    }
  }
}

function prepareFlowDocument(flow, versionLabel) {
  const doc = structuredClone(flow);
  doc.version = versionLabel;
  doc.status = doc.status || 'published';
  doc.schemaVersion = doc.schemaVersion ?? 1;
  doc.updatedAt = new Date().toISOString();
  if (doc.status === 'published' && !doc.publishedAt) {
    doc.publishedAt = doc.updatedAt;
  }

  normalizeTransitionValues(doc);
  for (const node of doc.nodes) {
    fixNodeTransitions(node);
  }
  return doc;
}

function countMissingValues(flow) {
  let count = 0;
  for (const node of flow.nodes) {
    for (const trans of node.transitions || []) {
      if (
        (trans.type === 'match' || trans.type === 'matchIncludes' || trans.type === 'matchAny') &&
        (trans.value === undefined || trans.value === null || trans.value === '')
      ) {
        count += 1;
      }
    }
  }
  return count;
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = await fs.readFile(args.input, 'utf8');
  const source = JSON.parse(raw);
  const flow = prepareFlowDocument(source, args.version);

  const missing = countMissingValues(flow);
  if (missing > 0) {
    console.error(`Still ${missing} transitions without value after repair`);
    process.exit(1);
  }

  flowValidator.validate(flow);
  compileFlow(flow);

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${args.output} (${flow.nodes.length} nodes, version ${flow.version})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
