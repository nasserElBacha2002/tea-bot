import flowRepository from '../repositories/flow.repository.js';
import flowValidator from '../utils/flow-validator.js';

class FlowLoader {
  constructor() {
    this.flows = new Map();
    this.defaultFlowId = 'main-menu';
  }

  /**
   * Carga todas las versiones activas publicadas y valida cada una.
   */
  async load() {
    this.flows.clear();
    const publishedFlowIds = await flowRepository.listPublishedFlows();

    for (const flowId of publishedFlowIds) {
      await this.reloadFlow(flowId);
    }

    if (publishedFlowIds.length === 0) {
      console.warn('⚠️ FlowLoader: No se han encontrado carpetas de flujos publicados.');
    }
  }

  /**
   * Recarga un solo flujo publicado activo en la cache (tras publish, etc.).
   */
  async reloadFlow(flowId) {
    const loaded = await flowRepository.loadActivePublishedWithSource(flowId);
    if (!loaded) {
      this.flows.delete(flowId);
      return null;
    }

    const { flow, source } = loaded;
    try {
      flowValidator.validate(flow);
    } catch (err) {
      const hint = `${source.flowId} versión ${source.version} (${source.file})`;
      throw new Error(`Published flow inválido [${hint}]: ${err.message}`);
    }

    this.flows.set(flowId, flow);
    console.log(`✅ FlowLoader: Cargada versión activa ${source.version} de "${flowId}"`);
    return flow;
  }

  getFlow(id) {
    return this.flows.get(id);
  }

  getDefaultFlowId() {
    return this.defaultFlowId;
  }
}

const flowLoader = new FlowLoader();
export default flowLoader;
