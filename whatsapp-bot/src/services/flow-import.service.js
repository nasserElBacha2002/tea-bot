import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import flowValidator from '../utils/flow-validator.js';
import flowDbRepository from '../repositories/flow-db.repository.js';
import { computeFlowChecksum } from '../utils/flow-checksum.js';
import {
  parsePublishedVersionFromFilename,
  DRAFT_VERSION_NUMBER,
} from '../utils/flow-version-parse.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_BASE = path.join(__dirname, '../../data/flows');
const PUBLISHED_DIR = path.join(FLOWS_BASE, 'published');
const DRAFTS_DIR = path.join(FLOWS_BASE, 'drafts');

const NODE_CORE_KEYS = new Set([
  'id',
  'type',
  'message',
  'title',
  'name',
  'transitions',
  'nextNode',
  'ui',
]);

function buildNodeMetadata(node) {
  const meta = {};
  for (const [key, value] of Object.entries(node)) {
    if (!NODE_CORE_KEYS.has(key)) meta[key] = value;
  }
  if (node.ui) meta.ui = node.ui;
  return Object.keys(meta).length > 0 ? meta : null;
}

function buildTransitionRows(node) {
  const rows = [];
  if (Array.isArray(node.transitions)) {
    for (const [index, trans] of node.transitions.entries()) {
      const { type, value, nextNode, priority, ...rest } = trans;
      rows.push({
        type,
        value: value ?? null,
        nextNodeKey: nextNode,
        priority: priority ?? index,
        metadataJson: Object.keys(rest).length ? rest : null,
      });
    }
  }
  if (node.nextNode && !rows.some((r) => r.type === 'implicit_next')) {
    rows.push({
      type: 'implicit_next',
      value: null,
      nextNodeKey: node.nextNode,
      priority: 9999,
      metadataJson: null,
    });
  }
  return rows;
}

function validateImportedFlow(flow, expectedCounts) {
  flowValidator.validate(flow);
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  if (!nodeIds.has(flow.entryNode)) {
    throw new Error(`entryNode "${flow.entryNode}" no existe tras importar`);
  }
  if (flow.fallbackNode && !nodeIds.has(flow.fallbackNode)) {
    throw new Error(`fallbackNode "${flow.fallbackNode}" no existe tras importar`);
  }

  let transitionCount = 0;
  for (const node of flow.nodes) {
    const transitions = buildTransitionRows(node);
    transitionCount += transitions.length;
    for (const t of transitions) {
      if (!nodeIds.has(t.nextNodeKey)) {
        throw new Error(
          `Transición desde "${node.id}" apunta a nodo inexistente "${t.nextNodeKey}"`,
        );
      }
    }
  }

  if (expectedCounts.nodeCount !== flow.nodes.length) {
    throw new Error(
      `Conteo de nodos: JSON=${flow.nodes.length} importados=${expectedCounts.nodeCount}`,
    );
  }
  if (expectedCounts.transitionCount !== transitionCount) {
    throw new Error(
      `Conteo de transiciones: esperado=${transitionCount} importadas=${expectedCounts.transitionCount}`,
    );
  }
}

export class FlowImportService {
  async importVersionFromJson(flowKey, flow, { rawJson, versionNumber, versionLabel, status }) {
    const checksum = computeFlowChecksum(rawJson);
    const flowRow = await flowDbRepository.upsertFlow({
      flowKey,
      name: flow.name || flowKey,
      description: flow.description || null,
    });

    const versionRow = await flowDbRepository.upsertFlowVersion({
      flowId: flowRow.id,
      versionNumber,
      versionLabel,
      status,
      entryNodeKey: flow.entryNode,
      fallbackNodeKey: flow.fallbackNode || null,
      publishedAt: flow.publishedAt || (status === 'published' ? new Date() : null),
      metadataJson: {
        schemaVersion: flow.schemaVersion ?? 1,
        sourceStatus: flow.status,
      },
    });

    const forceImport = ['1', 'true', 'yes'].includes(
      String(process.env.FORCE_FLOW_IMPORT || '').trim().toLowerCase(),
    );
    const existingChecksum = await flowDbRepository.getSnapshotChecksum(versionRow.id);
    if (!forceImport && existingChecksum === checksum) {
      return { skipped: true, flowKey, versionLabel, checksum };
    }

    await flowDbRepository.deleteVersionChildren(versionRow.id);

    const nodes = flow.nodes.map((node) => ({
      nodeKey: node.id,
      type: node.type,
      message: node.message ?? null,
      title: node.title || node.name || null,
      metadataJson: buildNodeMetadata(node),
      positionX: node.ui?.position?.x ?? null,
      positionY: node.ui?.position?.y ?? null,
    }));

    const transitionsByNode = new Map();
    let transitionCount = 0;
    for (const node of flow.nodes) {
      const rows = buildTransitionRows(node);
      transitionsByNode.set(node.id, rows);
      transitionCount += rows.length;
    }

    const nodeIdByKey = await flowDbRepository.insertNodes(versionRow.id, nodes);
    const insertedTransitions = await flowDbRepository.insertTransitions(
      nodeIdByKey,
      transitionsByNode,
    );

    await flowDbRepository.insertSnapshot(versionRow.id, rawJson, checksum);

    validateImportedFlow(flow, {
      nodeCount: nodes.length,
      transitionCount: insertedTransitions,
    });

    if (existingChecksum && existingChecksum !== checksum) {
      const verify = await flowDbRepository.getSnapshotChecksum(versionRow.id);
      if (verify !== checksum) {
        throw new Error(`Checksum no coincide tras importar ${flowKey} ${versionLabel}`);
      }
    }

    return { skipped: false, flowKey, versionLabel, checksum, nodeCount: nodes.length };
  }

