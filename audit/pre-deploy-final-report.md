# Informe final pre-deploy — Tea Bot

## 1. Executive summary

**Estado: `DEPLOY_READY_WITH_WARNINGS`**

El proyecto está en condiciones de subir al servidor después de:

1. Commitear y pushear los cambios locales (layout conversaciones + fixes de auditoría).
2. Ejecutar `npm run db:migrate` en el servidor (migración `004_audit_logs.sql` pendiente).
3. Configurar `.env` de producción (CORS, `SESSION_SECRET`, `DEV_TOOLS_ENABLED=false`, URL API en build frontend).
4. Validación manual corta en `/flows` y `/conversations`.

No marcar `DEPLOY_READY` estricto hasta completar migración 004 y smoke test en el entorno destino.

---

## 2. Cambios corregidos automáticamente

| Área | Problema | Corrección | Riesgo |
|------|----------|------------|--------|
| Migraciones | `db:migrate:status` fallaba (`executed_at` inexistente) | Compat columna legacy + rename `applied_at` | HIGH → resuelto |
| Migraciones | `db:migrate:dry-run` cerraba conexión | `ensureDatabaseExists` usa pool dedicado | HIGH → resuelto |
| Runtime flujos | `flow-engine` leía draft desde JSON repo | `flowDocumentService.getDraft` (DB) | HIGH → resuelto |
| Config | `.env.example` confuso sobre JSON storage | Comentarios actualizados + `DEV_TOOLS` | LOW |
| Frontend | Parse error `LoginPage` (sesión anterior) | JSX corregido | BLOCKER → resuelto |
| Layout | Panel conversaciones colapsado (`flex: 1 1 0`) | `calc(100vh - 64px)` como editor | MEDIUM → resuelto |

---

## 3. Checks ejecutados

| Comando | Resultado | Observaciones |
|---------|-----------|---------------|
| `git status` / `git diff --stat` | OK | 14+ archivos sin commit |
| `rg data/flows...` | OK | Solo scripts/tests/deprecated |
| `whatsapp-bot npm test` | **89/89 pass** | |
| `whatsapp-bot npm run db:migrate:status` | **pass** | 1 migración pendiente: 004 |
| `whatsapp-bot npm run db:migrate:dry-run` | **pass** | would-apply 004 |
| `whatsapp-bot npm run flows:parity-check` | **pass** | Sin JSON en disco |
| `frontend npm test -- --run` | **147/147 pass** | |
| `frontend npm run lint` | **0 errors** | 4 warnings hooks |
| `frontend npm run typecheck` | **pass** | |
| `frontend npm run build` | **pass** | chunk >500kb warning |
| `whatsapp-bot npm run lint` | COMMAND_NOT_AVAILABLE | |
| `whatsapp-bot npm run build` | COMMAND_NOT_AVAILABLE | |
| `flows:migrate-json-to-db --dry-run` | COMMAND_NOT_AVAILABLE | Usar `db:migrate:dry-run` |

---

## 4. Riesgos pendientes

### HIGH

| Riesgo | Acción |
|--------|--------|
| Migración `004_audit_logs.sql` no aplicada en DB destino | `npm run db:migrate` antes de levantar versión nueva |
| `docker-compose.yml` fija `VITE_API_BASE_URL` a IP hardcodeada | Rebuild frontend con URL HTTPS real del API |

### MEDIUM

| Riesgo | Acción |
|--------|--------|
| Cambios locales sin commit/push | `git add` + commit antes de deploy |
| Frontend y API en puertos distintos sin proxy | WebSocket/CORS/cookies: usar Nginx snippet o mismo origen |
| Checksums migraciones 001–003 sin backfill en prod | `db:migrate` hará backfill-checksum en primer run |

### LOW

| Riesgo | Acción |
|--------|--------|
| ESLint warnings `ConversationsPage` useMemo | No bloquea build |
| `flow.repository.js` sigue en repo (deprecated) | Eliminar en refactor futuro |
| README whatsapp-bot menciona `data/flows` | Actualizar docs |

---

## 5. Checklist deploy servidor

Ver **`audit/server-deploy-checklist.md`**.

Resumen:

```bash
git pull
# configurar whatsapp-bot/.env
docker compose build && docker compose up -d
cd whatsapp-bot && npm run db:migrate:status && npm run db:migrate
```

---

## 6. Rollback plan

1. **Antes de migrar:** backup completo de base `tea_bot`.
2. **Código:** `git checkout <commit-anterior>` + rebuild imágenes Docker.
3. **Servicios:** `docker compose down` → deploy versión anterior → `up -d`.
4. **DB:** si migración 004 falla, restaurar backup; no hay rollback automático de SQL en repo.
5. **No depender de JSON:** versión anterior también debe usar DB o se requiere export portable previo.

---

## 7. Go / No-Go

### Go condicionado (recomendado)

**GO para deploy** si en el servidor:

- [ ] Se aplican migraciones (incl. 004).
- [ ] `db:import-flows` o DB ya poblada.
- [ ] `.env` producción completo.
- [ ] `DEV_TOOLS_ENABLED` desactivado.
- [ ] Build frontend con API/WS URL correctas.
- [ ] Smoke test manual (login, flujos, conversaciones, simulador).

### No-Go absoluto si

- No hay SQL Server / credenciales.
- No se puede migrar y la app requiere tablas nuevas.
- Se despliega con `DEV_TOOLS_ENABLED=true` en producción pública.

---

## 8. Próximos pasos exactos

1. Revisar y **commitear** cambios (frontend layout + backend fixes auditoría).
2. `git push origin main`
3. En servidor: pull, `.env`, `docker compose build` con `VITE_API_BASE_URL` correcto.
4. `npm run db:migrate` + `db:migrate:status`
5. Si DB vacía: `npm run db:import-flows`
6. Smoke test checklist
7. Configurar Nginx según `audit/nginx-websocket-snippet.conf` si aplica

---

## Estados

- `PRE_DEPLOY_AUDIT_COMPLETED`
- `DEPLOY_READY_WITH_WARNINGS`
