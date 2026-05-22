import { getFlowStorageMode } from '../config/flow-storage.js';
import jsonFlowLoader from './json-flow-loader.js';
import dbFlowLoader from './db-flow-loader.js';

/**
 * Selecciona origen de flujos según FLOW_STORAGE_MODE.
 */
export class CompositeFlowLoader {
  constructor() {
    this.mode = getFlowStorageMode();
  }

  getMode() {
    return this.mode;
  }

  async loadActivePublished(flowKey) {
    if (this.mode === 'json') {
      return jsonFlowLoader.loadActivePublished(flowKey);
    }

    if (this.mode === 'db') {
      return dbFlowLoader.loadActivePublished(flowKey);
    }

    // db_with_json_fallback
    try {
      return await dbFlowLoader.loadActivePublished(flowKey);
    } catch (dbErr) {
      console.warn(
        `[CompositeFlowLoader] DB falló para "${flowKey}" (${dbErr.message}); usando JSON.`,
      );
      return jsonFlowLoader.loadActivePublished(flowKey);
    }
  }

  async loadPublishedVersion(flowKey, versionLabel) {
    if (this.mode === 'json') {
      return jsonFlowLoader.loadPublishedVersion(flowKey, versionLabel);
    }
    if (this.mode === 'db') {
      return dbFlowLoader.loadPublishedVersion(flowKey, versionLabel);
    }
    try {
      return await dbFlowLoader.loadPublishedVersion(flowKey, versionLabel);
    } catch (dbErr) {
      console.warn(
        `[CompositeFlowLoader] DB versión falló (${dbErr.message}); usando JSON.`,
      );
      return jsonFlowLoader.loadPublishedVersion(flowKey, versionLabel);
    }
  }

  async listPublishedFlowKeys() {
    if (this.mode === 'json') {
      return jsonFlowLoader.listPublishedFlowKeys();
    }
    if (this.mode === 'db') {
      return dbFlowLoader.listPublishedFlowKeys();
    }
    const dbKeys = await dbFlowLoader.listPublishedFlowKeys().catch(() => []);
    if (dbKeys.length > 0) return dbKeys;
    return jsonFlowLoader.listPublishedFlowKeys();
  }
}

const compositeFlowLoader = new CompositeFlowLoader();
export default compositeFlowLoader;
