import flowValidator from '../utils/flow-validator.js';
import flowCatalogRepository from '../repositories/flow-catalog.repository.js';
import flowDbRepository from '../repositories/flow-db.repository.js';
import flowImportService from './flow-import.service.js';
import flowDraftManagementService from './flow-draft-management.service.js';
import flowPublishDbService from './flow-publish-db.service.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import { buildFlowDocumentFromTables } from '../utils/flow-snapshot-builder.js';

function normalizeVersionParam(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (/^v\d+$/i.test(s)) return s.toLowerCase();
  if (/^\d+$/.test(s)) return `v${s}`;
  return null;
}

function withDefaultSchemaVersion(flow) {
  return {
    ...flow,
    schemaVersion: Number.isInteger(flow?.schemaVersion) ? flow.schemaVersion : 1,
  };
}

function buildTransitionsMap(nodes, transitions) {
  const byKey = new Map(nodes.map((n) => [n.nodeKey, []]));
  for (const t of transitions) {
    const list = byKey.get(t.sourceNodeKey) || [];
    list.push(t);
    byKey.set(t.sourceNodeKey, list);
  }
  return byKey;
}

function graphToFlowDocument(graph) {
  const byKey = buildTransitionsMap(graph.nodes, graph.transitions);
  const doc = buildFlowDocumentFromTables(graph.flow, graph.version, graph.nodes, byKey);
  return withDefaultSchemaVersion({
    ...doc,
    id: graph.flow.flowKey,
    updatedAt: graph.flow.updatedAt || graph.version.createdAt,
    publishedAt: graph.version.publishedAt || undefined,
  });
}

/**
 * Fuente de verdad de flujos para /api/flows — solo base de datos.
 * Mantiene el contrato JSON del editor visual (Flow DTO).
 */
class FlowDocumentService {
  async ensureReady() {
    await ensureConversationDbReady();
    if (!flowCatalogRepository.isEnabled()) {
      throw new Error(
        'La base de datos de flujos no está disponible. Activá CONVERSATION_DB_ENABLED y las variables DB_*.',
      );
    }
  }

  async _getFlowRow(flowKey) {
    return flowCatalogRepository.getFlowByKey(flowKey);
  }

  async _ensureDraftVersion(flowRow, { createFromPublished = true } = {}) {
    let draft = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
    if (draft) return draft;

    if (!createFromPublished) return null;

    const published = await flowCatalogRepository.getLatestPublishedVersion(flowRow.id);
    if (published) {
      return flowDraftManagementService.createDraftFromVersion(flowRow.id, published.id);
    }

    const versionNumber = (await flowCatalogRepository.getMaxVersionNumber(flowRow.id)) + 1;
    return flowCatalogRepository.createVersion({
      flowId: flowRow.id,
      versionNumber,
      versionLabel: `v${versionNumber}`,
      status: 'draft',
      entryNodeKey: 'welcome',
      fallbackNodeKey: 'not-understood',
      metadataJson: { schemaVersion: 1 },
    });
  }

  async _syncDraftDocument(flowKey, flow) {
    const normalized = withDefaultSchemaVersion({
      ...flow,
      id: flowKey,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    });
    flowValidator.validate(normalized);

    let flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) {
      flowRow = await flowDbRepository.upsertFlow({
        flowKey,
        name: normalized.name || flowKey,
        description: normalized.description || null,
      });
    } else if (normalized.name && normalized.name !== flowRow.name) {
      flowRow = await flowDbRepository.upsertFlow({
        flowKey,
        name: normalized.name,
        description: normalized.description ?? flowRow.description,
      });
    }

    const draft = await this._ensureDraftVersion(flowRow, { createFromPublished: false });
    if (!draft) {
      throw new Error(`No se pudo crear borrador para "${flowKey}".`);
    }

    const rawJson = JSON.stringify(normalized);
    await flowImportService.importVersionFromJson(flowKey, normalized, {
      rawJson,
      versionNumber: draft.versionNumber,
      versionLabel: draft.versionLabel,
      status: 'draft',
    });

