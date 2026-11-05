# Seguridad y confiabilidad

## Firma Twilio

| Ruta | Comportamiento | Evidencia |
|---|---|---|
| `POST /webhooks/twilio/:flowId/status` | Exige `X-Twilio-Signature`. 403 si falta token, firma o no valida | `twilio-webhook.routes.js` línea 8, `verify-twilio-signature.js` líneas 24–40 |
| `POST /webhooks/twilio/:flowId` | Sin middleware | Líneas 9–11, comentario de riesgo residual |
| Modo `log` | No existe | Búsqueda de `TWILIO_SIGNATURE_MODE` vacía |

El validador compara la firma con la URL que la app reconstruye. Detrás de Nginx o de un HTTPS terminado afuera, esa URL puede no ser la que Twilio firmó. Por eso enforce no se prende el primer día. Plan de TB-005: flag `log` que registra mismatch sin rechazar, comparar contra la URL configurada del webhook, después `enforce`. En local, `off` explícito. Producción no hereda `off` por omisión una vez que el flag exista: el default seguro de producción es `log` hasta el corte, y el ticket lo deja escrito en el ejemplo de entorno.

Tests actuales del middleware cubren el status, no el inbound.

## Webhook Meta

`POST /webhook` está montado y el controller no verifica `X-Hub-Signature-256`. Si el proceso es alcanzable desde internet, cualquiera puede inyectar un inbound. Es P0 de superficie aunque el producto hable por Twilio. Si Meta ya no se usa, el cierre puede ser desmontar la ruta en lugar de firmarla. Eso es decisión de despliegue: confirmar tráfico antes de borrar.

## Idempotencia

Tabla `provider_webhook_events` con único `(provider, event_type, provider_message_id)` y `acquireInboundProcessing` que inserta `PROCESSING`, reclama leases viejos por `updated_at` y no promueve a completado dentro del acquire. Eso está bien diseñado.

El cableado no:

```17:24:whatsapp-bot/src/controllers/twilio-webhook.controller.js
async function openMonitoringGate(event, body) {
  if (!config.monitoringEnabled) return { action: 'process', tracked: false };
  try {
    return await beginInboundEvent({ event, payload: body });
  } catch (error) {
    console.error(`[Monitoring] webhook persist failed: ${error.message}`);
    return { action: 'process', tracked: false };
  }
}
```

`monitoringEnabled` sale de `MONITORING_ENABLED`, default **false** en `config.js`. El valor del proceso en producción no se leyó.

Cuando `tracked` es falso, líneas 68–81: si el id no está en `data/webhook-processed-ids.json`, se marca procesado y **después** corre el pipeline. Un throw posterior responde TwiML de error (líneas 162–178) y el reintento de Twilio encuentra el id y responde vacío. El usuario se queda con el mensaje de error genérico. Confirmado por código. No reejecutado en vivo.

Cuando `tracked` es verdadero, el archivo se marca en `markHandled` después del éxito, y un error llama a `closeMonitoringGate(gate, error)`. Ese camino es el que debe quedar siempre, incluidos los fallos de «no pude hablar con la tabla»: ahí la respuesta correcta es 500 o TwiML de error **sin** marcar el SID como terminado, para que Twilio reintente. Hoy un fallo de la tabla cae al archivo y marca igual.

El dedupe de archivo no tiene lock entre procesos. Dos instancias pueden procesar el mismo SID si el gate SQL no está.

`withInboundUserLock` documenta que no es distribuido (`inbound-user-lock.js` líneas 5–8).

## Contraseñas y sesión de panel

`verifyPasswordHash` calcula SHA-256 del texto plano y lo compara en tiempo constante con un hex de 64 caracteres. No hay salt ni bcrypt/argon2. El example de entorno documenta generar ese hash.

La cookie `tea_session` es HMAC-SHA256, con rol dentro del payload. Un token viejo sin rol se normaliza a `admin` (`roles.js` líneas 17–23). Rotar el secreto invalida sesiones; no migra el hash de la contraseña.

