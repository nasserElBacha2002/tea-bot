import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import flowValidator from '../utils/flow-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DATA_DIR = path.join(__dirname, '../../data/flows');
const DRAFTS_DIR = path.join(BASE_DATA_DIR, 'drafts');
const PUBLISHED_DIR = path.join(BASE_DATA_DIR, 'published');
const METADATA_FILE = 'metadata.json';

function normalizeVersionParam(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (/^v\d+$/i.test(s)) return s.toLowerCase();
  if (/^\d+$/.test(s)) return `v${s}`;
  return null;
}

function versionNumFromLabel(label) {
  const m = /^v(\d+)$/i.exec(label);
  return m ? parseInt(m[1], 10) : 0;
}

class FlowRepository {
  _withDefaultSchemaVersion(flow) {
    return {
      ...flow,
      schemaVersion: Number.isInteger(flow?.schemaVersion) ? flow.schemaVersion : 1,
    };
  }

  async ensureStructure() {
    await fs.mkdir(DRAFTS_DIR, { recursive: true });
    await fs.mkdir(PUBLISHED_DIR, { recursive: true });
  }

  _flowPublishedDir(flowId) {
    return path.join(PUBLISHED_DIR, flowId);
  }

  _metadataPath(flowId) {
    return path.join(this._flowPublishedDir(flowId), METADATA_FILE);
  }

