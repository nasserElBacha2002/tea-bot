import dbFlowLoader from './db-flow-loader.js';

/**
 * Carga flujos publicados desde SQL Server (snapshots).
 */
export class CompositeFlowLoader {
  getMode() {
    return 'db';
  }

  loadActivePublished(flowKey) {
    return dbFlowLoader.loadActivePublished(flowKey);
  }

  loadPublishedVersion(flowKey, versionLabel) {
    return dbFlowLoader.loadPublishedVersion(flowKey, versionLabel);
  }

  listPublishedFlowKeys() {
    return dbFlowLoader.listPublishedFlowKeys();
  }
}

const compositeFlowLoader = new CompositeFlowLoader();
export default compositeFlowLoader;
