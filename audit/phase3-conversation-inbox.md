# Fase 3 — Inbox interno de conversaciones

## Qué se agregó

### Backend (`whatsapp-bot`)

- **Rutas** (protegidas con `requireAuth`, montadas en `/api/conversations`):
  - `GET /api/conversations` — listado paginado con filtros
  - `GET /api/conversations/:conversationId` — detalle + sesión abierta + handoff
  - `GET /api/conversations/:conversationId/messages` — historial paginado
- **Servicio:** `ConversationInboxService` (`src/services/conversation-inbox.service.js`)
- **Mapper API:** `src/utils/conversation-inbox.mapper.js` (camelCase, sin `rawPayload` en listado)
- **Repos extendidos:** `listConversations`, `countConversations`, `getLastMessageByConversationIds`, `listLatestByConversationIds`, `findLatestOpenByConversationId`, mensajes con `offset`/`order`

**No se implementó** `POST .../claim` (Fase 4): no hay tabla de agentes ni IDs de empleado; solo login admin por cookie.

### Frontend (`frontend`)

- Ruta **`/conversations`** con panel lista + detalle + timeline
- Nav **Conversaciones** en `AppShell`
- Módulo `features/conversations/` (API, hooks, componentes, página)
- Composer deshabilitado con texto de Fase 4

## Cómo probar con conversaciones Twilio existentes

1. Backend con DB activa: `CONVERSATION_DB_ENABLED=true`, migraciones aplicadas (`npm run db:migrate`).
2. Generar tráfico WhatsApp (handoff + mensajes en espera) o usar filas ya persistidas.
3. Iniciar API y frontend; iniciar sesión admin (`/login`).
4. Abrir **http://localhost:5173/conversations** (o la URL del frontend).
5. Filtrar por **Esperando humano** y abrir una fila: deben verse mensajes con `botSkipped` en metadata (detalle vía API, no mostrado en UI por defecto).
6. **Actualizar** recarga listado y, si hay selección, detalle y mensajes.

### Ejemplos API (cookie de sesión)

```bash
curl -b cookies.txt 'http://localhost:3000/api/conversations?status=waiting_human&limit=25'
curl -b cookies.txt 'http://localhost:3000/api/conversations/{id}'
curl -b cookies.txt 'http://localhost:3000/api/conversations/{id}/messages?order=asc'
```

## Dejado para Fase 4

- Reclamar/asignar conversación (`POST /claim`) con agente real
- Enviar respuestas manuales por Twilio
- Cerrar conversación / volver a bot
- WebSockets / tiempo real
- Notas internas, tags, analytics

## Limitaciones conocidas

- Sin paginación UI en el listado (API soporta `limit`/`offset`; frontend fija `limit: 50`).
- Búsqueda por texto en mensajes puede ser lenta sin índice full-text (aceptable en volumen bajo).
- `paused` como estado de **conversación** solo filtra si existe en DB; la pausa operativa suele estar en `conversation_sessions.status = paused` con `conversations.status = waiting_human`.
- Sin render de adjuntos/media si Twilio no persistió cuerpo en `body`.
- Un solo usuario admin; no hay permisos por rol.

## Tests

- Backend: `src/services/conversation-inbox.service.test.js`
- Frontend: Vitest en labels, timeline y `ConversationsPage`
