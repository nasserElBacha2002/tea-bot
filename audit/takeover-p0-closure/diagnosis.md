# Diagnóstico — toma manual TB-002, TB-003, TB-004

Estado de esta entrega: `READY_FOR_REVIEW`.

SHA de trabajo: `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`, igual al último SHA productivo confirmado en `audit/tb-005-006-deploy`. No hubo commit, push ni deploy. Esta sesión no volvió a consultar el VPS.

## Recorrido real

1. El panel llama `POST /api/conversations/:id/takeover` con `expectedVersion` y un `clientRequestId` nuevo por click.
2. `requireAuth` exige cookie firmada. El controlador ahora exige además una cuenta de panel habilitada (`actorFromAdminUser` + `canTakeoverConversation`). Admin y operador de conversaciones pasan. Un rol desconocido no hereda el permiso.
3. Con `MANUAL_TAKEOVER_ENABLED` apagado, el servicio responde `TAKEOVER_DISABLED` y no escribe.
4. Con el flag encendido, `ConversationTakeoverService.takeover` abre una transacción, toma `UPDLOCK, ROWLOCK` y:
   - rechaza cerrada, versión distinta, otro dueño y un `clientRequestId` reutilizado con otro actor o con otros datos;
   - si el mismo agente ya es dueño, no crea otro handoff ni otro mensaje;
   - si el estado es `bot`, `waiting_human`, `paused` o `assigned` sin dueño, deja un solo handoff activo `assigned`, pausa sesiones abiertas, pone `status=assigned`, graba `assigned_agent_id`, incrementa `status_version` y escribe el mensaje de sistema `manual_takeover`.
5. Después del commit se resetea la sesión de runtime y se publica `conversation.assigned`. El payload lleva `assignedAgentId` y la etiqueta del agente. `canTakeover` no viaja en el broadcast porque depende de quién mira.
6. El cliente no muestra éxito hasta que esa llamada resuelve. Un 409 de dueño, versión o idempotencia vieja refresca el detalle.
7. El inbound de Twilio, después de TB-005 y TB-006, persiste el mensaje. Si el estado ya es `waiting_human`, `assigned` o `paused`, no entra al FlowEngine. Si el worker leyó `bot` y la toma ganó antes de autorizar la respuesta, `authorizeAutomaticReply` bloquea la fila y no inserta el outbound si el estado ya no es `bot` o si `status_version` cambió.
8. `POST /:id/close` y `POST /:id/return-to-bot` siguen siendo el mismo retorno al bot. Resuelven handoffs activos, cierran sesiones abiertas, limpian la asignación, dejan `status=bot`, incrementan `status_version` y arman `reentry_json` si la política es `prompt` y se vuelve de atención humana. No pisan una reentrada `pending` o `awaiting_choice`.
9. El siguiente inbound con reentrada pendiente ofrece continuar o empezar de nuevo. El mismo `MessageSid` no consume la elección dos veces.

## Qué ya estaba y se conservó

- Implementado y cubierto por tests de dobles: toma, reasignación, idempotencia, esquema obligatorio con el flag activo, fencing del outbound, reentrada.
- Implementado en la UI previa: botón Tomar cuando `canTakeover` es verdadero, composer cerrado hasta la confirmación, inbox compartido cuando el bloqueo es `disabled`.
- Semántica que no se cambió: con el flag apagado la toma de un `bot` sigue en `CONVERSATION_BOT_ACTIVE`. Con el flag encendido la asignación es exclusiva. No se inventó un inbox compartido nuevo ni se impuso exclusividad al camino apagado.

## Qué estaba apagado o incompleto

- `MANUAL_TAKEOVER_ENABLED` sigue apagado. Sin el flag, el botón de toma no aparece y el aviso sigue siendo `Bot activo · La respuesta manual se habilitará al derivar a humano.`
- La migración 009 no estaba aplicada en `tea-bot`. Las dos pruebas SQL de exclusión hacían skip. Quedó aplicada y esas pruebas pasaron.
- El encabezado ofrecía `Cerrar y devolver al bot` también con el bot activo.
- El badge de una conversación `assigned` decía `Asignadas`, la etiqueta de filtro.
- Un evento en vivo sin `takeoverBlock` marcaba al propio agente como `owned_by_other`.
- SQL Server devuelve el `uniqueidentifier` en mayúsculas. El id del agente se genera en minúsculas. La comparación estricta del frontend podía tratar al dueño como otro agente. La lectura ahora canonicaliza el id y la UI compara sin distinguir mayúsculas.
- `paused` se trataba como atención humana en la toma y no en el inbound. Ese estado ahora también salta el FlowEngine.
- Tomar, responder, cerrar y devolver exigían sesión, pero responder y devolver no exigían una cuenta de panel habilitada. Ahora sí.

## Qué no se reescribió

`claimConversation`, `ConversationTakeoverService`, el fencing de `authorizeAutomaticReply`, TB-005, TB-006 y el armado de `reentry_json` se dejaron como estaban, salvo los puntos de arriba.
