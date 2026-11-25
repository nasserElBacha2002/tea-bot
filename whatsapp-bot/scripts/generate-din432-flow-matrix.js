#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAllNodePatterns } from '../src/services/conversationClassification/classification.rules.js';
import {
  formatDetalleForExport,
  pickExportClassification,
  resolveConversationClassification,
} from '../src/services/conversationClassification/classificationResolver.service.js';
import { classifyLegacy } from '../src/services/conversationClassification/legacyInference.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flowPath = path.resolve(__dirname, '../../main-menu.json');
const outDir = path.resolve(__dirname, '../../DIN-432/corrections-round-1');
const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));

function extractLabel(node) {
  const msg = String(node.message || '').trim();
  const title = msg.split('\n')[0].replace(/[*_]/g, '').trim();
  return node.label || node.trackingLabel || node.title || title || '';
}

function fullRoute(nodeId) {
  if (nodeId.startsWith('no_')) return ['welcome', 'no_menu', nodeId, 'human_handoff'];
  return ['welcome', 'si_menu', nodeId, 'human_handoff'];
}

const rows = [];
for (const node of flow.nodes) {
  const patches = matchAllNodePatterns(node.id, flow.id, flow.version);
  if (patches.length === 0) continue;
  const visited = fullRoute(node.id);
  const legacy = classifyLegacy({}, visited);
  const resolution = resolveConversationClassification({
    flowId: flow.id,
    flowVersion: flow.version,
    visitedNodes: visited,
    answers: {},
    userMessages: [],
  });
  const enabled = pickExportClassification(resolution, 'enabled');
  rows.push({
    node: node.id,
    flowVersion: flow.version,
    label: extractLabel(node),
    route: visited.join(' → '),
    legacyPrimary: legacy.primaryQuery || 'No informado',
    v2Primary: enabled.primaryQuery || 'No informado',
    v2Detalle: formatDetalleForExport(enabled),
    matchedRule: enabled.matchedRule || null,
  });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'flow-matrix-before-after.json'),
  JSON.stringify({ summary: { flowId: flow.id, version: flow.version, rows: rows.length }, rows }, null, 2),
);
console.log(JSON.stringify({ rows: rows.length, v2NoInformado: rows.filter((r) => r.v2Primary === 'No informado').length }));