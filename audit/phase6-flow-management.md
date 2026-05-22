# Fase 6 — Gestión de flujos desde DB

## Resumen

Se implementó la plataforma interna de gestión de flujos con la base de datos como fuente de verdad. El runtime en `FLOW_STORAGE_MODE=db` sigue cargando snapshots desde `flow_version_snapshots`; no se escriben flujos editados a archivos JSON.

## Rutas API

Prefijo: **`/api/flow-management`** (evita colisión con `/api/flows` del editor JSON en disco).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/flows` | Lista flujos con versión publicada y borrador |
| GET | `/flows/:flowId` | Detalle + conteos |
| GET | `/flows/:flowId/versions` | Historial de versiones |
| POST | `/flows/:flowId/drafts` | Crear borrador desde versión base |
| GET | `/flow-versions/:versionId` | Detalle con nodos, transiciones, validación |
| GET | `/flow-versions/:versionId/snapshot` | Snapshot JSON desde DB |
| PATCH | `/flow-versions/:versionId` | Metadata de borrador |
| POST | `/flow-versions/:versionId/nodes` | Crear nodo en borrador |
| POST | `/flow-versions/:versionId/validate` | Validar versión |
| POST | `/flow-versions/:versionId/publish` | Publicar borrador (transaccional) |
| POST | `/flow-versions/:versionId/rollback` | Crear borrador desde versión histórica |
| DELETE | `/flow-versions/:versionId/draft` | Descartar borrador |
| PATCH | `/flow-nodes/:nodeId` | Editar nodo (solo borrador) |
| DELETE | `/flow-nodes/:nodeId` | Eliminar nodo |
| POST | `/flow-nodes/:nodeId/transitions` | Crear transición |
| PATCH | `/flow-transitions/:transitionId` | Editar transición |
| DELETE | `/flow-transitions/:transitionId` | Eliminar transición |

Todas requieren autenticación (`requireAuth`).

## Frontend

| Ruta | Página |
|------|--------|
| `/admin/flows` | Lista de flujos DB |
| `/admin/flows/:flowId/versions` | Versiones |
| `/admin/flow-versions/:versionId` | Inspector (solo lectura) |
| `/admin/flow-versions/:versionId/edit` | Editor de borrador |

El editor JSON legacy permanece en `/flows` y `/api/flows`.

## Borrador

1. Un solo borrador activo por flujo (409 si ya existe).
2. `version_number = max + 1`, etiqueta `v{n}`.
3. Copia profunda de nodos y transiciones desde la versión base.
4. No modifica la versión publicada hasta publicar.

## Validación

Servicio `flow-validation-management.service.js`:

- Errores bloquean publicación: entrada/fallback inexistentes, destinos de transición, tipos no soportados, mensaje vacío en message/capture, duplicados.
- Advertencias permitidas: nodos inalcanzables, ciclos, sin transiciones, handoff sin mensaje.
- Validación final con `flowValidator` sobre documento reconstruido.

## Publicación (transaccional)

1. Validar borrador.
2. Generar `snapshot_json` y checksum desde tablas (`flow-snapshot-builder.js`).
3. En transacción SQL: archivar publicada actual → insertar snapshot → marcar borrador como `published`.
4. Recargar runtime: `flowLoader.reloadFlow(flowKey)`.

## Snapshot

- Origen: `flows`, `flow_versions`, `flow_nodes`, `flow_transitions`.
- Forma compatible con `FlowEngine` / `flowValidator`.
- `implicit_next` en DB se exporta como `nextNode` en el nodo.

## Rollback

- Por defecto: crea borrador desde versión archivada/publicada histórica (no republish in-place).
- `publishImmediately: true`: valida, publica el nuevo borrador en una transacción.

## Runtime DB

- `DbFlowLoader.loadPublishedVersion` carga snapshots por etiqueta **sin filtrar solo published** — sesiones activas en v19 siguen cargando v19 tras publicar v20.
- Nuevas conversaciones usan la última publicada vía `loadActivePublished`.

## Auditoría

Migración `004_audit_logs.sql`, servicio `audit-log.service.js` (no bloquea si la tabla no existe aún; registra en consola si falla).

Acciones: `CREATE_DRAFT`, `UPDATE_FLOW_NODE`, `PUBLISH_FLOW_VERSION`, `DISCARD_DRAFT`, `ROLLBACK_FLOW_VERSION`, etc.

## Cómo probar sin JSON

```bash
cd whatsapp-bot
npm run db:migrate          # incluye 004
npm run db:import-flows
FLOW_STORAGE_MODE=db npm run dev
# Opcional: renombrar data/flows para confirmar que no se leen
```

UI: iniciar sesión → **Flujos DB** → crear borrador → editar mensaje → validar → publicar.

## Limitaciones (Fase 6)

- Sin editor visual drag-and-drop.
- Cambio de `node_key` en borrador no implementado (solo message/tipo/metadata/posición).
- Un borrador activo por flujo.
- API bajo `/api/flow-management` (no `/api/flows` literal por colisión con legacy).
- Permisos finos y auth de actor en audit pendientes de fase de identidad.

## Próximas fases

- Editor de grafo visual.
- Permisos por rol.
- Analytics por versión.
- Replay de conversación por camino de flujo.
