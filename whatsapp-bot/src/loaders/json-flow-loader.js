import flowRepository from '../repositories/flow.repository.js';

/**
 * Carga flujos publicados desde archivos JSON (comportamiento original).
 */
export class JsonFlowLoader {
  async loadActivePublished(flowKey) {
    const loaded = await flowRepository.loadActivePublishedWithSource(flowKey);
    if (!loaded) return null;
    return {
      flow: loaded.flow,
      source: {
        ...loaded.source,
        storage: 'json',
      },
    };
  }

  async loadPublishedVersion(flowKey, versionLabel) {
    const { flow, normalizedVersion } = await flowRepository.getPublishedVersionDocument(
      flowKey,
      versionLabel,
    );
    return {
      flow,
      source: {
        flowId: flowKey,
        version: normalizedVersion,
        storage: 'json',
      },
    };
  }

  async listPublishedFlowKeys() {
    return flowRepository.listPublishedFlows();
  }
}

const jsonFlowLoader = new JsonFlowLoader();
export default jsonFlowLoader;
