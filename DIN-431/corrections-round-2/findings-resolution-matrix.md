| Hallazgo | Código | Prueba |
|----------|--------|--------|
| CR2-431-01 | `session.service.js` — una sola resolución SQL, fence `updatedAt`, reset síncrono | `session.service.retention.test.js` |
| CR2-431-02 | `conversation.repository.js` — sin catch; enqueue obligatorio | `conversationRetention.transaction.integration.test.js` |
| CR2-431-03 | cola + archivo real | `conversationRetention.media-e2e.integration.test.js` |
| CR2-431-04 | TX requerida en `deleteInactiveRetentionBatch` | `transaction.integration.test.js`, callers con `withTransaction` |
| CR2-431-05 | `patchRetentionJobAttemptSkip`, `upsertJobStatusRetentionOwner` | `job-status.store.retention.test.js` |
| CR2-431-06 | `_pendingMediaCount` uncertain, hydrate fail, ackFailed → PARTIAL | `conversationRetention.service.js` + E2E |
| CR2-431-07 | 1200 unit batches; 120 SQL | `service.test.js`, `batch-scale.integration.test.js` |
| CR2-431-08 | diffs en `corrections-round-2/` | manifiesto abajo |