  async listDrafts() {
    const files = await fs.readdir(DRAFTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const drafts = [];
    for (const filename of jsonFiles) {
      const content = await fs.readFile(path.join(DRAFTS_DIR, filename), 'utf-8');
      const flow = JSON.parse(content);
      drafts.push({
        id: flow.id,
        name: flow.name,
        version: flow.version,
        status: flow.status || 'draft',
        updatedAt: flow.updatedAt
      });
    }
    return drafts;
  }

  async getDraft(flowId) {
    const filePath = path.join(DRAFTS_DIR, `${flowId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this._withDefaultSchemaVersion(JSON.parse(content));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveDraft(flow) {
    const normalizedFlow = this._withDefaultSchemaVersion(flow);
    flowValidator.validate(normalizedFlow);

    const filePath = path.join(DRAFTS_DIR, `${normalizedFlow.id}.json`);
    const content = JSON.stringify({
      ...normalizedFlow,
      status: 'draft',
      updatedAt: new Date().toISOString()
    }, null, 2);

    await fs.writeFile(filePath, content);
    return JSON.parse(content);
  }

  async archiveDraft(flowId) {
    const draft = await this.getDraft(flowId);
    if (!draft) throw new Error(`Draft "${flowId}" no encontrado.`);

    const ARCHIVE_DIR = path.join(BASE_DATA_DIR, 'archive');
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    const sourcePath = path.join(DRAFTS_DIR, `${flowId}.json`);
    const destPath = path.join(ARCHIVE_DIR, `${flowId}_${Date.now()}.json`);

    await fs.rename(sourcePath, destPath);
    return true;
  }

  async duplicateDraft(flowId, newFlowId) {
    const original = await this.getDraft(flowId);
    if (!original) throw new Error(`Draft "${flowId}" no encontrado.`);

    const copy = {
      ...original,
      id: newFlowId,
      name: `${original.name} (Copia)`,
      updatedAt: new Date().toISOString()
    };

    return await this.saveDraft(copy);
  }

  /**
   * Directorios bajo published/ (un id de flujo por carpeta).
   */
  async listPublishedFlows() {
    try {
      const entries = await fs.readdir(PUBLISHED_DIR, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  async _scanVersionJsonFiles(flowDir) {
    const files = await fs.readdir(flowDir).catch(() => []);
    return files.filter(f => /^v\d+\.json$/i.test(f));
  }

  async _buildMetadataFromDisk(flowId) {
    const dir = this._flowPublishedDir(flowId);
    const versionFiles = await this._scanVersionJsonFiles(dir);
    if (versionFiles.length === 0) return null;

    const sorted = [...versionFiles].sort(
      (a, b) => versionNumFromLabel(a.replace(/\.json$/i, '')) - versionNumFromLabel(b.replace(/\.json$/i, ''))
    );

    const versions = [];
    for (const file of sorted) {
      const full = path.join(dir, file);
      const content = await fs.readFile(full, 'utf-8');
      const json = JSON.parse(content);
      const label = (json.version || file.replace(/\.json$/i, '')).toLowerCase();
      versions.push({
        version: label,
        versionLabel: label,
        file,
        publishedAt: json.publishedAt || new Date().toISOString()
      });
    }

    const activeVersion = versions[versions.length - 1].version;
    const now = new Date().toISOString();
    return {
      flowId,
      activeVersion,
      versions,
      lastPublishedAt: versions[versions.length - 1].publishedAt,
      updatedAt: now
    };
  }

  /**
   * Lee metadata.json; si no existe, la reconstruye desde v*.json y la persiste.
   */
  async getPublishedMetadata(flowId) {
    const dir = this._flowPublishedDir(flowId);
    const metaPath = this._metadataPath(flowId);

    try {
      await fs.access(dir);
    } catch {
      return null;
    }

    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      if (!meta || meta.flowId !== flowId || !Array.isArray(meta.versions)) {
        throw new Error('metadata incompleta o flowId inconsistente');
      }
      if (!meta.activeVersion) {
        throw new Error('metadata sin activeVersion');
      }
      return meta;
    } catch (e) {
      if (e.code === 'ENOENT') {
        const built = await this._buildMetadataFromDisk(flowId);
        if (!built) return null;
        await fs.writeFile(metaPath, JSON.stringify(built, null, 2), 'utf-8');
        return built;
      }
      if (e instanceof SyntaxError) {
        throw new Error(`Metadata publicada corrupta para "${flowId}": JSON inválido`);
      }
      throw new Error(`Metadata publicada corrupta para "${flowId}": ${e.message}`);
    }
  }

  async _writeMetadata(flowId, meta) {
    const payload = {
      ...meta,
      flowId,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(this._metadataPath(flowId), JSON.stringify(payload, null, 2), 'utf-8');
    return payload;
  }

  _nextVersionNum(meta) {
    let max = 0;
    for (const v of meta.versions || []) {
      max = Math.max(max, versionNumFromLabel(v.version || v.versionLabel || ''));
    }
    return max + 1;
  }

  /**
   * Carga la versión activa (según metadata) con contexto para errores en boot.
   */
  async loadActivePublishedWithSource(flowId) {
    const meta = await this.getPublishedMetadata(flowId);
    if (!meta) return null;

    const entry = meta.versions.find(
      v => v.version === meta.activeVersion || v.versionLabel === meta.activeVersion
    );
    if (!entry) {
      throw new Error(
        `activeVersion "${meta.activeVersion}" no resuelve a ningún archivo en "${flowId}"`
      );
    }

    const filePath = path.join(this._flowPublishedDir(flowId), entry.file);
    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`No se pudo leer published "${flowId}" (${entry.file}): ${err.message}`);
    }

    let flow;
    try {
      flow = this._withDefaultSchemaVersion(JSON.parse(content));
    } catch (err) {
      throw new Error(`JSON inválido en "${flowId}/${entry.file}": ${err.message}`);
    }

    return {
      flow,
      source: {
        flowId,
        version: meta.activeVersion,
        file: entry.file,
        absolutePath: filePath
      }
    };
  }

  /**
   * Versión publicada activa (runtime / fallback engine).
   */
  async getLatestPublished(flowId) {
    const loaded = await this.loadActivePublishedWithSource(flowId);
    return loaded ? loaded.flow : null;
  }

  /**
   * Documento publicado por etiqueta de versión (p.ej. v2).
   */
  async getPublishedVersionDocument(flowId, versionParam) {
    const normalized = normalizeVersionParam(versionParam);
    if (!normalized) {
      throw new Error(`Versión inválida: "${versionParam}"`);
    }

    const meta = await this.getPublishedMetadata(flowId);
    if (!meta) {
      throw new Error(`No hay versiones publicadas para "${flowId}"`);
    }

    const entry = meta.versions.find(
      v => v.version === normalized || v.versionLabel === normalized
    );
    if (!entry) {
      throw new Error(`Versión "${normalized}" no encontrada para "${flowId}"`);
    }

    const filePath = path.join(this._flowPublishedDir(flowId), entry.file);
    const content = await fs.readFile(filePath, 'utf-8');
    const flow = this._withDefaultSchemaVersion(JSON.parse(content));

    const isActive =
      meta.activeVersion === entry.version || meta.activeVersion === entry.versionLabel;

    return { flow, meta, entry, isActive, normalizedVersion: normalized };
  }

  /**
   * Lista para API: historial + activeVersion (sin JSON completo de cada versión).
   */
  async listVersionSummary(flowId) {
    const meta = await this.getPublishedMetadata(flowId);
    if (!meta) return null;
    return {
      flowId: meta.flowId,
      activeVersion: meta.activeVersion,
      lastPublishedAt: meta.lastPublishedAt,
      updatedAt: meta.updatedAt,
      versions: meta.versions.map(v => ({
        version: v.version,
        versionLabel: v.versionLabel || v.version,
        file: v.file,
        publishedAt: v.publishedAt,
        notes: v.notes,
        sourceDraftUpdatedAt: v.sourceDraftUpdatedAt
      }))
    };
  }

  async publishDraft(flowId) {
    const draft = await this.getDraft(flowId);
    if (!draft) throw new Error(`No se puede publicar "${flowId}": El draft no existe.`);

    const normalizedDraft = this._withDefaultSchemaVersion(draft);
    flowValidator.validate(normalizedDraft);

    const dir = this._flowPublishedDir(flowId);
    await fs.mkdir(dir, { recursive: true });

    let meta = await this.getPublishedMetadata(flowId);
    if (!meta) {
      meta = {
        flowId,
        activeVersion: null,
        versions: [],
        lastPublishedAt: null,
        updatedAt: new Date().toISOString()
      };
    }

    const nextNum = this._nextVersionNum(meta);
    const versionLabel = `v${nextNum}`;
    const fileName = `${versionLabel}.json`;

    const publishedAt = new Date().toISOString();
    const publishedFlow = {
      ...normalizedDraft,
      id: flowId,
      schemaVersion: normalizedDraft.schemaVersion,
      version: versionLabel,
      status: 'published',
      publishedAt
    };

    const versionEntry = {
      version: versionLabel,
      versionLabel,
      file: fileName,
      publishedAt,
      sourceDraftUpdatedAt: normalizedDraft.updatedAt || null
    };

    await fs.writeFile(path.join(dir, fileName), JSON.stringify(publishedFlow, null, 2), 'utf-8');

    const newMeta = {
      flowId,
      activeVersion: versionLabel,
      versions: [...(meta.versions || []), versionEntry],
      lastPublishedAt: publishedAt,
      updatedAt: new Date().toISOString()
    };

    await this._writeMetadata(flowId, newMeta);

    console.log(`🚀 Publicado "${flowId}" versión ${versionLabel}`);
    return publishedFlow;
  }

  async importPublishedVersionFromJson(flowId, flow, { publish = false } = {}) {
    const normalizedFlow = this._withDefaultSchemaVersion({
      ...flow,
      id: flowId,
    });
    flowValidator.validate(normalizedFlow);

    const dir = this._flowPublishedDir(flowId);
    await fs.mkdir(dir, { recursive: true });

    let meta = await this.getPublishedMetadata(flowId);
    if (!meta) {
      meta = {
        flowId,
        activeVersion: null,
        versions: [],
        lastPublishedAt: null,
        updatedAt: new Date().toISOString()
      };
    }

    const nextNum = this._nextVersionNum(meta);
    const versionLabel = `v${nextNum}`;
    const fileName = `${versionLabel}.json`;
    const publishedAt = new Date().toISOString();

    const publishedFlow = {
      ...normalizedFlow,
      id: flowId,
      version: versionLabel,
      status: 'published',
      publishedAt
    };

    const versionEntry = {
      version: versionLabel,
      versionLabel,
      file: fileName,
      publishedAt,
      sourceDraftUpdatedAt: null
    };

    await fs.writeFile(path.join(dir, fileName), JSON.stringify(publishedFlow, null, 2), 'utf-8');

    const shouldPromoteAsActive = Boolean(publish) || !meta.activeVersion;
    const newMeta = {
      flowId,
      activeVersion: shouldPromoteAsActive ? versionLabel : meta.activeVersion,
      versions: [...(meta.versions || []), versionEntry],
      lastPublishedAt: shouldPromoteAsActive ? publishedAt : meta.lastPublishedAt,
      updatedAt: new Date().toISOString()
    };
    await this._writeMetadata(flowId, newMeta);

    return {
      flow: publishedFlow,
      activeVersion: newMeta.activeVersion,
      createdVersion: versionLabel,
      wasActivated: shouldPromoteAsActive
    };
  }

  /**
   * Copia una versión publicada al draft del mismo flowId.
   */
  async duplicatePublishedVersionToDraft(flowId, versionParam, { overwriteDraft = false } = {}) {
    const { flow, normalizedVersion } = await this.getPublishedVersionDocument(flowId, versionParam);

    const existing = await this.getDraft(flowId);
    if (existing && !overwriteDraft) {
      const err = new Error(
        `Ya existe un draft para "${flowId}". Envía overwriteDraft: true para reemplazarlo.`
      );
      err.code = 'CONFLICT';
      throw err;
    }

    const asDraft = {
      ...flow,
      id: flowId,
      status: 'draft',
      updatedAt: new Date().toISOString()
    };
    delete asDraft.publishedAt;

    return await this.saveDraft(asDraft);
  }
}

const flowRepository = new FlowRepository();
export default flowRepository;
