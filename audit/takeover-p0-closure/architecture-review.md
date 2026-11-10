# Revisión de arquitectura

La toma no agrega otro pipeline. El inbound sigue siendo firma, adquisición SQL del evento, persistencia y, solo si el estado lo permite, FlowEngine. La toma es una transición de la misma fila, bajo el mismo lock que usa el guard de respuesta automática.

## Modelo de asignación

Con el flag apagado el producto sigue en inbox compartido: cualquier operador habilitado responde una conversación ya derivada y el bot no se toma desde `bot`.

Con el flag encendido la fila tiene un dueño. `assigned_agent_id` más estado `assigned` o `paused` es la propiedad. Otra cuenta recibe `CONVERSATION_OWNED`. El mismo dueño que repite la operación no duplica handoff ni mensaje. La reasignación sigue siendo otra operación, solo admin, con motivo, y no reutiliza la toma.

No hay organizaciones ni equipos. Las cuentas reales siguen siendo `ADMIN_USERNAME` y, si está configurado, `CONVERSATIONS_OPERATOR_USERNAME`.

## Concurrencia

La exclusión no está en el botón. `findByIdForUpdate` pide `UPDLOCK, ROWLOCK`. La versión sube solo en las transiciones de quién atiende: toma, reasignación, handoff a humano y vuelta al bot. Un mensaje, el cursor y el nombre no la incrementan.

`authorizeAutomaticReply` decide y, si corresponde, inserta el outbound dentro de esa transacción. El commit termina antes de armar TwiML y antes de llamar a Twilio. Si la toma ya commiteó, el worker ve otro estado u otra versión y no inserta la respuesta automática.

Límite que no se puede cerrar sin sostener el lock durante la llamada externa: si Twilio ya aceptó el HTTP o el proceso ya está escribiendo el TwiML autorizado, esa respuesta puede llegar al cliente. El inbound queda guardado. No se promete cancelarla.

## Reentrada

La vuelta al bot y el consumo de `reentry_json` siguen en `ConversationBotLifecycleService` y `conversation-reentry.service.js`. Una reentrada `pending` o `awaiting_choice` no se reemplaza. El sync del cursor del motor exige `reentry_json IS NULL` y `status=bot`.

El mensaje de sistema de la vuelta se inserta después del commit de la transición. Si ese insert falla, el estado ya es `bot` y falta el texto de sistema. No cambia el cursor ni la reentrada.

## Compatibilidad del esquema

`009` agrega `status_version INT NOT NULL DEFAULT 0` y `conversation_operation_requests`. El `INSERT` de conversaciones lista columnas y omite la versión, así que el default cubre el código anterior. Con el flag apagado, la ausencia de la columna no bloquea el bot. Con el flag encendido, toma y reasignación exigen la columna `INT NOT NULL` y la tabla de solicitudes.

## Identidad

`agentsMatch` ya comparaba en minúsculas. El driver devolvía el UUID en mayúsculas. La lectura de `assigned_agent_id` ahora lo devuelve en minúsculas, igual que `resolveAgentIdFromUsername`. Si `INTERNAL_AGENT_ID` está definido, admin y operador siguen siendo el mismo dueño. Esa variable no está en el `.env` local. En el proceso productivo no se releyó en esta sesión.
