# Validación posterior

Contenedor `tea-whatsapp-bot`, imagen `sha256:2e22dea94b8f1c458782be366a4464f43ab16103de91cfc40fe36ebbc47cdec6`, checkout `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`. Healthy, 0 reinicios. `GET /health` respondió 200 en el puerto 3000 y en `https://bot.dinamiceducation.com`.

El proceso conectó a `tea_bot` en `dinamicsystems`. `response_body` sigue `nvarchar(max)`. 010 registrada. 009 ausente. Publicado: `main-menu` v62.

Variables efectivas: `TWILIO_SIGNATURE_MODE=log`, `APP_BASE_URL=https://bot.dinamiceducation.com`, `MANUAL_TAKEOVER_ENABLED=false`, prefijo ausente. El binario contiene `normalizeFlowMatchText` y `verifyTwilioInboundSignature`.

## Tráfico real de los primeros minutos

Sin leer textos ni identificadores de mensaje:

- 7 `twilio_signature_valid` en `/webhooks/twilio/main-menu`, URL `https://bot.dinamiceducation.com/webhooks/twilio/main-menu`.
- 7 `inbound_acquired` y 7 `inbound_completed`.
- 7 filas `PROCESSED` en `provider_webhook_events`, las 7 con `response_body`.
- 0 grupos duplicados por mensaje.
- 0 líneas de error fuera de esos eventos.
- 3 `reentry_inbound`.

No apareció `twilio_signature_invalid` ni un 403 de un ingreso real. El único 403 registrado en la prueba fue la firma sintética inválida del status.

No se observó en los logs una elección de `Dirección de estudios`, una pregunta libre, `Menú` o `Atrás`. Esas rutas quedaron demostradas por la suite y el barrido de v62, no por una conversación identificada en esta ventana.

## Navegación revisada antes del deploy

Sobre el documento v62, sin publicarlo:

- `carreras a distancia`, opción 2, va a `no_distancia_menu`.
- `blanqueo de mail institucional`, opción 5, va a `si_pd_mail_inst`.
- `periodismo general`, opción 2, va a `si_pg_menu`.

La etiqueta y el número terminan en el mismo nodo.