Usuarios: variables de entorno (`admin` y un operador de conversaciones). No hay tabla de usuarios. `assigned_agent_id` es un UUID derivado, no una FK.

## Autorización del inbox

`requireAuth` en todas las rutas de conversación. No hay chequeo de dueño.

- Cualquier sesión lee cualquier conversación y sus mensajes.
- Cualquier sesión envía y pisa `assigned_agent_id`.
- Cualquier sesión cierra y devuelve al bot.
- El WebSocket acepta la cookie sin mirar el rol. Un operador igual puede abrir el inbox HTTP, así que el socket no amplía el dato; sí mantiene abierta la suscripción a **todas** las conversaciones.

Para un equipo chico con inbox compartido, leer todo puede ser intencional. Escribir y tomar lo de otro sin dejar rastro no lo es, y el plan lo prohíbe. TB-007 define el permiso. Hasta entonces, no describir el panel como RBAC de atención.

IDOR clásico de «id de otra empresa» no aplica: el esquema no tiene tenant. El riesgo es horizontal entre agentes.

## Sesiones de flujo

Tres copias:

| Copia | Autoridad real hoy |
|---|---|
| `conversation_sessions` | Se escribe y se usa para hidratar |
| `sessions.json` + mapa en memoria | El motor lee esta en el turno |
| `conversations.current_node_key` | Cursor publicado, con guardia `updateFlowPositionIfNoReentry` solo si status `bot` y `reentry_json` es null |

Reiniciar el proceso recarga JSON. Si el archivo y SQL divergieron, gana lo que el hidratado haga en el siguiente mensaje, no una reconciliación al boot. TB-012 ordena eso después de que la toma y la idempotencia estén firmes. No es el primer P0: un reinicio no pierde el mensaje de Twilio por sí solo, pero puede repetir un nodo.

## Logs

`twilio-webhook.controller.js` línea 45 imprime `req.body.From`. El perf logger enmascara ids en otro campo, no este. TB de higiene: sacar ese `console.log`. No imprimir auth token. El sanitizer de monitoreo ya recorta claves de webhook para snapshots; no cubre este log.

## CI y despliegue

No hay workflows de GitHub ni otro CI en el árbol.

Scripts locales:

- Backend: `npm test` con `node --test` sobre `src/**/*.test.js`. Hay integración que escribe SQL.
- Frontend: `lint`, `typecheck`, `vitest`, `build`.
- Migraciones: `db:migrate`, `db:migrate:status`, `db:migrate:dry-run`.

Docker Compose levanta bot y frontend. `ALLOW_DEV_SEED` default `true`. El healthcheck usa `/health`, que no prueba la base. Eso puede marcar el contenedor sano con SQL caído.

No hay `/readyz`. No hay evidencia de rollback automatizado.

Tests de firma, acquire y reentrada existen en el repo. Esta auditoría no los corrió, porque varios tests de integración borran filas y no se confirmó una base TEST aislada.

## Matriz de hallazgos históricos

| Hallazgo | Ahora |
|---|---|
| Inbound sin firma | Abierto |
| Status sin firma | Cerrado en código |
| Idempotencia solo en memoria/archivo | Parcial: SQL existe y está detrás del flag |
| `MONITORING_ENABLED` condiciona la garantía | Abierto |
| SHA-256 sin salt | Abierto |
| Estado solo en JSON | Parcial: SQL de conversación es real; JSON de sesión sigue caliente |
| Sin inbox ni handoff | Cerrado en código, con los límites de `03` |
| Reentrada post-cierre | Implementada en código, despliegue no confirmado |
| Sin CI | Abierto |

## P0 abiertos de esta área

1. Inbound Twilio sin firma.
2. Dedupe prematuro y gate de idempotencia atado al monitoreo, con fail-open.
3. Meta sin firma, mientras la ruta siga publicada.
4. SHA-256 sin salt.
5. Claim y envío sin exclusión (tratado en `03`; es confiabilidad de estado, no solo UX).

El seed de desarrollo en Compose es P1 operativo: peligroso si ese compose se usa como producción, no demostrado que así sea.
