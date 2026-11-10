# Validación de backend

## Implementado

- Toma atómica de `bot`, cola, `paused` y `assigned` sin dueño.
- Exclusividad con `UPDLOCK` y `CONVERSATION_OWNED` para el otro agente.
- Idempotencia por `clientRequestId`, actor y hash. El mismo dueño no repite efectos.
- `status_version` sube en la toma, la reasignación, el handoff y la vuelta al bot.
- Inbound en `waiting_human`, `assigned` y `paused` persiste el mensaje y no corre el FlowEngine.
- El guard suprime el outbound si la versión o el estado cambiaron antes del commit.
- Cerrar y devolver resuelven el handoff, sueltan la asignación y arman la reentrada sin pisar una pendiente.
- Claim, envío, cierre y devolución exigen una cuenta de panel habilitada.

## Verificado con tests

Suite completa: 428 pass, 0 fail, 0 skipped, con `TB_SQL_TEST_CONFIRM=tea-bot`.

Incluye los tests de dobles de toma (bot, dueño, cerrado, inexistente, versión, sin permiso, doble click, handoff activo, reasignación) y el guard de la carrera que commitea antes del lock.

## Verificado con SQL real

- Toma exclusiva y repetición del mismo `clientRequestId`.
- Dos agentes en paralelo: una sola escritura gana y la otra recibe `CONVERSATION_OWNED`.
- Reentrada, doble cierre, rollback de handoff, handoff concurrente y conversación asignada que no ejecuta el menú.
- TB-005: firma válida e inválida, modos log y enforce, contra esta base.
- TB-006: la suite de idempotencia del inbound corrió en el mismo comando y no quedó skipped.

## Pendiente

- Activar el flag en un proceso y repetir la toma con dos operadores reales.
- Medir una aceptación real de Twilio en la ventana posterior al commit.

## Bloqueado

Nada de la validación local. La base productiva no se usó.

## No aplicable

No se creó una base `tea_bot_test_*`. La base autorizada era `tea-bot`.
