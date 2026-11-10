# Rollback

No se ejecutó. La versión nueva arrancó y procesó ingresos reales.

## Imagen anterior

`tea-whatsapp-bot:rollback-9b2ff0be7105`

Digest `sha256:8a95d51f9fe842b1eecf2c28fc940285413b5a3039e7ae1a77e29251c03977ec`, el mismo que estaba en producción el 2026-11-05. El checkout anterior es `9b2ff0be71058a11713b97146a20f683b631eda5`.

Para volver el proceso, sin borrar volúmenes:

1. Restaurar `APP_BASE_URL` y quitar `TWILIO_SIGNATURE_MODE` desde `.env.before-tb005-log` si el incidente es de firma.
2. `docker tag tea-whatsapp-bot:rollback-9b2ff0be7105 tea-whatsapp-bot:local`
3. `docker compose up -d --no-deps --force-recreate whatsapp-bot`

## Esquema

La 010 solo agrega `response_body` nullable. El binario anterior no la lee. No hace falta restaurar el backup para volver la aplicación. No se dropea la columna. El backup verificado queda como recuperación de emergencia, no como el camino habitual.

009 no está aplicada. Takeover sigue en `false`.

## Firma

`log` no se apaga desactivando la idempotencia. Si las firmas válidas se registran como inválidas, se corrige `APP_BASE_URL` o el prefijo y se reinicia. `enforce` no forma parte de la contingencia.
