# Fase 1 — Persistencia de conversaciones en SQL Server

## Qué se agregó

- **Migración SQL:** `migrations/001_conversations_phase1.sql` (tablas `conversations`, `conversation_messages`, `conversation_sessions`).
- **Conexión:** `src/db/connection-config.js` + `src/db/index.js` (`mssql`, pool).
- **Migraciones:** `npm run db:migrate` → `src/db/migrate.js`.
- **Repositorios y servicios** sin cambios de contrato hacia el webhook.
- **Integración Twilio** sin modificar `FlowEngine` ni flujos JSON.

## Conexión por variables de entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `CONVERSATION_DB_ENABLED` | Activa persistencia | `true` |
| `DB_SERVER` | Host SQL Server | `localhost` o `sqlserver` (Docker) |
| `DB_PORT` | Puerto | `1433` |
| `DB_NAME` | **Nombre de la base** | `tea_bot` |
| `DB_USER` | Usuario | `sa` (dev) o usuario de app |
| `DB_PASSWORD` | Contraseña | (cumplir política de SQL Server) |
| `DB_ENCRYPT` | TLS | `false` local, `true` en Azure |
| `DB_TRUST_SERVER_CERTIFICATE` | Cert autofirmado | `true` en dev |

No se usa `DATABASE_URL` en código; todo sale de estas variables.

## Qué no se cambió

- Motor de flujos JSON (`flow-loader`, `flow-engine`, `flow.repository`).
- `data/sessions.json` para el runtime en memoria.
- Simulador, Meta webhook, editor.

## Migraciones

```bash
cd whatsapp-bot
npm install

export CONVERSATION_DB_ENABLED=true
export DB_SERVER=localhost
export DB_PORT=1433
export DB_NAME=tea_bot
export DB_USER=sa
export DB_PASSWORD='TeaBot_Dev_Passw0rd!'

npm run db:migrate
```

Con Docker (desde la raíz):

```bash
docker compose up -d sqlserver
# Crear la base tea_bot si no existe (primera vez):
# docker exec -it tea-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '...' -C -Q "CREATE DATABASE tea_bot"
docker compose run --rm whatsapp-bot npm run db:migrate
```

## Verificación Twilio

1. Variables en `.env` y reinicio del bot.
2. Mensaje al webhook `POST /webhooks/twilio/main-menu`.
3. Consulta:

```sql
SELECT TOP 5 id, phone_number, status, current_node_key, last_message_at
FROM dbo.conversations
ORDER BY updated_at DESC;

SELECT direction, sender_type, LEFT(body, 80) AS body, created_at
FROM dbo.conversation_messages
WHERE conversation_id = '<uuid>'
ORDER BY created_at;
```

## Limitaciones (fases futuras)

- Sin bandeja humana ni respuestas de agente.
- Simulador aún no persiste en DB.
- Sin tablas de flujos en SQL Server.
