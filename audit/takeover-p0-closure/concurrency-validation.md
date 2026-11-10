# Validación de concurrencia

## Política

Con el flag encendido hay un dueño. SQL es la autoridad. El frontend no decide el ganador.

## Verificado con SQL real

`integration: dos agentes en paralelo sobre SQL real` lanzó dos `takeover` distintos sobre la misma fila `bot`. Una promesa resolvió y la otra rechazó con `CONVERSATION_OWNED`. La fila quedó `assigned` al ganador. No hubo un segundo handoff activo.

`integration: toma manual exclusiva en SQL TEST` cubrió la repetición del mismo agente y el rechazo del segundo.

`integration: ensurePendingHandoff concurrente crea un solo handoff activo` y los rollbacks de handoff también pasaron en la misma suite.

Después de la suite no quedaron solicitudes de operación ni handoffs activos duplicados. Las filas históricas siguieron en `status_version=0` porque los tests borran sus conversaciones.

## Verificado con tests de dobles

Doble click del mismo actor, conflicto de versión, conversación cerrada, inexistente, sin permiso, handoff activo múltiple y el worker que pierde la carrera antes de insertar el outbound.

## Límite

El lock no se sostiene durante el POST a Twilio ni mientras se escribe el TwiML ya autorizado. Una toma que entra en ese intervalo no retira el mensaje que el proveedor ya aceptó. El inbound sí queda persistido y el siguiente turno ya no ejecuta el motor.

`MessageSid` evita reprocesar el mismo evento. No evita que un turno ya autorizado y una toma concurrente se crucen después del commit. Eso quedó medido en el guard, no contra Twilio real.

## Pendiente

Dos procesos Node distintos, no dos transacciones del mismo proceso, contra la base local. El lock es de SQL Server, así que el resultado no depende del proceso, pero no se levantaron dos backends.

## No aplicable

No se corrió esa carrera contra `tea_bot`.