  async importPublishedFlow(flowKey, activeVersionHint = null) {
    const dir = path.join(PUBLISHED_DIR, flowKey);
    let meta = null;
    try {
      const rawMeta = await fs.readFile(path.join(dir, 'metadata.json'), 'utf-8');
      meta = JSON.parse(rawMeta);
    } catch {
      meta = null;
    }

    const files = await fs.readdir(dir);
    const versionFiles = files.filter((f) => /^v\d+\.json$/i.test(f));
    const results = [];

    for (const file of versionFiles) {
      const parsed = parsePublishedVersionFromFilename(file);
      if (!parsed) continue;
      const fullPath = path.join(dir, file);
      const rawJson = await fs.readFile(fullPath, 'utf-8');
      const flow = JSON.parse(rawJson);
      const normalized = { ...flow, id: flowKey, version: parsed.versionLabel };
      const result = await this.importVersionFromJson(flowKey, normalized, {
        rawJson,
        versionNumber: parsed.versionNumber,
        versionLabel: parsed.versionLabel,
        status: 'published',
      });
      results.push({ file, ...result });
    }

    return { flowKey, results, activeVersion: meta?.activeVersion || activeVersionHint };
  }

  async importDraft(flowKey) {
    const filePath = path.join(DRAFTS_DIR, `${flowKey}.json`);
    const rawJson = await fs.readFile(filePath, 'utf-8');
    const flow = JSON.parse(rawJson);
    const normalized = { ...flow, id: flowKey, status: 'draft' };
    return this.importVersionFromJson(flowKey, normalized, {
      rawJson,
      versionNumber: DRAFT_VERSION_NUMBER,
      versionLabel: 'draft',
      status: 'draft',
    });
  }

  async importAllFromDisk() {
    await ensureConversationDbReady();
    if (!flowDbRepository.isEnabled()) {
      throw new Error('DB no habilitada para importar flujos');
    }

    const summary = { published: [], drafts: [], errors: [] };

    let publishedDirs = [];
    try {
      const entries = await fs.readdir(PUBLISHED_DIR, { withFileTypes: true });
      publishedDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      publishedDirs = [];
    }

    for (const flowKey of publishedDirs) {
      try {
        const r = await this.importPublishedFlow(flowKey);
        summary.published.push(r);
      } catch (err) {
        summary.errors.push({ flowKey, type: 'published', message: err.message });
      }
    }

    let draftFiles = [];
    try {
      draftFiles = (await fs.readdir(DRAFTS_DIR)).filter((f) => f.endsWith('.json'));
    } catch {
      draftFiles = [];
    }

    for (const file of draftFiles) {
      const flowKey = file.replace(/\.json$/i, '');
      try {
        const r = await this.importDraft(flowKey);
        summary.drafts.push({ flowKey, ...r });
      } catch (err) {
        summary.errors.push({ flowKey, type: 'draft', message: err.message });
      }
    }

    if (summary.errors.length > 0) {
      throw new Error(
        `Importación con errores:\n${summary.errors.map((e) => `- ${e.flowKey}: ${e.message}`).join('\n')}`,
      );
    }

    return summary;
  }
}

const flowImportService = new FlowImportService();
export default flowImportService;
