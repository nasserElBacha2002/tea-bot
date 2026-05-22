# Fase 5 — Flujos en DB + seed local

## Tablas

- `flows`, `flow_versions`, `flow_nodes`, `flow_transitions`, `flow_version_snapshots`
- Migración: `migrations/003_flows_schema.sql`

## Import JSON → DB

- Script: `npm run db:import-flows`
- Servicio: `FlowImportService`
- **Idempotencia:** upsert por `flow_key` y `(flow_id, version_number)`; si el checksum SHA-256 del archivo no cambió, se omite la reimportación; si cambió, se borran nodos/transiciones/snapshot de esa versión y se reinsertan.

## Validación post-import

- `flowValidator.validate`
- Conteo nodos/transiciones
- `entryNode` / `fallbackNode` existentes
- Cada `next_node_key` apunta a un nodo existente
- Checksum del snapshot coincide

## Runtime loader

- `FLOW_STORAGE_MODE`: `json` | `db` | `db_with_json_fallback`
- `CompositeFlowLoader` → `flow-loader.js` carga snapshots desde DB cuando corresponde
- El FlowEngine recibe el mismo objeto JSON que antes (`snapshot_json`)

## Seed local

- `npm run db:seed-conversations` — 5 conversaciones `SIM-*`, `provider=internal`
- Guard: no producción salvo `ALLOW_DEV_SEED=true`
- `--reset` / `RESET_DEV_SEED=true` borra solo `SIM-*` y mensajes con `seed: true`

## Inbox sin Twilio

- Seed usa simulador/internal
- Respuestas manuales a `provider=internal` no llaman Twilio
- Conversaciones seed (`SIM-*` o metadata `seed: true`) nunca disparan Twilio aunque parezcan WhatsApp

## Limitaciones / Fase 6

- Editor visual y publicación desde UI
- Sin borrar archivos JSON automáticamente
- Un solo draft por flow en DB (`version_number = 0`)
