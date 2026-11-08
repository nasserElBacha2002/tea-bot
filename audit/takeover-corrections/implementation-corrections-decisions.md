# Correcciones de la toma manual

Estado: `IMPLEMENTED_PENDING_VALIDATION`

La barrera de respuesta automática y las reglas de ownership, idempotencia y esquema quedaron en el código. La exclusión entre dos transacciones SQL Server no se ejecutó: no hay una base cuyo nombre contenga `test`, y no se migró la base actual.

## Defectos corregidos

1. La autorización del bot y el insert del outbound ocurren en la misma transacción que bloquea la conversación. El commit termina antes de armar TwiML y antes de cualquier llamada a Twilio. `authorizeAutomaticReply` devuelve `ALLOW`, `SUPPRESS` o `INDETERMINATE`.

2. Una conversación con id persistido ya no se autoriza si SQL falla, la fila no está, la versión falta, la versión no coincide en tipo, o la toma está activa y `status_version` no está lista. `null` no se convierte en `0`.

3. Los caminos sin fila persistida quedaron explícitos: id que no es UUID (`unpersisted`) y base apagada (`persistence_disabled`). El simulador y los tests de pipeline que usan ids como `conv-e2e` siguen por esa regla.

4. `INDETERMINATE` no produce menú ni el texto de disculpa del webhook. La respuesta HTTP es TwiML vacío y el motivo queda en el log `automatic_reply_indeterminate`. El inbound ya guardado no se borra ni se duplica.

5. `requestHumanHandoff` no pisa una conversación cuyo estado bajo el lock ya no es `bot`. La confirmación de handoff se inserta en esa misma transacción. Si la toma ganó, no hay TwiML de confirmación.

6. Con la toma activa, `updateConversation` no incrementa `status_version` en silencio si la columna no existe: lanza `TAKEOVER_SCHEMA_REQUIRED`. Un resultado negativo del esquema no se cachea. Un positivo sí, hasta reiniciar el proceso.

7. Takeover y reasignación exigen `assertTakeoverSchema` cuando el flag está activo: `status_version` INT NOT NULL y la tabla `conversation_operation_requests`. Con el flag apagado no se exige el esquema y la toma responde `TAKEOVER_DISABLED`.

8. `sendAgentMessage`, con el flag activo, autoriza al dueño en una transacción corta, suelta el lock, llama a Twilio y recién después persiste. Si el dueño cambió antes del envío, no llama a Twilio. Si Twilio ya aceptó el mensaje, se guarda con `ownershipLostBeforePersist` y la API responde 409. No se cambia `assigned_agent_id`.

9. `clientRequestId` queda en `conversation_operation_requests` con unicidad `(conversation_id, operation, client_request_id)`, actor y hash de motivo y versión. Otro actor o los mismos datos distintos reciben `IDEMPOTENCY_CONFLICT`. El mismo actor, si ya no es dueño, recibe `IDEMPOTENCY_STALE` y no se aplica otra toma. El mismo actor repitiendo una toma que sigue suya no crea otro handoff ni otro mensaje.

10. El actor HTTP sale de `resolveEnabledPanelAgent`: usuario configurado, con hash de contraseña y rol de esa cuenta. El rol del token no se usa para tomar ni reasignar. Un usuario que no está configurado recibe 403. El destino de una reasignación tiene que ser una de esas cuentas habilitadas. La reasignación sigue exigiendo motivo y rol admin.

11. La etiqueta del inbox sale de `assignedAgentId` contra esas cuentas, no del último mensaje `manual_takeover`. Un evento de WebSocket sin `takeoverBlock` o sin etiqueta invalida el detalle. Hasta que vuelve la API, el composer no queda habilitado. Si el id del agente actual y el asignado difieren, y la toma no está en modo `disabled`, no hay textarea.

12. Si hay varios handoffs `pending` o `assigned`, la toma deja el más reciente como `assigned` y resuelve el resto con `superseded_by_manual_takeover`. No reabre filas ya resueltas.

## Hallazgos no confirmados

- No se consultó la base actual. No hay evidencia de que hoy existan handoffs activos duplicados.
- No se observó una aceptación real de Twilio en la ventana que queda después del commit. Esa ventana existe por diseño y no se midió en producción.
- `normalizeSessionRole` sigue tratando un token sin rol como admin en el resto del panel. La toma no hereda ese rol: vuelve a resolver el usuario contra la configuración. No se cambió el login, porque invalidaría sesiones existentes.
- El producto no tiene organizaciones ni equipos. El alcance real es un inbox compartido entre `ADMIN_USERNAME` y, si está configurado, `CONVERSATIONS_OPERATOR_USERNAME`.

## Garantías que las pruebas demostraron

- Dentro de una transacción, el insert del outbound solo ocurre si el lock ve `bot` y la misma versión entera.
- `SUPPRESS` e `INDETERMINATE` no insertan la respuesta automática.
- La idempotencia de la toma no entrega el resultado de un actor a otro ni repite una toma ya superada.
- Varios handoffs activos no quedan como varias asignaciones válidas.
- El mensaje de sistema de la toma no llama a Twilio.
- Devolver al bot después de una toma sigue armando la reentrada existente.
- El suite backend completo pasó, salvo las dos pruebas SQL que no llegaron a ejecutarse.
- Typecheck y build del frontend pasaron.

## Garantías que no quedaron demostradas

- Dos `UPDLOCK` concurrentes en SQL Server.
- La carrera entre el commit de la respuesta y el momento en que Twilio acepta el HTTP.
- Un envío REST interrumpido por una reasignación contra Twilio real.
- El preflight de la migración 009 contra una base real.
- El comportamiento después de reiniciar el proceso con la columna ya creada.

Un lock simulado con una cola de promesas no sustituye esas pruebas.

## Migración

`009_conversation_status_version.sql` agrega `status_version INT NOT NULL DEFAULT 0` y `conversation_operation_requests` con la unicidad de la solicitud. No se aplicó. El archivo se extendió antes de cualquier apply: no había checksum registrado en esta base.

Rollback de la función: `MANUAL_TAKEOVER_ENABLED=false` y reiniciar. No se dropea `status_version`, `reentry_json` ni la tabla de solicitudes. Las conversaciones que ya estén `assigned` siguen `assigned`.

Con el flag apagado, claim y envío conservan el inbox compartido anterior. Con el flag encendido, sin 009, la toma responde 503 `TAKEOVER_SCHEMA_REQUIRED` y el bot no autoriza una respuesta automática de una fila persistida.

## Versión de estado

Se incrementa en toma, reasignación, vuelta al bot y handoff a humano. Esas transiciones cambian quién atiende. Un mensaje, el cursor del flujo y el nombre del contacto no incrementan la versión.

## Riesgo que queda a propósito

Después del commit, el proceso escribe TwiML o ya recibió el SID de Twilio. Ese tramo no se puede deshacer sin sostener un lock durante la llamada externa, y eso está prohibido. Si la toma entra en ese intervalo, el cliente puede recibir la respuesta que ya fue autorizada. No se promete retirarla. El inbound queda guardado.

## Merge y despliegue

No está listo para merge ni para activar el flag. El paso que falta es una base SQL aislada, aplicar 009 ahí, y ver en verde las dos pruebas de integración que hoy hacen skip.
