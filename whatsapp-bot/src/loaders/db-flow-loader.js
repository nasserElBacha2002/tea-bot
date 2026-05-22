import flowDbRepository from '../repositories/flow-db.repository.js';
import { isConversationDbEnabled } from '../db/index.js';

function parseSnapshot(snapshotJson) {
  if (typeof snapshotJson === 'string') {
    return JSON.parse(snapshotJson);
  }
  return snapshotJson;
}

/**
 * Carga flujos desde flow_version_snapshots.snapshot_json.
 */
export class DbFlowLoader {
  isAvailable() {
    return isConversationDbEnabled() && flowDbRepository.isEnabled();
  }

  async loadActivePublished(flowKey) {
    if (!this.isAvailable()) {
      throw new Error('DB flow loader no disponible (CONVERSATION_DB / SQL Server)');
    }

    const row = await flowDbRepository.getLatestPublishedSnapshot(flowKey);
    if (!row) {
      throw new Error(`No hay versión publicada en DB para "${flowKey}"`);
    }

    const flow = parseSnapshot(row.snapshotJson);
    const version = row.versionLabel || `v${row.versionNumber}`;
    console.log(
      `[DbFlowLoader] Cargado "${flowKey}" ${version} desde snapshot DB (checksum ${row.checksum?.slice(0, 8) || 'n/a'}…)`,
    );
    return {
      flow,
      source: {
        flowId: flowKey,
        version,
        storage: 'db',
        checksum: row.checksum,
      },
    };
  }

  async loadPublishedVersion(flowKey, versionLabel) {
    if (!this.isAvailable()) {
      throw new Error('DB flow loader no disponible');
    }

    const row = await flowDbRepository.getPublishedSnapshotByLabel(flowKey, versionLabel);
    if (!row) {
      throw new Error(`Versión "${versionLabel}" no encontrada en DB para "${flowKey}"`);
    }

    const flow = parseSnapshot(row.snapshotJson);
    console.log(
      `[DbFlowLoader] Cargado "${flowKey}" ${row.versionLabel} (${row.status || 'unknown'}) desde snapshot DB`,
    );
    return {
      flow,
      source: {
        flowId: flowKey,
        version: row.versionLabel,
        storage: 'db',
        status: row.status,
      },
    };
  }

  async listPublishedFlowKeys() {
    if (!this.isAvailable()) return [];
    return flowDbRepository.listPublishedFlowKeys();
  }
}

const dbFlowLoader = new DbFlowLoader();
export default dbFlowLoader;
