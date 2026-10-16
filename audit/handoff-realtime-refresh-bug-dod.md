# DoD: Handoff realtime — Tomar conversación sin refresh

**Estado final:** `HANDOFF_REALTIME_TAKE_CONVERSATION_FIXED`

| Hito | Estado |
|------|--------|
| `HANDOFF_STATUS_REALTIME_EMITTED` | ✅ |
| `HANDOFF_CONVERSATION_TAKABLE_WITHOUT_REFRESH` | ✅ (fix + tests) |
| `CONVERSATIONS_CACHE_HANDOFF_UPDATE_FIXED` | ✅ |

## Causa raíz

`conversation.updated` llegaba al WebSocket, pero el frontend **pisaba** campos de inbox (`lastMessage`, `humanHandoff`) con `null` en merges parciales y no consolidaba bien el paso a `waiting_human` en cache de detalle/lista.

## Cambios backend

- Una sola emisión `conversation.updated` al handoff, con `humanHandoff` en extras (`requestHumanHandoff`).
- Mensaje bot de confirmación Twilio incluye `humanHandoff` en `conversation.message.created` (`context.handoff`).

## Cambios frontend

- `mergeInboxListItem`: preserva `lastMessage` y `humanHandoff` previos si el evento no los trae.
- Manejo explícito de `conversation.updated` / `conversation.assigned` sin summary → invalidación.
- Detalle: merge de `humanHandoff`; invalidación si handoff y detalle aún no cargado.
- Handoff fuera de selección: `handoffConversationId` + unread; callback `onHandoffWaiting` en página (filtros / destacado).

## Tests ejecutados

```bash
cd whatsapp-bot && npm test
cd frontend && npm test -- --run
```

- Backend: `human-handoff.service.test.js` — broadcast `conversation.updated` con `waiting_human` + `humanHandoff`.
- Frontend: `applyConversationLiveEvent.test.ts` — handoff en lista/detalle, unread, invalidación, no duplicados.

## Validación manual (pendiente en entorno del operador)

1. Twilio: flujo hasta humano con `/conversations` abierto → Tomar sin F5.
2. Simulador: “humano” → aparece y se puede tomar sin refresh.
3. REST fallback: cerrar `/conversations`, reabrir → estado tomable.
4. Filtros: aviso “fuera de filtros” si aplica.

## Riesgos pendientes

- Orden de eventos muy rápidos: mitigado con merge conservador; REST/refetch sigue como fallback.
- Filtro servidor que excluye `waiting_human`: la conversación puede seguir en cache de lista anterior hasta invalidar; el aviso de filtros cubre el caso visible.
