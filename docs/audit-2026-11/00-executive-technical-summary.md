# Tea Bot — Resumen técnico ejecutivo

**Fecha de auditoría:** 4 de noviembre de 2026  
**Fuente de verdad:** código en el repositorio. El plan v1.1 es el contrato a contrastar, no una descripción del estado actual.  
**Alcance:** auditoría y planificación. No se modificó código, configuración, datos ni migraciones.

## Estado real

Tea Bot es un monolito Node.js con panel React, SQL Server y Twilio WhatsApp. El camino productivo está armado: webhook, motor de flujos versionados, persistencia de conversaciones, cola humana, inbox, WebSockets y un módulo de salud operativa.

La corrección de reentrada posterior al cierre humano **está en el código** (`REENTRY_POLICY`, migración `008`, servicio y pruebas). No hay evidencia en el repositorio de que esa corrección esté desplegada en producción. No debe reimplementarse.

Lo que el plan v1.1 pide como P0 de producto **no está**: un agente no puede tomar una conversación en estado `bot`. El claim solo acepta `waiting_human`, no es exclusivo y no toma un lock SQL.

Lo que el plan pide como P0 de integridad **sigue abierto** en el webhook entrante: no valida `X-Twilio-Signature`, y la idempotencia SQL solo corre si `MONITORING_ENABLED` está activo. Si ese flag está apagado, o si la base falla, el proceso marca el `MessageSid` en un archivo **antes** de terminar el turno.

## Respuestas directas

1. **Estado real.** Plataforma operativa de inbox y flujos, con reentrada implementada en código y pendiente de validación de staging/producción. La intervención humana sigue dependiendo de que el bot derive. La facturación mensual y los adjuntos no existen como producto.
2. **Completo frente a faltante.** Completos a nivel de código, pendientes de revalidación en esta auditoría: handoff a cola, claim de `waiting_human`, devolución al bot con prompt de reentrada, editor de flujos, inbox en vivo, firma del callback de estado. Faltan toma desde `bot`, exclusión mutua, firma del inbound, idempotencia siempre activa, detección de estancamiento, multimedia, dashboard de costos y plantillas proactivas.
3. **Qué corregir primero.** Pérdida o duplicación de mensajes (dedupe prematuro e idempotencia condicionada al monitoreo) y webhooks sin firma. En el mismo bloque, el lock que va a hacer segura la toma humana. No postergar la integridad para entregar solo el botón.
4. **Toma de cualquier conversación.** Nuevo caso de uso transaccional sobre `conversations` con `UPDLOCK`, handoff `assigned`, pausa de sesión, limpieza segura de `reentry_json`, auditoría y una segunda lectura de estado **después** del FlowEngine y **antes** del TwiML. El botón actual no alcanza: hoy el backend responde `409 CONVERSATION_BOT_ACTIVE`.
5. **Usuarios atrapados.** El motor no detecta bucles. `fallbackCount` vive en memoria y no sube cuando un `default` manda a `fallback_global`. Hay que instrumentar transiciones y, en shadow, emitir señales. La derivación automática queda para después de medir falsos positivos. La toma manual no debe depender de esa detección.
6. **Archivos y búsqueda.** Los adjuntos no se guardan; un inbound solo con media se descarta. La búsqueda por cuerpo **ya existe** en SQL con `LIKE`, pero la UI dice «Teléfono o nombre», no muestra fragmentos ni salta al mensaje. Primero completar ese buscador. Multimedia después, con almacenamiento privado y descarga autenticada.
7. **Mensajes y costos reales.** El monitoreo actual es salud, saldo y tráfico reciente. No hay Usage Records ni separación Twilio / Meta. Octubre 2026 sigue siendo línea base histórica: 5.235 salientes facturados contra 4.211 identificables en SQL. No se reconcilió en esta auditoría porque no se consultó SQL ni Twilio.
8. **Mensajes perdidos o duplicados.** Un reintento de Twilio puede ignorarse si el archivo de dedupe se escribió antes del fallo. Con monitoreo apagado, dos procesos no comparten esa exclusión. El camino SQL de `acquireInboundProcessing` ya existe y debe dejar de depender del flag de observabilidad.
9. **Mejoras independientes.** Firma de status ya está. Firma inbound, idempotencia, hashing de contraseñas, búsqueda UX y dashboard de costos pueden avanzar en ramas distintas. La toma manual no debe activarse en producción sin el lock frente al webhook. El matching nuevo no debe publicarse sin replay del flujo vigente. La reentrada no se reescribe.
10. **Plan.** Fase 0 integridad y firma. Fase 1 toma humana, en paralelo de diseño pero con activación después del lock. Fase 2 navegación en shadow y luego matching. Fase 3 búsqueda UX y multimedia. Fase 4 costos. Fase 5 sesiones SQL como autoridad. Fase 6 plantillas, solo con demanda operativa.

