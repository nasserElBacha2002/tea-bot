# Twilio y Nginx

Nginx de Tea Bot no se modificó. `bot.dinamiceducation.com` escucha 443 y hace `proxy_pass http://127.0.0.1:3000` en `location /`. La ruta pública se conserva. No hay prefijo que quitar. `TWILIO_PUBLIC_PATH_PREFIX` quedó ausente.

## URL real del inbound

El sender de WhatsApp que está `ONLINE` tiene:

`webhook.callback_url=https://bot.dinamiceducation.com/webhooks/twilio/main-menu`

Esa URL es el origen configurado más la ruta que Express recibe. Hay otro sender `OFFLINE` con un callback de demostración en `twil.io`. No es el canal en uso.

## Status callback

En el sender en línea, `status_callback_url` está vacío. El servicio de mensajería tampoco tiene `status_callback` ni `inbound_request_url`. El envío del bot no agrega `StatusCallback`. Twilio no tiene una URL de estado configurada para este canal.

El código nuevo exige firma en `POST /webhooks/twilio/:flowId/status` en todos los modos. Con `APP_BASE_URL=https://bot.dinamiceducation.com` y sin prefijo, una firma de `https://bot.dinamiceducation.com/webhooks/twilio/main-menu/status` reconstruye la misma URL.

Prueba sintética, sin `MessageSid` y con monitoreo apagado, para no escribir una entrega:

- Firma correcta directo al puerto 3000: 200.
- La misma firma a través de Nginx: 200.
- Firma inválida: 403.

No hubo un callback de estado emitido por Twilio. No se trata esa prueba como tráfico legítimo de estado.

## Preflight antes del reinicio

Con el token productivo ya cargado y las variables que iba a recibir el contenedor:

`mode=log`, `ready=true`, `logReady=true`, `configurationState=observing`, `enforceReady=false`, `productionUrlVerified=false`, exit 0.

El arranque del contenedor nuevo repitió ese informe y no se detuvo.
