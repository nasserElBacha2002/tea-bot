# Auditoría pre-deploy — Tea Bot

| Campo | Valor |
|-------|--------|
| Fecha | 2026-05-22 |
| Rama | `main` (ahead of `origin/main` by 4 commits) |
| Commit HEAD | `59e363f` — new implementations |
| Auditoría | Automatizada + correcciones en repo |

## Estado general

**`DEPLOY_READY_WITH_WARNINGS`**

El sistema pasa tests y builds locales. Se corrigieron bugs bloqueantes en migraciones y runtime de borradores. Antes de subir al servidor: commitear cambios locales, aplicar migración `004_audit_logs.sql`, revisar `docker-compose` y CORS/cookies de producción.

## Archivos modificados (working tree)

```
14 archivos frontend (layout conversaciones, scroll, WS hooks)
+ whatsapp-bot: migration-runner, flow-engine, .env.example
+ audit/*.md (esta auditoría)
```

Sin `.env`, backups `.tar.gz` ni `data/flows/` trackeados (`.gitignore` OK).

## Parte B — Git

| Tipo | Detalle |
|------|---------|
| Modificados | 14 archivos frontend + 3 backend (post-auditoría) |
| Sin trackear | `frontend/src/components/layout/appShellLayout.ts`, `audit/pre-deploy-*.md`, `audit/nginx-websocket-snippet.conf` |
| Sensibles | Ningún `.env` en índice git |
| JSON legacy dirs | Ignorados: `whatsapp-bot/data/flows/`, `whatsapp-bot/flows/` |

## Parte C — JSON vs runtime

| Clasificación | Hallazgos |
|---------------|-----------|
| PERMITIDO_EXPORTACION | `flow-export-portable`, `flow-export.controller`, tests |
| PERMITIDO_IMPORTACION | `flow-import.service.js`, scripts `import-flows`, `flow-json-db-parity.js` |
| PERMITIDO_TEST | Tests que mencionan `data/flows` |
| PERMITIDO_DOC_LEGACY | `audit/*`, `README` antiguo |
| DEPRECATED_NO_RUNTIME | `flow.repository.js`, `bootstrap-flows.js`, `json-flow-loader.js` (no usados por `composite-flow-loader` → solo `db-flow-loader`) |
| **Corregido** | `flow-engine.service.js` usaba `flowRepository.getDraft` → ahora `flowDocumentService.getDraft` (DB) |

**Inicio runtime:** `app.js` usa `flowDocumentService.ensureStructure()` + `compositeFlowLoader` (DB). No requiere carpetas JSON.

`npm run flows:parity-check` → `JSON_DB_PARITY_VALIDATED` (sin JSON en disco).

## Parte D — DB flujos

- Listar/guardar/publicar/import/export vía `flow-document.service.js` + `/api/flows`.
- Parity check OK sin JSON local.

## Parte E — Migraciones

| Comando | Resultado |
|---------|-----------|
| `npm run db:migrate:status` | OK tras fix columna `executed_at` legacy |
| `npm run db:migrate:dry-run` | OK tras fix pool `master` (no cerrar pool global) |

**Pendiente en DB local:** `004_audit_logs.sql` (aditiva, tabla `audit_logs`).

**Correcciones aplicadas:**

1. `ensureSchemaMigrationsTable`: renombra `applied_at` → `executed_at` o agrega columna.
2. `ensureDatabaseExists`: usa `ConnectionPool` dedicado a `master` (no `sql.connect` global).

## Partes F–G — Tests / build

| Área | Comando | Resultado |
|------|---------|-----------|
| Backend tests | `npm test` | 89/89 pass |
| Backend lint | — | COMMAND_NOT_AVAILABLE |
| Backend build | — | COMMAND_NOT_AVAILABLE (`start` only) |
| Frontend tests | `npm test -- --run` | 147/147 pass |
| Frontend lint | `npm run lint` | 0 errors, 4 warnings |
| Frontend typecheck | `npm run typecheck` | pass |
| Frontend build | `npm run build` | pass |

## Parte H — WebSocket

| Check | Estado |
|-------|--------|
| `/api/conversations/live` + cookie auth | OK |
| Ping/pong 30s | OK |
| Broadcaster sin clientes | OK (no throw) |
| Frontend solo en `/conversations` | OK (hook solo en `ConversationsPage`, `enabled: true` al montar ruta) |
| Cleanup unmount / reconnect backoff | OK |
| Dedup por `messageId` | OK (`applyConversationLiveEvent`) |

Doc Nginx: `audit/nginx-websocket-snippet.conf`

## Parte I — Conversaciones sin WhatsApp

Flujo validado por tests + arquitectura:

- Simulador persiste usuario **antes** del motor + emite WS.
- Dev route `POST /api/dev/conversations/inbound-message` (solo dev / `DEV_TOOLS_ENABLED` en prod).

Validación manual recomendada en servidor (checklist).

## Parte J — Dev endpoints

`dev-conversations.routes.js`: 404 en producción salvo `DEV_TOOLS_ENABLED=true`. Auth `requireAuth` siempre.

## Parte K — Seguridad

| Item | Estado |
|------|--------|
| `.env` gitignore | OK |
| `.env.example` | Actualizado (`DEV_TOOLS`, `FLOW_STORAGE_MODE`) |
| Cookies producción | Documentar `Secure` + `SameSite` en despliegue HTTPS |
| Secrets hardcoded | `docker-compose` tiene IP ejemplo en `VITE_API_BASE_URL` build-arg — **revisar en servidor** |

## Parte L — Docker

- `docker-compose.yml`: sqlserver + whatsapp-bot + frontend (nginx static).
- Frontend build-arg `VITE_API_BASE_URL: http://170.239.85.196:3000` — **cambiar por URL real del backend**.
- Healthcheck sqlserver; restart unless-stopped.
- Volumen `./whatsapp-bot/data` — sesiones JSON locales; flujos en DB.

## Correcciones aplicadas en esta auditoría

1. `migration-runner.js` — compat `executed_at` + pool master aislado.
2. `flow-engine.service.js` — draft desde DB (`flowDocumentService`).
3. `whatsapp-bot/.env.example` — documentación `DEV_TOOLS` y storage.

## Estados DoD previos (conversaciones / layout)

- `PRE_DEPLOY_AUDIT_COMPLETED` (este documento)
- Layout/scroll: cambios locales sin commitear aún
- Ver `audit/conversations-chat-layout-and-user-inputs-dod.md`
