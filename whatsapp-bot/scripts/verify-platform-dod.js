#!/usr/bin/env node
/**
 * Verificación DoD: persistencia + flujos en DB + seed local.
 * Uso: npm run db:verify
 */
import dotenv from 'dotenv';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';
import { query, pingDatabase } from '../src/db/index.js';
import { getFlowStorageMode } from '../src/config/flow-storage.js';
import compositeFlowLoader from '../src/loaders/composite-flow-loader.js';
import dbFlowLoader from '../src/loaders/db-flow-loader.js';

dotenv.config();

const checks = [];

function pass(name, detail = '') {
  checks.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  checks.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function countTable(table) {
  const { rows } = await query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  console.log('=== Verificación DoD Tea Bot ===\n');
  console.log(`FLOW_STORAGE_MODE=${getFlowStorageMode()}`);

  try {
    await ensureConversationDbReady();
    pass('Persistencia DB disponible (ping OK)');
  } catch (e) {
    fail('Persistencia DB disponible', e.message);
    summarize();
    process.exit(1);
  }

  const tables = [
    'dbo.conversations',
    'dbo.conversation_messages',
    'dbo.conversation_sessions',
    'dbo.human_handoffs',
    'dbo.flows',
    'dbo.flow_versions',
    'dbo.flow_nodes',
    'dbo.flow_transitions',
    'dbo.flow_version_snapshots',
  ];

  for (const t of tables) {
    try {
      const n = await countTable(t);
      if (n >= 0) pass(`Tabla ${t}`, `${n} filas`);
      else fail(`Tabla ${t}`);
    } catch (e) {
      fail(`Tabla ${t}`, e.message);
    }
  }

  const seedConv = await query(
    `SELECT COUNT(*) AS n FROM dbo.conversations WHERE external_user_id LIKE N'SIM-%'`,
  );
  const seedN = Number(seedConv.rows[0]?.n ?? 0);
  if (seedN >= 4) {
    pass('Seed conversaciones SIM-*', `${seedN} conversaciones`);
  } else {
    fail('Seed conversaciones SIM-*', `encontradas ${seedN}; ejecutá: ALLOW_DEV_SEED=true npm run db:seed-conversations`);
  }

  const flowKeys = await dbFlowLoader.listPublishedFlowKeys();
  if (flowKeys.includes('main-menu')) {
    pass('Flujo main-menu en DB');
  } else {
    fail('Flujo main-menu en DB', 'ejecutá: npm run db:import-flows');
  }

  try {
    const loaded = await dbFlowLoader.loadActivePublished('main-menu');
    if (loaded?.flow?.nodes?.length > 0 && loaded.source?.storage === 'db') {
      pass(
        'DbFlowLoader carga snapshot',
        `${loaded.flow.nodes.length} nodos, versión ${loaded.source.version}`,
      );
    } else {
      fail('DbFlowLoader carga snapshot');
    }
  } catch (e) {
    fail('DbFlowLoader carga snapshot', e.message);
  }

  if (getFlowStorageMode() === 'db') {
    try {
      await compositeFlowLoader.loadActivePublished('main-menu');
      pass('CompositeFlowLoader modo db sin fallback JSON');
    } catch (e) {
      fail('CompositeFlowLoader modo db', e.message);
    }
  } else {
    console.log(`  ℹ️  FLOW_STORAGE_MODE=${getFlowStorageMode()} (para independencia JSON usar "db")`);
  }

  const handoffPending = await query(
    `SELECT COUNT(*) AS n FROM dbo.human_handoffs WHERE status = N'pending'`,
  );
  pass('Handoffs en DB', `${handoffPending.rows[0]?.n ?? 0} pending`);

  summarize();
  const failed = checks.filter((c) => !c.ok).length;
  process.exit(failed > 0 ? 1 : 0);
}

function summarize() {
  const ok = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n=== Resultado: ${ok}/${total} checks OK ===`);
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(1);
});
