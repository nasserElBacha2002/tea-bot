# Exportación/importación JSON portable y migraciones SQL

**Fecha:** 2026-05-22  
**Estados:** `FLOW_JSON_PORTABLE_EXPORT_IMPORT_READY` · `DB_MIGRATION_SCRIPT_READY`

---

## Motor de base de datos

El proyecto usa **Microsoft SQL Server** (`mssql`), no MySQL.

Variables en `.env`:

```env
CONVERSATION_DB_ENABLED=true
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=tea_bot
DB_USER=sa
DB_PASSWORD=...
DB_TRUST_SERVER_CERTIFICATE=true
DB_ENCRYPT=false
```

Carpeta de migraciones: `whatsapp-bot/migrations/*.sql` (orden alfabético, batches separados por `GO`).

---

## Parte A — Exportar flujos desde DB

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/flows/:flowId/export` | Versión publicada activa (o borrador si no hay publicada) |
| GET | `/api/flows/:flowId/versions/:version/export` | Versión específica (publicada o borrador) |
| GET | `/api/flows/export/all` | Bundle `{ exportedAt, source: "db", flows: [...] }` |

- Lee solo desde DB (`flow-document.service.js` + `flow_version_snapshots` / tablas normalizadas).
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="main-menu-v22.json"`

Errores en español: 404 flujo/versión, 500 exportación fallida.

---

## Parte B — UI Descargar JSON

- **Listado** (`/flows`): icono descarga por fila.
- **Editor** (`/flows/:id/conversation`): botón **Descargar JSON** junto a Importar JSON / Validar.

Utilidad: `frontend/src/features/flows/utils/downloadFlowJson.ts`

---

## Parte C — Importar JSON hacia DB

Endpoint existente (sin cambio de ruta):

`POST /api/flows/:flowId/versions/import-json`  
Body: `{ flow, publish?: boolean }`

- Valida con `flow-validator.js`
- Persiste en DB vía `flow-import.service.js` (nodos, transiciones, snapshot, checksum)
- **No** escribe en `data/flows` ni `flows/`
- Respuesta ampliada: `ok`, `message`, `status`, `version`, etc.

Texto de ayuda en diálogo Importar JSON actualizado en frontend.

---

## Parte D — Tests

| Archivo | Qué cubre |
|---------|-----------|
| `src/services/flow-export-portable.test.js` | Validador, sin `data/flows` en disco |
| `src/db/migration-runner.test.js` | Split GO, listado `.sql` |

Ejecutar: `cd whatsapp-bot && npm test`

---

## Parte E — Migraciones en servidor

| Comando | Acción |
|---------|--------|
| `npm run db:migrate` | Aplica migraciones pendientes (idempotente) |
| `npm run db:run-sql` | Alias de `db:migrate` |
| `npm run db:migrate:status` | Lista aplicadas / pendientes + checksum |
| `npm run db:migrate:dry-run` | Simula sin escribir en DB |

Tabla de control: `dbo.schema_migrations`  
Campos: `filename`, `checksum`, `executed_at`, `success`

Si una migración ya aplicada cambia de checksum:

```text
La migración "00X_foo.sql" ya fue ejecutada pero el checksum cambió. No se aplicará automáticamente.
```

Implementación: `src/db/migration-runner.js` (reutilizado por `src/db/migrate.js`).

### Local

```bash
cd whatsapp-bot
npm run db:migrate:status
npm run db:migrate
```

### Servidor (tras subir código)

```bash
cd whatsapp-bot
cp .env.example .env   # o usar el .env del servidor
npm run db:migrate:status
npm run db:migrate
# reiniciar proceso / docker compose up -d --build
```

---

## JSON = formato portable, no storage

| Operación | Storage |
|-----------|---------|
| Runtime bot | Solo DB |
| Editor guardar/publicar | Solo DB |
| Descargar JSON | Export desde DB |
| Importar JSON | Insert/update en DB |
| `flows:migrate-json-to-db` | Migración one-shot desde archivos legacy |

---

## Comandos de validación ejecutados

```bash
cd whatsapp-bot && npm test
rg "data/flows|flows/published|metadata.json" .   # clasificar resultados
```

`npm run lint` / `npm run build` — no definidos en `whatsapp-bot/package.json`.

---

## Riesgos pendientes

1. En servidor: correr `db:migrate` antes de reiniciar el bot.
2. Export masivo (`/export/all`) puede ser pesado con muchos flujos grandes.
3. Import siempre crea **nueva versión publicada** (comportamiento histórico); borrador vía editor PUT.

---

## Archivos clave

- `src/services/flow-document.service.js` — export + CRUD DB
- `src/controllers/flow-export.controller.js`
- `src/db/migration-runner.js`
- `frontend/src/features/flows/utils/downloadFlowJson.ts`