    const graph = await flowCatalogRepository.getVersionGraph(draft.id);
    return graphToFlowDocument(graph);
  }

  async listDrafts() {
    await this.ensureReady();
    const flows = await flowCatalogRepository.listFlows();
    return flows.map((f) => {
      const draft = f.draftVersion;
      const published = f.publishedVersion;
      return {
        id: f.flowKey,
        name: f.name,
        version: draft?.versionLabel || published?.versionLabel || '—',
        status: draft ? 'draft' : published ? 'published' : 'draft',
        updatedAt: f.updatedAt,
      };
    });
  }

  async getDraft(flowKey) {
    await this.ensureReady();
    const flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) return null;

    let draft = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
    if (!draft) {
      const published = await flowCatalogRepository.getLatestPublishedVersion(flowRow.id);
      if (!published) return null;
      draft = await flowDraftManagementService.createDraftFromVersion(flowRow.id, published.id);
    }

    const graph = await flowCatalogRepository.getVersionGraph(draft.id);
    if (!graph) return null;
    return graphToFlowDocument(graph);
  }

  async saveDraft(flow) {
    await this.ensureReady();
    if (!flow?.id) throw new Error('El campo "id" es obligatorio');
    return this._syncDraftDocument(flow.id, flow);
  }

  async archiveDraft(flowKey) {
    await this.ensureReady();
    const flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) throw new Error(`Flujo "${flowKey}" no encontrado.`);

    const draft = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
    if (draft) {
      await flowDraftManagementService.discardDraft(draft.id);
    }

    await flowDbRepository.upsertFlow({
      flowKey,
      name: flowRow.name,
      description: flowRow.description,
      status: 'archived',
    });
    return true;
  }

  async duplicateDraft(flowKey, newFlowKey) {
    await this.ensureReady();
    const original = await this.getDraft(flowKey);
    if (!original) throw new Error(`Flujo "${flowKey}" no encontrado.`);

    const existing = await this._getFlowRow(newFlowKey);
    if (existing) throw new Error(`Ya existe un flujo con id "${newFlowKey}".`);

    const copy = {
      ...original,
      id: newFlowKey,
      name: `${original.name} (Copia)`,
      updatedAt: new Date().toISOString(),
    };
    delete copy.publishedAt;
    return this.saveDraft(copy);
  }

  async publishDraft(flowKey) {
    await this.ensureReady();
    const flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) throw new Error(`No se puede publicar "${flowKey}": el flujo no existe.`);

    const draft = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
    if (!draft) {
      throw new Error(`No se puede publicar "${flowKey}": no hay borrador.`);
    }

    const { version: published } = await flowPublishDbService.publishDraft(draft.id);
    const graph = await flowCatalogRepository.getVersionGraph(published.id);
    const doc = graphToFlowDocument(graph);
    console.log(`🚀 Publicado "${flowKey}" versión ${doc.version}`);
    return doc;
  }

  async listVersionSummary(flowKey) {
    await this.ensureReady();
    const flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) return null;

    const versions = await flowCatalogRepository.listVersions(flowRow.id);
    const published = versions.filter((v) => v.status === 'published');
    if (published.length === 0) return null;

    const active = published.reduce((best, v) =>
      v.versionNumber > best.versionNumber ? v : best,
    );

    return {
      flowId: flowKey,
      activeVersion: active.versionLabel,
      lastPublishedAt: active.publishedAt,
      updatedAt: flowRow.updatedAt,
      versions: published.map((v) => ({
        version: v.versionLabel,
        versionLabel: v.versionLabel,
        file: `${v.versionLabel}.db`,
        publishedAt: v.publishedAt,
        notes: v.metadataJson?.notes,
        sourceDraftUpdatedAt: v.metadataJson?.sourceDraftUpdatedAt,
      })),
    };
  }

  async getPublishedVersionDocument(flowKey, versionParam) {
    await this.ensureReady();
    const normalized = normalizeVersionParam(versionParam);
    if (!normalized) {
      throw new Error(`Versión inválida: "${versionParam}"`);
    }

    const flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) throw new Error(`No hay versiones publicadas para "${flowKey}"`);

    const versions = await flowCatalogRepository.listVersions(flowRow.id);
    const entry = versions.find(
      (v) =>
        v.status === 'published' &&
        (v.versionLabel === normalized ||
          v.versionLabel?.toLowerCase() === normalized ||
          String(v.versionNumber) === normalized.replace(/^v/i, '')),
    );
    if (!entry) {
      throw new Error(`Versión "${normalized}" no encontrada para "${flowKey}"`);
    }

    const graph = await flowCatalogRepository.getVersionGraph(entry.id);
    const flow = graphToFlowDocument(graph);
    const summary = await this.listVersionSummary(flowKey);
    const isActive = summary?.activeVersion === entry.versionLabel;

    return {
      flow,
      meta: {
        flowId: flowKey,
        activeVersion: summary?.activeVersion ?? null,
        versions: summary?.versions ?? [],
      },
      entry: {
        version: entry.versionLabel,
        versionLabel: entry.versionLabel,
        file: `${entry.versionLabel}.db`,
        publishedAt: entry.publishedAt,
      },
      isActive,
      normalizedVersion: normalized,
    };
  }

  async duplicatePublishedVersionToDraft(flowKey, versionParam, { overwriteDraft = false } = {}) {
    const { flow, normalizedVersion } = await this.getPublishedVersionDocument(
      flowKey,
      versionParam,
    );

    const flowRow = await this._getFlowRow(flowKey);
    const existing = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
    if (existing && !overwriteDraft) {
      const err = new Error(
        `Ya existe un borrador para "${flowKey}". Envía overwriteDraft: true para reemplazarlo.`,
      );
      err.code = 'CONFLICT';
      throw err;
    }
    if (existing && overwriteDraft) {
      await flowDraftManagementService.discardDraft(existing.id);
    }

    const version = await flowCatalogRepository.listVersions(flowRow.id);
    const source = version.find((v) => v.versionLabel === normalizedVersion);
    if (!source) {
      throw new Error(`Versión "${normalizedVersion}" no encontrada.`);
    }

    await flowDraftManagementService.createDraftFromVersion(flowRow.id, source.id);
    return this.getDraft(flowKey);
  }

  async importPublishedVersionFromJson(flowKey, flow, { publish = false } = {}) {
    await this.ensureReady();
    const normalizedFlow = withDefaultSchemaVersion({ ...flow, id: flowKey });
    flowValidator.validate(normalizedFlow);

    let flowRow = await this._getFlowRow(flowKey);
    if (!flowRow) {
      flowRow = await flowDbRepository.upsertFlow({
        flowKey,
        name: normalizedFlow.name || flowKey,
        description: normalizedFlow.description || null,
      });
    }

    const nextNum = (await flowCatalogRepository.getMaxVersionNumber(flowRow.id)) + 1;
    const versionLabel = `v${nextNum}`;
    const rawJson = JSON.stringify({
      ...normalizedFlow,
      version: versionLabel,
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
    const parsed = JSON.parse(rawJson);

    await flowImportService.importVersionFromJson(flowKey, parsed, {
      rawJson,
      versionNumber: nextNum,
      versionLabel,
      status: 'published',
    });

    const versions = await flowCatalogRepository.listVersions(flowRow.id);
    const created = versions.find((v) => v.versionLabel === versionLabel);
    if (!created) {
      throw new Error('No se pudo localizar la versión importada en la base de datos.');
    }

    const summary = await this.listVersionSummary(flowKey);
    const shouldActivate = Boolean(publish) || !summary?.activeVersion;

    if (shouldActivate) {
      await flowCatalogRepository.archivePublishedVersions(flowRow.id, created.id);
    }

    const graph = await flowCatalogRepository.getVersionGraph(created.id);
    const publishedFlow = graphToFlowDocument(graph);
    const refreshedSummary = await this.listVersionSummary(flowKey);

    return {
      flow: publishedFlow,
      activeVersion: refreshedSummary?.activeVersion ?? versionLabel,
      createdVersion: versionLabel,
      wasActivated: shouldActivate,
    };
  }

  /** No-op: la estructura vive en SQL Server. */
  async ensureStructure() {
    return undefined;
  }
}

const flowDocumentService = new FlowDocumentService();
export default flowDocumentService;
