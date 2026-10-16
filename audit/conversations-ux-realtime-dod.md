# DoD — Conversaciones: UX operativa + tiempo real

**Fecha:** 2026-05-22  
**Estados:** `CONVERSATIONS_UX_SIMPLIFIED` · `CONVERSATIONS_REALTIME_READY_WITH_SAFE_LIFECYCLE`

---

## Cambios de UX

### Panel de detalle

- Header simple: título, subtítulo (canal · proveedor · estado · hora), motivo humano, asignación amigable.
- Acciones: **Tomar conversación**, **Cerrar**, **Devolver al bot** (sin bloque técnico visible).
- **Detalles técnicos** (acordeón cerrado por defecto): flowId, versión, nodo, agentId, sesión, IDs, timestamps.

### Lista lateral

- Título + badge de estado + último mensaje + hora · canal.
- Resaltado y punto si hay mensaje nuevo (no leído).
- Menos chips (sin provider duplicado).

### Indicador realtime

- Chip: En vivo / Reconectando… / Actualización manual / Sin conexión.

---

## Tiempo real (WebSocket)

| Item | Valor |
|------|--------|
| Ruta | `ws://<host>/api/conversations/live` |
| Auth | Cookie `tea_session` (misma sesión que REST) |
| Heartbeat | Ping/pong cada 30s |
| Cleanup | Cierre en unmount + código 1000 |

### Eventos emitidos

- `conversation.created`
- `conversation.updated`
- `conversation.message.created`
- `conversation.assigned` (+ `updated`)
- `conversation.closed` (+ `updated`)
- `conversation.returned_to_bot` (+ `updated`)
- `connected` (handshake)

Emisión desde persistencia (inbox + conversation.service + human-handoff), sin duplicar lógica de DB.

### Frontend

- Hook `useConversationsLiveUpdates` — solo activo en `ConversationsPage` montada.
- Reconexión con backoff (1s → 30s máx).
- Sin reconexión tras unmount o cierre auth.
- TanStack Query: patch de lista/detalle/mensajes + deduplicación por `messageId`.
- Botón **Actualizar** sigue como fallback (`markManual`).

### Dev proxy

- Vite proxy `/api` con `ws: true` para cookies same-origin en desarrollo.
- `resolveApiOrigin()` usa `window.location.origin` si no hay `VITE_API_BASE_URL`.

---

## Auth

- `GET /api/auth/me` y login devuelven `user.agentId` (hash estable del username).

---

## Tests

```bash
cd whatsapp-bot && npm test
cd frontend && npm test
```

Backend: `conversation-live.broadcaster.test.js`  
Frontend: `applyConversationLiveEvent.test.ts`, `useConversationsLiveUpdates.test.ts`, `conversationDisplay.test.ts`, `ConversationsPage.test.tsx` (actualizado)

---

## Riesgos pendientes

- Cross-origin sin proxy: WebSocket puede no enviar cookie; usar proxy Vite o mismo dominio en prod.
- Test E2E WebSocket completo no automatizado (solo broadcaster unitario).
- Roles multi-tenant: broadcast global admin (sin filtro por agente aún).

---

## Validación manual

1. `/conversations` — sin flujo/versión/nodo/UUID en header.
2. Expandir **Detalles técnicos** — datos disponibles.
3. Simulador/nuevo mensaje — aparece sin Actualizar.
4. Navegar a `/flows` — WS cerrado (devtools / logs dev).
5. Volver a `/conversations` — nueva conexión.
