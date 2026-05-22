# DoD — Eliminación local de JSON legacy (flujos)

**Fecha:** 2026-05-22  
**Estado final:** `LOCAL_LEGACY_JSON_REMOVED_READY_FOR_SERVER_DEPLOY`

---

## 1. Validación previa (`flows:parity-check`)

**Antes de borrar** (2026-05-22T12:42:31Z):

```
## main-menu — MATCH
Checksum archivo JSON: 007b137f…
Checksum snapshot DB: 007b137f…
Estado global: JSON_DB_PARITY_VALIDATED
```

**Después de borrar** (2026-05-22T12:44:13Z):

```
Sin carpeta data/flows/published en disco.
Estado: JSON_DB_PARITY_VALIDATED (nada que comparar en disco)
```

---

## 2. Backup local

| Campo | Valor |
|-------|--------|
| Archivo | `backups/flows-json-backup-20260522-094306.tar.gz` |
| Tamaño | ~102 KB |
| Contenido | `whatsapp-bot/data/flows/`, `whatsapp-bot/flows/` |
| En Git | No (carpeta `backups/` en `.gitignore`) |

Restaurar si hiciera falta:

```bash
cd /Users/nasserelbacha/Documents/Tea-bot
tar -xzf backups/flows-json-backup-20260522-094306.tar.gz
```

---

## 3. Carpetas eliminadas

| Ruta | Estado previo | Estado actual |
|------|---------------|---------------|
| `whatsapp-bot/data/flows/` | Existía (drafts, published, archive) | **Eliminada** |
| `whatsapp-bot/flows/` | Existía (index.json, main-menu.json) | **Eliminada** |

---

## 4. `.gitignore`

Confirmado (sin duplicados):

```gitignore
whatsapp-bot/data/flows/
whatsapp-bot/flows/
backups/
```

---

## 5. Búsquedas `rg` — clasificación

### `data/flows|flows/published|metadata.json|main-menu.json`

| Ubicación | Clasificación |
|-----------|----------------|
| `flow-import.service.js`, `flow-json-db-parity.js`, `import-flows-to-db.js` | **PERMITIDO_IMPORTACION** |
| `flow.repository.js`, `bootstrap-flows.js`, `json-flow-loader.js` | **DEPRECATED_NO_RUNTIME** (no usados en `app.js`) |
| `benchmark-flow-runtime.js`, `perf-benchmark-flow-runtime.json` | **PERMITIDO_TEST** |
| `audit/*`, `docs/*`, `README.md`, `WHATSAPP_BOT_DEPLOY_READINESS_AUDIT.md` | **PERMITIDO_DOC_LEGACY** |
| `.gitignore` | Configuración |

**ELIMINAR (runtime):** ninguno.

### `fs.readFile|fs.writeFile` en `whatsapp-bot/src`

| Archivo | Clasificación |
|---------|----------------|
| `flow-import.service.js`, `flow-json-db-parity.js`, `bootstrap-flows.js` | **PERMITIDO_IMPORTACION** / **DEPRECATED_NO_RUNTIME** |
| `flow.repository.js` | **DEPRECATED_NO_RUNTIME** |
| `session.service.js`, `webhook-dedupe.service.js` | Otros datos (sesiones/dedupe), no flujos |
| `db/migrate.js`, `phase2-migration.test.js` | Migraciones SQL |

**ELIMINAR (runtime flujos):** ninguno.

### `frontend/src`

Sin `fs.readFile`/`writeFile`. Rutas `import-json` = **PERMITIDO_IMPORTACION** (carga hacia API/DB).

---

## 6. Tests y scripts

| Comando | Resultado |
|---------|-----------|
| `npm test` (whatsapp-bot) | **PASS** — 79/79 tests |
| `npm run lint` | **No existe** en `package.json` |
| `npm run build` | **No existe** en `package.json` |

---

## 7. Inicio sin `data/flows`

Servidor local (`npm run dev`, reinicio automático `--watch` tras cambios):

```
📦 FLOW_STORAGE_MODE=db
[DbFlowLoader] Cargado "main-menu" v22 desde snapshot DB (checksum 007b137f…)
✅ FlowLoader: Cargada versión activa v22 de "main-menu" [db]
🚀 Sistema de flujos (Fase 3) y sesiones inicializado.
```

**No aparecen:** `data/flows not found`, `main-menu.json not found`, `metadata.json not found`.

Reinicio manual si hace falta: en `whatsapp-bot`, `Ctrl+C` y `npm run dev`.

---

## 8. Riesgos pendientes (servidor)

| Riesgo | Mitigación en deploy |
|--------|----------------------|
| Servidor aún tiene `data/flows/` en disco | No copiar carpetas; usar `FLOW_STORAGE_MODE=db` y DB migrada |
| Falta import en servidor | `npm run db:migrate` + verificar snapshots en SQL |
| Backup solo local | Repetir backup en servidor antes de borrar allí |
| `flow.repository.js` muerto en repo | Eliminar en PR futuro (opcional); no afecta runtime |

---

## 9. Criterios de aceptación

| Criterio | OK |
|----------|-----|
| Paridad pre-borrado `JSON_DB_PARITY_VALIDATED` | ✅ |
| Backup creado | ✅ |
| Carpetas legacy eliminadas | ✅ |
| `.gitignore` actualizado | ✅ |
| Runtime sin JSON | ✅ |
| `npm test` pasa | ✅ |
| Documentado | ✅ |

---

## Próximo paso (servidor)

1. Desplegar código con unificación DB.
2. `npm run db:migrate` + confirmar snapshots.
3. `npm run flows:parity-check` (si quedan JSON en servidor).
4. Backup + borrar `data/flows` y `flows/` en servidor.
5. Reiniciar proceso / `docker compose up -d --build`.
