# DEPLOYED_LOG_VALIDATED

Fecha: 2026-11-10. TB-005, TB-006 y el motor de navegación están en el backend productivo. `TWILIO_SIGNATURE_MODE=log`. `enforce` no se activó. Takeover queda en `false`. La migración 009 no se aplicó.

## SHA

| Lugar | SHA o digest |
| --- | --- |
| Checkout productivo | `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937` |
| Imagen en ejecución | `sha256:2e22dea94b8f1c458782be366a4464f43ab16103de91cfc40fe36ebbc47cdec6` |
| Imagen de rollback | `sha256:8a95d51f9fe842b1eecf2c28fc940285413b5a3039e7ae1a77e29251c03977ec` |
| SHA anterior | `9b2ff0be71058a11713b97146a20f683b631eda5` |

## Qué quedó verificado en vivo

Siete ingresos reales de WhatsApp llegaron con `twilio_signature_valid` contra `https://bot.dinamiceducation.com/webhooks/twilio/main-menu`. Los siete se adquirieron una vez, terminaron `PROCESSED` y guardaron `response_body`. No hubo duplicados ni errores de SQL. `/health` responde 200. El contenedor está healthy.

## Qué no es tráfico de Twilio

El status callback del sender en línea no tiene URL. Una firma sintética de `https://bot.dinamiceducation.com/webhooks/twilio/main-menu/status` respondió 200 por Nginx y por el puerto 3000. Una firma inválida respondió 403. No llegó un callback de estado emitido por Twilio.

Las opciones `Dirección de estudios`, `Menú` y `Atrás` no se identificaron en esta ventana. El barrido de v62 ya las alineaba con su número, y v62 sigue publicado.

## Herramienta local no desplegada

La separación de `--inspect`, `--probe` y `--apply-010` está en el working tree local y se usó desde una copia temporal en el VPS. La imagen en ejecución es el árbol de `2ccaeb6`, no ese diff local.
