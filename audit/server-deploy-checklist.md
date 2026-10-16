# Checklist deploy servidor — Tea Bot

## Pre-requisitos

- [ ] SQL Server accesible desde el host Docker
- [ ] `.env` en `whatsapp-bot/.env` (copiar desde `whatsapp-bot/.env.example`)
- [ ] Variables de producción: `NODE_ENV=production`, `SESSION_SECRET` largo, `ADMIN_PASSWORD_HASH`
- [ ] `CONVERSATION_DB_ENABLED=true` y `DB_*` correctos
- [ ] `FLOW_STORAGE_MODE=db` (único modo soportido)
- [ ] `DEV_TOOLS_ENABLED` **no** definido o `false` en producción
- [ ] `CORS_ORIGIN` con el origen exacto del frontend (HTTPS)
- [ ] Flujos importados en DB (`npm run db:import-flows` si la DB está vacía)
- [ ] Backup de la base antes de migrar

## Nginx / WebSocket

Si usás reverse proxy, ver `audit/nginx-websocket-snippet.conf`.

Headers mínimos para `/api/conversations/live`:

- `Upgrade`
- `Connection: upgrade`
- `proxy_http_version 1.1`
- `proxy_read_timeout` ≥ 3600s

Frontend en producción:

- Mismo origen que la API **o** `VITE_API_BASE_URL` en build apuntando al backend HTTPS.
- WebSocket: `resolveWebSocketOrigin()` usa `http→ws` / `https→wss` automáticamente.

## Comandos sugeridos (raíz del repo)

```bash
git pull

cp whatsapp-bot/.env.example whatsapp-bot/.env
# Editar whatsapp-bot/.env con valores de servidor

docker compose down
docker compose build --no-cache
docker compose up -d

docker compose logs -f whatsapp-bot
docker compose logs -f frontend
```

## Migraciones DB (dentro del contenedor o con `.env` local)

```bash
cd whatsapp-bot
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

Si la DB está vacía de flujos:

```bash
npm run db:import-flows
```

Opcional seed conversaciones (solo dev; **no** en prod salvo prueba controlada):

```bash
# ALLOW_DEV_SEED=true solo en entornos de prueba
npm run db:seed-local
```

## Verificación post-deploy

- [ ] `GET /` frontend carga login
- [ ] Login admin funciona (cookie `tea_session`)
- [ ] `/flows` lista flujos desde DB
- [ ] Editor: guardar, publicar, export/import JSON
- [ ] `/conversations` lista conversaciones
- [ ] WebSocket “En vivo” en `/conversations`
- [ ] Simulador crea conversación visible en bandeja
- [ ] `POST /api/dev/*` responde **404** en producción sin `DEV_TOOLS_ENABLED`

## Rollback rápido

```bash
git checkout <tag-o-commit-anterior>
docker compose down
docker compose build
docker compose up -d
# Restaurar backup DB si hubo migración fallida
```
