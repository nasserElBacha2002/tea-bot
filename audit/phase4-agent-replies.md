# Fase 4 — Respuestas manuales y corrección de persistencia

## Causa raíz del 503 en `GET /api/conversations`

El endpoint llamaba a `assertEnabled()`, que solo comprobaba `CONVERSATION_DB_ENABLED=true`. En desarrollo local, `.env` tenía las variables `DB_*` pero el flag **no estaba activado** (comentado en `.env.example`), por lo que el servicio devolvía 503 aunque SQL Server pudiera estar disponible.

### Corrección

1. **`isConversationDbEnabled()`** (`connection-config.js`): si el flag no está en `false`, se habilita automáticamente cuando `DB_SERVER`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` están completos.
2. **`ensureConversationDbReady()`** (`conversation-db-health.js`): valida env, hace **ping** a la base y devuelve error estructurado:
   - `error`: `CONVERSATION_PERSISTENCE_UNAVAILABLE`
   - `message`: texto en español (sin secretos)
   - `details.cause`: `DB_CONNECTION_FAILED` | `DB_ENV_MISSING` | `CONVERSATION_DB_DISABLED`
3. Respuesta **200** con lista vacía cuando la DB responde y no hay filas (no 503).

### Qué hacer en local

En `whatsapp-bot/.env`:

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

Luego: `npm run db:migrate` y levantar SQL Server (`docker compose up sqlserver` o contenedor local).

---

## Respuestas manuales (agente)

### Endpoints nuevos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/conversations/:id/claim` | Toma conversación `waiting_human` |
| `POST` | `/api/conversations/:id/messages` | Envía mensaje agente (+ Twilio si aplica) |
| `POST` | `/api/conversations/:id/close` | Cierra conversación y resuelve handoff |
| `POST` | `/api/conversations/:id/return-to-bot` | Devuelve a `bot` |

### Flujo de envío

1. Valida cuerpo no vacío.
2. Si `waiting_human` → auto-claim al agente actual.
3. Si `bot` o `closed` → 409.
4. WhatsApp/Twilio: `TwilioWhatsAppService.sendWhatsAppMessage` → mismo número (`TWILIO_WHATSAPP_FROM`).
5. Persiste mensaje `outbound` / `sender_type=agent`.
6. Actualiza conversación a `assigned` y `last_message_at`.

**No** se invoca FlowEngine en envíos manuales.

### Agente asignado (temporal)

No hay tabla de usuarios. `assigned_agent_id` se deriva de un UUID estable desde el usuario admin de la cookie (`resolveAgentIdFromRequest`), o `INTERNAL_AGENT_ID` en env si se define.

### Twilio — variables requeridas

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` (ej. `whatsapp:+14155238886`)

### Frontend

- Alerta de persistencia con **Reintentar**
- **Tomar conversación**, composer **Enviar**, **Cerrar**, **Devolver al bot**
- Errores normalizados en `utils/apiError.ts`

---

## Cómo probar en local

1. SQL Server + migraciones + `.env` con DB y Twilio.
2. Login admin → `/conversations`.
3. Conversación `waiting_human` → **Tomar conversación** → escribir mensaje → **Enviar**.
4. Verificar mensaje en WhatsApp del usuario y fila en `conversation_messages` (`sender_type=agent`).
5. **Cerrar conversación** → status `closed`.

---

## Fase 5 (preview)

Migración de flujos JSON a tablas `flows` / `flow_versions` / snapshots en DB con feature flag.

## Limitaciones

- Sin WebSockets (refetch manual).
- Sin transferencia entre agentes.
- Sin adjuntos/media en composer.
- `INTERNAL_AGENT_ID` opcional para fijar agente en pruebas.
