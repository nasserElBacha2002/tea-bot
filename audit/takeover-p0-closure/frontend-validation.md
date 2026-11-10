# Validación de frontend

## Implementado

- `bot` sin permiso o con el flag apagado: aviso naranja `Bot activo · La respuesta manual se habilitará al derivar a humano.` Sin composer y sin botón de toma.
- `bot` con `canTakeover`: aviso informativo, botón `Tomar conversación`, composer oculto hasta que la API confirma.
- `assigned` y `paused`: badge `Atención humana`. El filtro de la lista sigue diciendo `Asignadas` y `Pausadas`.
- Durante la atención del dueño: texto de atención, nombre del agente si la cuenta lo resuelve, campo de respuesta y `Cerrar y devolver al bot`.
- Ese cierre no se muestra en `bot` ni en `closed`. Sí se muestra en `waiting_human`, `assigned` y `paused`.
- Otro agente, con la toma activa, no ve el composer. Con `takeoverBlock=disabled` el inbox compartido sigue pudiendo responder.
- Un 409 de dueño, versión o solicitud vieja refresca el detalle. El mensaje de éxito solo se escribe si `mutateAsync` resolvió.
- El evento en vivo compara `assignedAgentId` con el agente de la sesión. Si coinciden, el bloqueo local es `already_owner`. Si la toma está apagada, se conserva `disabled`.

## Verificado con tests

`npm test` en `frontend`: 239 tests, 0 fallos. Cubren el composer, el detalle, el evento en vivo del dueño, del otro agente y del inbox compartido.

`npm run build`: `tsc -b` y Vite terminaron en exit 0.

## Verificado con SQL real

No aplica al render. El detalle consume `canTakeover`, `takeoverBlock` y `assignedAgentLabel`, que el backend arma con `describeTakeoverAccess` y las cuentas configuradas.

## Pendiente

No se abrió el panel en un navegador contra un backend con el flag encendido. Los tests de componentes cubren los estados, no el click real contra Twilio.

## Lint

`npm run lint` sale 1 por cuatro errores y cuatro warnings que ya estaban en auth, el editor de nombre, la línea de tiempo y las dependencias de la página. No se corrigieron porque no forman parte del recorrido de toma.
