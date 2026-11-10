# Plan de rollback

No se ejecutó contra producción.

## Local

El backup previo a 009 es:

`/var/opt/mssql/backup/tea-bot_pre009_20261110T181500Z.bak`

3129344 bytes. `RESTORE VERIFYONLY WITH CHECKSUM` pasó. Restaurar esa copia pisa la base local completa, no solo la columna. No hace falta para apagar la función: borrar `MANUAL_TAKEOVER_ENABLED` o dejarlo en `false` y reiniciar el proceso local.

No se dropea `status_version` ni `conversation_operation_requests`. Las 15 conversaciones históricas quedaron en versión 0.

## Producción, cuando se active

1. Imagen anterior del backend y del frontend, la que corresponde al SHA `2ccaeb6` mientras este cambio no esté desplegado. Confirmar el tag antes de borrar la imagen nueva.
2. `MANUAL_TAKEOVER_ENABLED=false` en el entorno del contenedor `tea-whatsapp-bot` y recrear solo ese servicio si el binario nuevo puede convivir con el flag apagado.
3. Si el binario nuevo es el problema, volver a la imagen anterior. Esa imagen tolera la columna 009 con el flag apagado.
4. No ejecutar `DROP COLUMN status_version` ni `DROP TABLE conversation_operation_requests`.
5. No volver a `TWILIO_SIGNATURE_MODE=enforce`. Dejar `log`.
6. No restaurar `tea_bot` salvo corrupción. El backup `COPY_ONLY` de la activación es la copia. Una restauración completa pierde lo escrito después del backup.
7. Conversaciones que hayan pasado a `assigned` durante la prueba siguen `assigned` al apagar el flag. Devolverlas al bot es una acción explícita del panel, no un efecto del rollback.

## Criterio para volver

`TAKEOVER_SCHEMA_REQUIRED` en el webhook, respuestas automáticas detenidas en conversaciones `bot`, o una toma que pisa `assigned_agent_id` de otro agente. Ese último caso no apareció en la prueba SQL local.
