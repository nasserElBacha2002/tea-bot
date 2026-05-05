import flowRepository from '../repositories/flow.repository.js';
import flowValidator from '../utils/flow-validator.js';
import { compileFlow } from './compile-flow.js';
import { logPerf, nowMs, roundMs } from './perf-timer.js';

class FlowLoader {
  constructor() {
    this.cache = new Map();
    this.defaultFlowId = 'main-menu';
  }

  /**
   * Carga todas las versiones activas publicadas y valida cada una.
   */
  async load() {
    const start = nowMs();
    this.cache.clear();
    const publishedFlowIds = await flowRepository.listPublishedFlows();

    for (const flowId of publishedFlowIds) {
      await this.reloadFlow(flowId);
    }

    if (publishedFlowIds.length === 0) {
      console.warn('⚠️ FlowLoader: No se han encontrado carpetas de flujos publicados.');
    }
    logPerf('flow_loader_load', {
      flowCount: this.cache.size,
      totalMs: roundMs(nowMs() - start),
    });
  }

  /**
   * Recarga un solo flujo publicado activo en la cache (tras publish, etc.).
   */
  async reloadFlow(flowId) {
    const start = nowMs();
    const loaded = await flowRepository.loadActivePublishedWithSource(flowId);
    if (!loaded) {
      this.cache.delete(flowId);
      return null;
    }

    const { flow, source } = loaded;
    let compiled;
    try {
      flowValidator.validate(flow);
      compiled = compileFlow(flow);
    } catch (err) {
      const hint = `${source.flowId} versión ${source.version} (${source.file})`;
      throw new Error(`Published flow inválido [${hint}]: ${err.message}`);
    }

    const cacheEntry = {
      flow,
      compiled,
      flowId,
      version: source.version,
      loadedAt: new Date().toISOString(),
      transitionCount: compiled.stats.transitionCount,
      nodeCount: compiled.stats.nodeCount,
    };
    this.cache.set(flowId, cacheEntry);
    console.log(`✅ FlowLoader: Cargada versión activa ${source.version} de "${flowId}"`);
    logPerf('flow_compile', {
      flowId,
      version: source.version,
      compileMs: roundMs(nowMs() - start),
      nodes: compiled.stats.nodeCount,
      transitions: compiled.stats.transitionCount,
      exactValues: compiled.stats.exactValueCount,
    });
    logPerf('flow_loader_reload', {
      flowId,
      version: source.version,
      totalMs: roundMs(nowMs() - start),
      nodeCount: compiled.stats.nodeCount,
      transitionCount: compiled.stats.transitionCount,
    });
    return flow;
  }

  invalidateFlow(flowId) {
    this.cache.delete(flowId);
    logPerf('flow_cache_invalidate', { flowId });
  }

  async getFlow(id) {
    const entry = this.cache.get(id);
    if (entry) {
      const ageMs = roundMs(Date.now() - new Date(entry.loadedAt).getTime());
      logPerf('flow_cache_hit', { flowId: id, version: entry.version, ageMs });
      return entry.flow;
    }
    logPerf('flow_cache_miss', { flowId: id });
    const loaded = await this.reloadFlow(id);
    return loaded;
  }

  getCompiledFlow(id) {
    return this.cache.get(id)?.compiled || null;
  }

  getCacheInfo(id) {
    const entry = this.cache.get(id);
    if (!entry) return null;
    return {
      flowId: id,
      version: entry.version,
      loadedAt: entry.loadedAt,
      hasCompiledFlow: Boolean(entry.compiled),
      nodeCount: entry.nodeCount,
      transitionCount: entry.transitionCount,
      cacheAgeMs: roundMs(Date.now() - new Date(entry.loadedAt).getTime()),
    };
  }

  hasFlow(id) {
    return this.cache.has(id);
  }

  getDefaultFlowId() {
    return this.defaultFlowId;
  }
}

const flowLoader = new FlowLoader();
export default flowLoader;
