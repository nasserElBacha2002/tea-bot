# Tea Bot — Correcciones críticas que siguen abiertas

**Fecha:** 10/11/2026.  
**HEAD local:** `06f26d8`. **`origin/main`:** `9b2ff0b`.  
La toma manual ya está escrita en el commit local. Sigue abierta como validación, esquema y despliegue. No está en el remoto.

## Cerradas en código, todavía sin validación de entorno

| Tema | Dónde | Qué falta para cerrarlo |
|---|---|---|
| Reentrada post-cierre | TB-001. Migración 008 aplicada en la base local. Tests unitarios y de integración SQL en verde el 10/11. | Ver la columna y `REENTRY_POLICY=prompt` en el proceso que atiende WhatsApp. Un E2E de cierre y texto libre. |
| Toma manual | TB-002, TB-003, TB-004, TB-019. Código y UI en `06f26d8`. Flag apagado por default. | Base con `test` en el nombre, aplicar 009, dos pruebas que hoy hacen skip, recién después merge con el flag apagado. |

## P0 que siguen abiertos

### 1. Idempotencia del inbound atada al monitoreo — TB-006

**Confirmado en código.** `openMonitoringGate` en `twilio-webhook.controller.js` devuelve `tracked: false` si `MONITORING_ENABLED` no está activo o si persistir el evento falla. En ese camino el controlador llama `webhookDedupe.markProcessed` antes de `processCanonicalTwilioInbound`.

**Escenario.** Twilio reintenta el mismo `MessageSid` después de un error. El archivo local ya lo marcó. El segundo intento se ignora y el primero puede no haber persistido la respuesta. Con el flag apagado, dos procesos no comparten esa exclusión. El default de código es apagado. El `.env` local tampoco define la variable.

**Impacto.** Pérdida o duplicación de mensajes en el camino que ya puede estar en producción.

**Corrección.** `acquireInboundProcessing` decide el turno aunque el monitoreo esté apagado. `COMPLETED` o `FAILED` se escriben al terminar. El archivo deja de ser la autoridad. La tabla ya existe en la base local.

### 2. Inbound de Twilio sin firma — TB-005

**Confirmado en código.** `twilio-webhook.routes.js` firma solo `POST /:flowId/status`. El comentario del archivo deja el inbound como riesgo residual. No hay modo `log`.

**Escenario.** Cualquiera que alcance la URL pública puede enviar un `MessageSid` y un `From` y disparar el motor. Un `enforce` con `APP_BASE_URL` distinta a la URL que Twilio firmó rechazaría el tráfico real.

**Impacto.** Mensajes falsos y, si se activa mal el enforce, corte del canal.

**Corrección.** Primero `log`, comparar la URL efectiva con la de Twilio y con Nginx. Después `enforce`, con vuelta a `log` sin redeploy de código si el flag lo permite.

### 3. Contraseñas SHA-256 sin salt — TB-007

**Confirmado en código.** `verifyPasswordHash` y `validateConfig` exigen 64 hex. El README documenta cómo generar ese hash. Un token de sesión sin campo `r` se trata como admin en el resto del panel. La toma no hereda ese atajo: vuelve a resolver la cuenta.

**Escenario.** Filtración del `.env` o de un backup permite probar el hash sin salt. Un token viejo conserva privilegio de admin.

**Impacto.** Acceso al panel y, con el flag de toma encendido, a la reasignación.

**Corrección.** Verificar el hash viejo en el login y guardar bcrypt o Argon2id. No reset masivo. El cambio de sesión legacy es aparte, porque invalida cookies vigentes.

### 4. Exclusión de la toma sin prueba SQL — TB-003

**Riesgo probable, no un defecto de lógica ya observado en SQL Server.** El código toma `UPDLOCK, ROWLOCK` sobre la fila. Las dos pruebas que lo ejercen en SQL hacen skip. Un lock de promesas en memoria no lo sustituye.

**Además, confirmado en código y aceptado por el diseño del 8/11:** después de autorizar la respuesta, el proceso ya puede estar escribiendo TwiML o haber recibido el SID. Esa ventana no se puede cerrar sin sostener el lock durante la llamada externa. Si la toma entra ahí, el cliente puede recibir la respuesta ya autorizada.

**También confirmado:** `FlowEngine` llama `sessionService.updateSession` durante el turno, antes de `handleOutbound`. Si la toma gana, el TwiML se suprime y la sesión SQL no se sincroniza. La sesión en memoria puede haber avanzado. El siguiente inbound, con estado `assigned`, no corre el motor. El riesgo aparece al devolver al bot si la memoria no se reconstruye desde SQL.

**Corrección de cierre.** Base aislada, migración 009, las dos pruebas en verde. No encender el flag en el servidor actual: sin 009, el bot deja de autorizar respuestas de filas persistidas y la toma responde 503.

### 5. No hay CI — parte de la primera etapa

**Confirmado.** No existe workflow. `origin/main` puede avanzar sin lint, typecheck ni tests. El commit de la toma ni siquiera está en el remoto, así que ningún pipeline remoto pudo haberlo visto.

## P0 que no deben reabrirse como código nuevo

- El síntoma de `fallback_global` después del cierre humano tiene corrección en código, con default `prompt` y columna en la base local.
- El callback de estado de Twilio ya valida `X-Twilio-Signature`.
- La toma no se vuelve a diseñar. Falta validarla y dejarla apagada hasta esa validación.

## Qué impide declarar cerrada la primera etapa

1. El webhook productivo puede procesar sin firma y puede marcar un mensaje como visto antes de terminarlo.
2. La toma no está en `origin/main`, no tiene la migración 009 aplicada ni siquiera en local, y el flag está apagado.
3. Las contraseñas siguen sin salt.
4. Nadie puede demostrar, desde este repositorio, qué commit y qué migraciones corre el servidor.
5. No hay un pipeline que impida publicar ese estado.

## Identidad de agente, si se define `INTERNAL_AGENT_ID`

**Defecto confirmado en código, inactivo en el `.env` local.** `resolveAgentIdFromUsername` devuelve esa variable para cualquier usuario y no usa el nombre. Admin y operador quedarían como el mismo dueño. La reasignación y el 409 de conflicto dejan de distinguirlos. La variable local no está definida. En producción es `NOT_VERIFIED`.
