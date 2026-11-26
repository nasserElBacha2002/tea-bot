#!/usr/bin/env node
/**
 * Exports no referenciados en el resto del árbol (idea de ts-prune).
 * Informativo. Escribe audit/raw/dead-exports.json.
 *
 * Busca `export` con nombre en frontend/src y whatsapp-bot/src y comprueba
 * si otro archivo menciona ese identificador. No es un typechecker: puede
 * marcar un export que solo se usa por reflexión.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);
const TEST_RE = /\.(test|spec|integration\.test)\.[cm]?[jt]sx?$/;
const EXPORT_RE = [
  /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  /export\s*\{([^}]+)\}/g,
];

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

function exportNames(text) {
  const names = new Set();
  for (const pattern of EXPORT_RE) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (pattern === EXPORT_RE[4]) {
        for (const part of match[1].split(',')) {
          const cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '').trim();
          if (!cleaned || cleaned.startsWith('type ')) continue;
          const alias = cleaned.split(/\s+as\s+/i).pop().trim();
          if (alias && alias !== 'default' && /^[A-Za-z_$]/.test(alias)) names.add(alias);
        }
      } else if (match[1] && match[1] !== 'default') {
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

async function main() {
  const outDir = path.join(repoRoot, 'audit/raw');
  await mkdir(outDir, { recursive: true });
  const roots = ['whatsapp-bot/src', 'frontend/src'].map((rel) => path.join(repoRoot, rel));
  const files = [];
  for (const root of roots) files.push(...(await walk(root)));
  const texts = new Map();
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    texts.set(rel, await readFile(file, 'utf8'));
  }
  const dead = [];
  for (const [rel, text] of texts) {
    if (TEST_RE.test(rel)) continue;
    for (const name of exportNames(text)) {
      const needle = new RegExp(`\\b${name}\\b`);
      let used = false;
      for (const [other, body] of texts) {
        if (other === rel) continue;
        if (needle.test(body)) {
          used = true;
          break;
        }
      }
      if (!used) dead.push({ file: rel, name });
    }
  }
  const payload = {
    ok: true,
    tool: 'dead-exports',
    note: 'Equivalente informativo de ts-prune: export con nombre que ningún otro archivo menciona.',
    count: dead.length,
    exports: dead.slice(0, 80),
    truncated: Math.max(0, dead.length - 80),
  };
  await writeFile(path.join(outDir, 'dead-exports.json'), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`dead-exports count=${dead.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