## Hallazgos que ya no hay que reabrir

| Hallazgo histórico | Estado en código | Evidencia |
|---|---|---|
| Cierre humano y el siguiente texto cae en `fallback_global` | Corregido en código con prompt de reentrada | `conversation-reentry.service.js`, `conversation-bot-lifecycle.service.js`, migración `008` |
| Callback de estado sin firma | Corregido | `twilio-webhook.routes.js` línea 8 |
| No existía `provider_webhook_events` | Existe, no es always-on | migración `007`, `openMonitoringGate` |
| Inbox y SQL de conversaciones inexistentes | Existen | migraciones `001`–`002`, rutas `/api/conversations` |
| Contraseñas SHA-256 sin salt | Sigue igual | `admin-auth.service.js` líneas 17–22 |
| Inbound Twilio sin firma | Sigue igual | `twilio-webhook.routes.js` líneas 9–11 |

## Límites de esta auditoría

- No se leyó `.env` ni se imprimieron secretos.
- No se ejecutó la suite. Los tests de integración borran e insertan filas, y no se confirmó que el entorno apunte a una base TEST aislada.
- No se consultó SQL Server ni la API de Twilio. Las cifras de octubre 2026 quedan como evidencia histórica del plan, no como medición nueva.
- `MONITORING_ENABLED` y `REENTRY_POLICY` en el proceso productivo no se observaron. El default de código es monitoreo apagado y reentrada `prompt`. `.env.example` documenta monitoreo `true` y deja `REENTRY_POLICY` comentado.

## Clasificación de evidencia

Cada documento de esta carpeta distingue: confirmado por código, tests presentes no reejecutados, evidencia histórica, hipótesis y pendiente de validación.

---

**AUDIT_STATUS: COMPLETED**

**IMPLEMENTATION_STATUS: NOT_STARTED**

**P0_OPEN: 7**

1. Inbound Twilio sin `X-Twilio-Signature`.
2. Idempotencia SQL apagada con el monitoreo y dedupe en archivo antes del éxito.
3. Toma manual desde `bot` inexistente.
4. Claim sin lock ni exclusión; el TwiML no se revalida al final del turno.
5. Contraseñas SHA-256 sin salt.
6. Webhook Meta montado sin verificación de firma.
7. No hay pipeline de CI que bloquee merge.

**REQUIREMENTS:** sobre TB-001 … TB-024: **1** implementado pendiente de validación, **8** parciales, **15** pendientes, **0** bloqueados, **0** validados en esta auditoría.

**ROADMAP:** Fase 0 integridad → Fase 1 toma humana → Fase 2 navegación → Fase 3 búsqueda y multimedia → Fase 4 costos → Fase 5 sesiones SQL → Fase 6 plantillas. Firma e idempotencia no esperan a la toma. La toma no se enciende sin lock. Detalle en `08-implementation-roadmap.md`.

**NEXT_RECOMMENDED_TICKET: TB-006**

La pérdida en reintentos ya puede ocurrir en el webhook actual: si el gate de monitoreo no trackea el evento, `markProcessed` corre antes del motor. TB-005 (firma inbound) es el segundo cambio del mismo bloque y puede ir en paralelo. TB-001 es una validación de staging de la reentrada ya escrita, no código nuevo. TB-019 espera el lock de la Fase 0 para activarse.
