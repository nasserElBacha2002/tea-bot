# CR2-431-04

- `deleteInactiveRetentionBatch` exige `transaction`.
- `deleteInactiveBatchBefore` envuelve con `withTransaction` si falta.
- Rollback test: conversación y cola intactas tras error forzado.
- Policy/delivery tests usan `withTransaction`.