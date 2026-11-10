# TB-005 — aptitud de despliegue de la firma

Estado de este entorno: **no listo para activar**. Modo efectivo `off`, `ready=false`, `logReady=false`, `enforceReady=false`.

El código puede mergearse para review. No activa `enforce` y no debe desplegarse con `log` hasta el preflight de abajo. Nginx productivo y Twilio Console no se validaron.

## Qué informa el preflight

`node scripts/twilio-signature-preflight.js` imprime un JSON y sale 0 solo si `ready` es true: modo `log` y configuración que puede verificar sin cortar el canal.

Sale 2 en cualquier otro caso, incluido `off` con token y URL correctos. `off` arranca el proceso (`startup: boot`) y deja el inbound sin autenticar. El callback de estado igual exige firma.

Campos: modo y origen del modo, `authTokenConfigured`, validez de `APP_BASE_URL`, validez del prefijo, `prefixSource`, origen y prefijo públicos, `configurationState`, `secure`, `activated`, `ready`, `logReady`, `logDisruptive`, `enforceConfigurable`, `enforceReady`, `productionUrlVerified`, `startup`, `startupBlocking`, `logBlocking`.

No imprime secretos. `enforceReady` no pasa a true en este comando.

## URL que hay que dejar fija antes de log

Una sola de estas formas:

| Nginx | APP_BASE_URL | TWILIO_PUBLIC_PATH_PREFIX | Ruta que ve Express |
| --- | --- | --- | --- |
| Sin prefijo | `https://host` | vacío | `/webhooks/twilio/:flowId` |
| Quita el prefijo | `https://host` | `/tea` | `/webhooks/twilio/:flowId` |
| Quita el prefijo | `https://host/tea` | vacío | `/webhooks/twilio/:flowId` |
| Conserva el prefijo | `https://host` | vacío | `/tea/webhooks/twilio/:flowId` |

Puerto no estándar forma parte del origen (`https://host:8443`). Query se copia tal como llega. `X-Forwarded-Host` y `X-Forwarded-Proto` no entran en la URL firmada.

Si la base tiene pathname y el prefijo también está definido, el plan es `public_prefix_ambiguous`. `log` y `enforce` no arrancan. No hay que adivinar cuál de los dos usar.

## De off a log sin cortar tráfico legítimo

1. Dejar `TWILIO_SIGNATURE_MODE` ausente o en `off`. El inbound sigue como hoy.
2. Cargar `TWILIO_AUTH_TOKEN`.
3. Fijar la URL con la tabla de arriba. Un solo lugar para el prefijo.
4. Correr el preflight. Tiene que decir `logReady: true` y, mientras el modo sea `off`, `ready: false` y exit 2.
5. Pasar la variable a `log` y reiniciar.
6. El arranque imprime el preflight. Si falta token o URL, el proceso sale 1 y no degrada a `off`.
7. Con log sano, `twilio_signature_valid` confirma la URL. Una firma inválida se registra y el turno se procesa. Eso mide; no autentica.
8. No activar `log` para “probar”: sin token o sin URL el canal respondería 403.

## Cuándo considerar enforce

Después de ver `twilio_signature_valid` en el tráfico real, con la URL pública que Twilio firma detrás del Nginx productivo. El preflight local no alcanza: `enforceReady` queda false y `productionUrlVerified` queda false.

Entonces `TWILIO_SIGNATURE_MODE=enforce` y reiniciar. Firma ausente o inválida responde 403 y no adquiere el evento SQL.

Rollback: volver la variable a `log` y reiniciar. No revertir código ni apagar la idempotencia.

## Riesgos que siguen abiertos

- Este checkout no tiene token ni `APP_BASE_URL`. El modo efectivo es `off`.
- No hay prueba contra el Nginx productivo ni contra un webhook real de Twilio.
- Un `log` sano deja pasar una firma inválida a propósito.
- El status sin `APP_BASE_URL` válida responde 403 aunque el inbound esté en `off`.
- Las dos integraciones de takeover siguen omitidas porque 009 no está aplicada.
