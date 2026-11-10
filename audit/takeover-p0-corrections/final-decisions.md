# Decisiones finales

Estado: `READY_FOR_PRODUCTION_ACTIVATION`.

No hay P0 ni P1 abiertos. No hubo commit, push ni deploy. Producción, `tea_bot`, el flag y `TWILIO_SIGNATURE_MODE` no se tocaron. La barrera de SQL TEST no se debilitó.

## Atención

`admin` y `conversations_only` toman conversaciones libres, responden las propias y las devuelven al bot. La toma activa deja un propietario. Nadie más modifica esa atención.

No hay cierre forzado. Si un administrador tiene que intervenir, reasigna con motivo. Esa operación queda auditada. Un operador no puede reasignar.

Con el flag apagado sigue el inbox compartido.

## Interfaz

Con permiso de toma, el aviso de “se habilitará al derivar a humano” no se muestra. En su lugar, la conversación puede tomarse manualmente y el campo de respuesta espera la confirmación del servidor. Después de tomar se ve `Atención humana` y el agente. El campo y `Cerrar y devolver al bot` dependen del permiso del detalle, no del rol pintado en el cliente. Un 409 o un evento sin permiso refresca el detalle.

## Identidad

Si `INTERNAL_AGENT_ID` hace coincidir al administrador y al operador, el proceso no arranca cuando la toma está activa. El mensaje no imprime el valor. Con el flag apagado el arranque no se corta.

## Validación

Backend 439/439, skipped 0. TB-006 preflight 5/5, sin aplicar 010. Frontend 241/241. Build exit 0.

Lint sigue en exit 1 por cuatro errores y cuatro warnings anteriores a este diff, ya presentes en `2ccaeb6`. No se reescribieron esos archivos.

## Activación y rollback

Sigue siendo un paso aparte. El código puede desplegarse con el flag apagado. Al encenderlo, el arranque exige identidades distintas. 009 sigue sin aplicar en `tea_bot`. El rollback de la función es volver el flag a false, sin dropear `status_version` ni `conversation_operation_requests`.

Riesgo residual conocido, fuera de este cierre: el mensaje de sistema de devolución se inserta después del commit. No cambia al dueño ni rearma la reentrada.
