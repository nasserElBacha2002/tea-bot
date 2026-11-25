# CR2-431-03

`conversationRetention.media-e2e.integration.test.js`:

1. Adjunto `stored` + archivo en `data/inbound-media`.
2. TX `deleteInactiveRetentionBatch` → fila en `retention_pending_storage_deletes`.
3. Nueva instancia `ConversationRetentionService` → `_hydratePendingMediaFromStore` + `_flushPendingMediaDeletes`.
4. Archivo eliminado y cola vacía; segundo flush idempotente.