# Plan de activación productiva

Este documento no autoriza ejecutarlo. Producción no se modificó.

Último estado escrito del VPS, en `audit/tb-005-006-deploy`: host `170.239.85.196`, SSH `37783`, usuario `nasser`, proyecto `/home/nasser/tea-bot`, base `tea_bot`, SHA `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`, `TWILIO_SIGNATURE_MODE=log`, `MANUAL_TAKEOVER_ENABLED=false`, migración 010 aplicada, 009 ausente, `main-menu` v62. Esta sesión no reabrió esa máquina.

## Condiciones antes de empezar

1. El diff de esta entrega está revisado y commiteado. Hoy sigue sin commit, encima de `2ccaeb6`.
2. El único archivo pendiente en `schema_migrations` de `tea_bot` es `009_conversation_status_version.sql`. Si aparece otro, se aborta. El runner general aplicaría todo lo pendiente.
3. `TWILIO_SIGNATURE_MODE` permanece `log`. No se pasa a `enforce` en esta activación.
4. Hay dos cuentas de panel distintas y `INTERNAL_AGENT_ID` no está definido. Si lo está, las dos cuentas son el mismo dueño y la prueba de exclusión no sirve.

## Orden

1. Backup `BACKUP DATABASE [tea_bot] TO DISK = ... WITH COPY_ONLY, CHECKSUM, COMPRESSION`.
2. `RESTORE VERIFYONLY ... WITH CHECKSUM`.
3. Leer columnas, conteos y el historial de migraciones. Confirmar que 001 a 008 y 010 están aplicadas y 009 no.
4. Aplicar solo 009 con el runner, que registra checksum y `success`. No editar migraciones ya aplicadas. No dropear nada.
5. Verificar `status_version INT NOT NULL`, default 0, filas históricas en 0, tabla `conversation_operation_requests` y su unicidad. Conteos de negocio iguales al backup.
6. Desplegar backend y frontend de este cambio con `MANUAL_TAKEOVER_ENABLED=false`. El bot tiene que seguir respondiendo en `bot`.
7. Recién después, `MANUAL_TAKEOVER_ENABLED=true` y reinicio del backend.
8. Con dos operadores: uno toma una conversación `bot`, el otro recibe conflicto, el primero responde, un mensaje entrante no dispara el menú, y `Cerrar y devolver al bot` arma la reentrada.
9. Mirar errores `automatic_reply_indeterminate`, `TAKEOVER_SCHEMA_REQUIRED` y handoffs activos duplicados.

## Compatibilidad

Código actual con la columna nueva y el flag apagado: el `INSERT` no lista `status_version` y el default cubre la fila. El bot no exige la columna.

Código nuevo con el flag apagado y sin 009: la toma responde desactivada y el bot sigue.

Código nuevo con el flag encendido y sin 009: toma 503 y el bot no autoriza respuestas de filas persistidas. Ese orden está prohibido.

## Rollback de la función

`MANUAL_TAKEOVER_ENABLED=false` y reiniciar. No se dropea `status_version` ni la tabla de solicitudes. Lo que ya quedó `assigned` sigue `assigned`.

El rollback del binario está en `rollback-plan.md`.
