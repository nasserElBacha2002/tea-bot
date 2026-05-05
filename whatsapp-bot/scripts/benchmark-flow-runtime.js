#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import flowValidator from '../src/utils/flow-validator.js';
import { FlowEngine } from '../src/services/flow-engine.service.js';
import sessionService from '../src/services/session.service.js';
import { compileFlow } from '../src/utils/compile-flow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    flow: 'main-menu',
    versions: ['v10', 'v11', 'v12'],
    messages: Number(process.env.PERF_BENCH_MESSAGES || 1000),
  };

  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === '--flow' && value) parsed.flow = value;
    if (key === '--versions' && value) parsed.versions = value.split(',').map((v) => v.trim());
    if (key === '--messages' && value) parsed.messages = Number(value);
  }
  return parsed;
}

function nowMs() {
  return performance.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return Number(sorted[idx].toFixed(3));
}

function complexity(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const commandTokens = new Set(['menu', 'atrás', 'atras', 'humano']);
  let transitions = 0;
  let values = 0;
  let globalCommandsDuplicated = 0;

  for (const node of nodes) {
    const ts = Array.isArray(node.transitions) ? node.transitions : [];
    transitions += ts.length;
    for (const t of ts) {
      const raw = t?.value;
      if (Array.isArray(raw)) values += raw.length;
      else if (typeof raw === 'string') values += 1;
      const arr = Array.isArray(raw) ? raw : [raw];
      const hasGlobalCommand = arr
        .map((item) => String(item || '').trim().toLowerCase())
        .some((token) => commandTokens.has(token));
      if (hasGlobalCommand) globalCommandsDuplicated += 1;
    }
  }
  return {
    nodes: nodes.length,
    transitions,
    values,
    globalCommandsDuplicated,
  };
}

async function readFlow(flowId, version) {
  const filePath = path.join(ROOT, 'data/flows/published', flowId, `${version}.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return { raw, filePath, flow: JSON.parse(raw) };
}

async function benchmarkVersion({ flowId, version, messages, engine }) {
  const { raw, filePath, flow } = await readFlow(flowId, version);
  const parseSamples = [];
  for (let i = 0; i < 20; i += 1) {
    const start = nowMs();
    JSON.parse(raw);
    parseSamples.push(nowMs() - start);
  }
  const parseAvgMs = Number((parseSamples.reduce((a, b) => a + b, 0) / parseSamples.length).toFixed(4));

  flowValidator.validate(flow);
  const compileStart = nowMs();
  const compiled = compileFlow(flow);
  const compileMs = Number((nowMs() - compileStart).toFixed(4));

  const complexityStats = complexity(flow);
  const latencies = [];
  const samples = [
    'menu',
    'hola',
    '1',
    '2',
    'humano',
    'atras',
    'quiero te verde',
    'si',
    'no',
    'ayuda',
  ];
  const userId = `bench:${flowId}:${version}`;
  await sessionService.resetSession(userId).catch(() => {});

  const startedAt = nowMs();
  for (let i = 0; i < messages; i += 1) {
    const start = nowMs();
    await engine.resolveIncomingMessage({
      userId,
      text: samples[i % samples.length],
      flowSnapshot: flow,
      flowId,
      flowMode: 'published',
    });
    latencies.push(nowMs() - start);
  }
  const totalMs = nowMs() - startedAt;
  await sessionService.resetSession(userId).catch(() => {});

  const avgMs = Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(4));
  return {
    version,
    filePath,
    sizeKB: Number((Buffer.byteLength(raw, 'utf-8') / 1024).toFixed(1)),
    ...complexityStats,
    compileMs,
    parseAvgMs,
    engineResolveAvgMs: avgMs,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    msgPerSec: Number(((messages / totalMs) * 1000).toFixed(2)),
  };
}

function printTable(flowId, messages, rows) {
  console.log('Benchmark Flow Runtime');
  console.log(`Flow: ${flowId}`);
  console.log(`Messages per version: ${messages}`);
  console.log('');
  console.log('Version | KB | Nodes | Transitions | Values | CmdDup | Compile | ParseAvg | Avg ms | P50 | P95 | P99 | msg/s');
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      `${r.version.padEnd(7)} | ${String(r.sizeKB).padStart(5)} | ${String(r.nodes).padStart(5)} | ${String(r.transitions).padStart(11)} | ${String(r.values).padStart(6)} | ${String(r.globalCommandsDuplicated).padStart(6)} | ${String(r.compileMs).padStart(7)} | ${String(r.parseAvgMs).padStart(8)} | ${String(r.engineResolveAvgMs).padStart(6)} | ${String(r.p50).padStart(4)} | ${String(r.p95).padStart(4)} | ${String(r.p99).padStart(4)} | ${String(r.msgPerSec).padStart(6)}`
    );
  }
}

async function saveJsonReport(flowId, messages, rows) {
  const dir = path.join(ROOT, 'audit/raw');
  await fs.mkdir(dir, { recursive: true });
  const output = path.join(dir, 'perf-benchmark-flow-runtime.json');
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        flowId,
        messages,
        rows,
      },
      null,
      2
    ),
    'utf-8'
  );
  return output;
}

async function main() {
  const { flow, versions, messages } = parseArgs();
  const engine = new FlowEngine();
  const rows = [];

  for (const version of versions) {
    try {
      rows.push(await benchmarkVersion({ flowId: flow, version, messages, engine }));
    } catch (error) {
      console.error(`⚠️ No se pudo benchmarkear ${version}: ${error.message}`);
    }
  }

  if (rows.length === 0) {
    console.error('No se pudo ejecutar benchmark para ninguna versión.');
    process.exit(1);
  }

  printTable(flow, messages, rows);
  const reportPath = await saveJsonReport(flow, messages, rows);
  console.log('');
  console.log(`JSON report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
