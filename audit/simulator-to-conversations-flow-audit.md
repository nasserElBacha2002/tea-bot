# Auditoría: Simulador → Conversaciones

**Fecha:** 2026-05-22  
**Estado:** `SIMULATOR_CONVERSATION_FLOW_AUDITED`

---

## 1. Endpoint del simulador

| Método | Ruta | Auth |
|--------|------|------|
| POST | `/api/simulator/start` | `requireAuth` (cookie) |
| POST | `/api/simulator/message` | idem |
| POST | `/api/simulator/reset` | idem |

Frontend: `simulatorApi` → `useConversationSimulator` en el editor (`Probar conversación`).

Dev adicional: `POST /api/dev/conversations/inbound-message` (no producción salvo `DEV_TOOLS_ENABLED=true`).

---

## 2. Servicio que procesa mensajes

- **Antes:** `simulator.service.js` → solo `flowEngine` + `sessionService` (memoria). **Sin DB ni WebSocket.**
- **Después:** mismo motor + `simulator-persistence.service.js` (repositorios + notify realtime).

---

## 3. ¿Usa FlowEngine real?

**Sí.** `flowEngine.resolveIncomingMessage` con `userId = simulator:<sessionId>`.

---

## 4–6. ¿Crea conversation / messages en DB?

| Antes | Después |
|-------|---------|
| No | Sí, vía `conversationRepository` y `conversationMessageRepository` |

---

## 7–8. Canal y provider

- `channel`: **simulator**
- `provider`: **internal**
- `external_user_id`: **simulator:{sessionId}**

---

## 9. Status

- Inicio: **bot**
- Tras `human_handoff`: **waiting_human** (+ registro en `human_handoffs`)
- Reinicio: conversación anterior **closed**; nueva sesión → nueva fila

---

## 10. ¿Emite WebSocket?

| Antes | Después |
|-------|---------|
| No | `conversation.created`, `conversation.message.created`, `conversation.updated`, `conversation.closed` |

---

## 11. ¿`/conversations` filtra el canal?

**No excluye simulator por defecto.** Filtros opcionales por `status` / `channel` en query. Lista vacía por defecto solo si no hay filas en DB.

---

## 12. Dónde se perdía la conversación (causa raíz)

El simulador **nunca escribía en SQL Server**. La bandeja y el WebSocket solo observan persistencia real; por eso ni **Actualizar** ni **En vivo** mostraban la prueba.

---

## Diagrama (después del fix)

```
Editor → POST /api/simulator/message
       → FlowEngine (memoria)
       → simulator-persistence.service
       → DB (conversations + messages + sessions + handoffs)
       → conversation-live.notify → WebSocket
       → useConversationsLiveUpdates → TanStack cache
```

---

## Reinicio de prueba

1. `POST /api/simulator/reset` cierra la conversación DB (`status: closed`).
2. Frontend genera **nuevo** `sessionId` (`sim-{flowId}-{timestamp}`).
3. `POST /api/simulator/start` crea **nueva** conversación (nuevo `external_user_id`).
