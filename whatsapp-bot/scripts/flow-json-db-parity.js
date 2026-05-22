#!/usr/bin/env node
/**
 * Paridad JSON en disco vs snapshot en DB (misma regla que import-flows-to-db).
 * Compara checksum del archivo crudo con dbo.flow_version_snapshots.checksum.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import flowCatalogRepository from '../src/repositories/flow-catalog.repository.js';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';
import { computeFlowChecksum } from '../src/utils/flow-checksum.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISHED_DIR = path.join(__dirname, '../data/flows/published');

async function loadJsonActiveRaw(flowKey) {
  const metaPath = path.join(PUBLISHED_DIR, flowKey, 'metadata.json');
  const rawMeta = await fs.readFile(metaPath, 'utf-8');
  const meta = JSON.parse(rawMeta);
  const active = meta.activeVersion;
  if (!active) throw new Error('metadata sin activeVersion');
  const filePath = path.join(PUBLISHED_DIR, flowKey, `${active}.json`);
  const rawJson = await fs.readFile(filePath, 'utf-8');
  const flow = JSON.parse(rawJson);
  return {
    active,
    rawJson,
    fileChecksum: computeFlowChecksum(rawJson),
    nodeCount: flow.nodes?.length ?? 0,
  };
}

async function loadDbActiveSnapshot(flowKey, versionLabel) {
  const snap = await flowCatalogRepository.getSnapshotByFlowAndVersionLabel(
    flowKey,
    versionLabel,
  );
  if (!snap) return null;
  const snapshotText =
    typeof snap.snapshotJson === 'string'
      ? snap.snapshotJson
      : JSON.stringify(snap.snapshotJson);
  return {
    versionLabel: snap.versionLabel,
    checksum: snap.checksum || computeFlowChecksum(snapshotText),
    nodeCount: (() => {
      try {
        const doc = JSON.parse(snapshotText);
        return doc.nodes?.length ?? 0;
      } catch {
        return null;
      }
    })(),
  };
}

async function main() {
  await ensureConversationDbReady();
  const lines = ['# Paridad JSON vs DB', '', `Generado: ${new Date().toISOString()}`, ''];
  lines.push(
    'Criterio: checksum SHA-256 del **archivo JSON crudo** vs `flow_version_snapshots.checksum` (igual que `flows:migrate-json-to-db`).',
    '',
  );

  let dirs = [];
  try {
    const entries = await fs.readdir(PUBLISHED_DIR, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    lines.push('Sin carpeta `data/flows/published` en disco.', '');
    lines.push('**Estado:** `JSON_DB_PARITY_VALIDATED` (nada que comparar en disco)', '');
    console.log(lines.join('\n'));
    return;
  }

  let critical = 0;
  for (const flowKey of dirs) {
    let jsonSide;
    try {
      jsonSide = await loadJsonActiveRaw(flowKey);
    } catch (err) {
      lines.push(`## ${flowKey}`, `- JSON: **MISSING_IN_JSON** (${err.message})`, '');
      critical += 1;
      continue;
    }

    const dbSide = await loadDbActiveSnapshot(flowKey, jsonSide.active);
    if (!dbSide) {
      lines.push(
        `## ${flowKey}`,
        `- JSON activo: ${jsonSide.active} (archivo ${jsonSide.fileChecksum.slice(0, 8)}…)`,
        '- DB: **MISSING_IN_DB** (sin snapshot para esa versión)',
        '',
      );
      critical += 1;
      continue;
    }

    const status = jsonSide.fileChecksum === dbSide.checksum ? 'MATCH' : 'MISMATCH';
    if (status === 'MISMATCH') critical += 1;

    lines.push(
      `## ${flowKey}`,
      `- Estado: **${status}**`,
      `- Versión activa: ${jsonSide.active}`,
      `- Checksum archivo JSON: ${jsonSide.fileChecksum.slice(0, 8)}…`,
      `- Checksum snapshot DB: ${dbSide.checksum.slice(0, 8)}…`,
      `- Nodos (archivo / snapshot): ${jsonSide.nodeCount} / ${dbSide.nodeCount ?? '?'}`,
      '',
    );

    if (status === 'MISMATCH') {
      lines.push(
        `  Reimportar forzado: \`FORCE_FLOW_IMPORT=1 npm run flows:migrate-json-to-db\``,
        '',
      );
    }
  }

  lines.push(
    critical === 0
      ? '**Estado global:** `JSON_DB_PARITY_VALIDATED`'
      : `**Estado global:** BLOQUEADO — ${critical} diferencia(s). Ejecutá reimportación forzada antes de borrar JSON.`,
  );
  console.log(lines.join('\n'));
  process.exit(critical === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
