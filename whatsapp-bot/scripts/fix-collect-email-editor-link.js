#!/usr/bin/env node
/**
 * Enlaza collect_email → welcome para que el editor muestre el árbol conectado.
 * No cambia entryNode (sigue siendo collect_email para el bot en runtime).
 *
 * Uso:
 *   node scripts/fix-collect-email-editor-link.js main-menu v28 published
 *   node scripts/fix-collect-email-editor-link.js main-menu v28 draft
 */
import '../src/config.js';
import { query, closePool } from '../src/db/index.js';

const flowKey = process.argv[2] || 'main-menu';
const versionLabel = process.argv[3] || 'v28';
const versionStatus = process.argv[4] || 'published';

const { rows: versions } = await query(
  `SELECT fv.id, fv.status, fv.version_label
   FROM dbo.flows f
   JOIN dbo.flow_versions fv ON fv.flow_id = f.id
   WHERE f.flow_key = $1 AND fv.version_label = $2 AND fv.status = $3`,
  [flowKey, versionLabel, versionStatus],
);

if (versions.length === 0) {
  console.error(
    `[fix-collect-email] No se encontró ${flowKey} ${versionLabel} status=${versionStatus}`,
  );
  process.exit(1);
}

const versionId = versions[0].id;
console.log(`[fix-collect-email] target=${flowKey} ${versionLabel} (${versionStatus}) id=${versionId}`);

const before = await query(
  `SELECT n.node_key, t.type, t.next_node_key, t.priority
   FROM dbo.flow_transitions t
   JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
   WHERE n.flow_version_id = $1 AND n.node_key = 'collect_email'`,
  [versionId],
);
console.log('[fix-collect-email] before', before.rows);

await query(
  `UPDATE t
   SET t.next_node_key = N'welcome'
   FROM dbo.flow_transitions t
   INNER JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
   WHERE n.flow_version_id = $1
     AND n.node_key = N'collect_email'
     AND t.type = N'default'
     AND t.next_node_key = N'collect_email'`,
  [versionId],
);

const after = await query(
  `SELECT n.node_key, t.type, t.next_node_key, t.priority
   FROM dbo.flow_transitions t
   JOIN dbo.flow_nodes n ON n.id = t.flow_node_id
   WHERE n.flow_version_id = $1 AND n.node_key = 'collect_email'`,
  [versionId],
);
console.log('[fix-collect-email] after', after.rows);

await closePool();
