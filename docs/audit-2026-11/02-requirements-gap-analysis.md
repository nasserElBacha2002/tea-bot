# Matriz de requisitos v1.1

Estados usados:

- `IMPLEMENTED_AND_VALIDATED` — código, prueba ejecutada en esta auditoría y resultado observado. **Ningún ítem quedó en este estado.** La suite no se reejecutó.
- `IMPLEMENTED_PENDING_VALIDATION` — el comportamiento está en código y hay tests en el repo, sin corrida ni despliegue confirmados aquí.
- `PARTIALLY_IMPLEMENTED` — hay una parte real y falta el contrato del plan.
- `NOT_IMPLEMENTED` — no está el comportamiento pedido.
- `BLOCKED` — no se puede avanzar con la información o el entorno. **Ningún ítem.**
- `NOT_APPLICABLE` — no corresponde al producto actual.

Denominador de los tickets TB-001 … TB-024:

| Estado | Cantidad |
|---|---|
| `IMPLEMENTED_AND_VALIDATED` | 0 |
| `IMPLEMENTED_PENDING_VALIDATION` | 1 (TB-001) |
| `PARTIALLY_IMPLEMENTED` | 8 |
| `NOT_IMPLEMENTED` | 15 |
| `BLOCKED` | 0 |

Complejidad: baja / media / alta, estimada para el delta que falta, no para rehacer lo ya escrito.

## Tickets del plan

### TB-001 — Integrar reentrada post-cierre

- **Objetivo:** el primer texto después de devolver al bot no se interpreta como opción de un menú no mostrado.
- **Estado:** `IMPLEMENTED_PENDING_VALIDATION`
- **Código:** `conversation-reentry.service.js`, `conversation-reentry-policy.js` (`resolveReentryPolicy`, default `prompt`), `conversation-bot-lifecycle.service.js` `returnConversationToBot` líneas 63–176, `message-persistence.service.js` líneas 70–124, `twilio-inbound-pipeline.js` líneas 78–135, migración `008_conversation_reentry.sql`.
- **Tests presentes, no reejecutados:** `conversation-reentry.service.test.js`, `conversation-reentry.integration.test.js`, `twilio-inbound-pipeline.test.js`, tests de lifecycle.
- **Endpoints:** el cierre del inbox ya dispara el lifecycle. No hace falta otro bugfix del mismo síntoma.
- **Riesgo:** producción puede no tener la columna o puede forzar `REENTRY_POLICY=legacy`. Eso no se pudo leer.
- **Cambio necesario:** validar en staging (migración aplicada, flag, E2E de cierre). No reimplementar.
- **Dependencias:** ninguna de código nuevo. TB-019 tiene que respetar `reentry_json`.
- **Prioridad:** P0 de integración. **Complejidad:** baja.
- **Aceptación:** con policy `prompt` y columna presente, cerrar atención y enviar texto libre muestra el prompt de continuar/nueva consulta, no `fallback_global`. Rollback documentado sin dejar `reentry_json` huérfano.

### TB-002 — Caso de uso de toma manual

- **Objetivo:** un agente autorizado toma una conversación en `bot` o con reentrada pendiente.
- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** `claimConversation` rechaza `bot` con `CONVERSATION_BOT_ACTIVE` (`conversation-inbox.service.js` líneas 165–170). El test de integración de reentrada afirma ese rechazo. No hay servicio `takeover`.
- **Prioridad:** P0. **Complejidad:** alta.
- **Detalle de diseño:** `03-conversation-lifecycle.md`. Ticket ejecutable: `09-technical-backlog.md`.

### TB-003 — Serializar toma e inbound

- **Objetivo:** un webhook no emite TwiML de bot después de una toma confirmada.
- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** el lock de inbound es por proceso (`inbound-user-lock.js`). El pipeline no relee el estado humano antes del TwiML de bot (`twilio-inbound-pipeline.js` líneas 151–160). `findByIdForUpdate` existe y el claim no lo usa.
- **Prioridad:** P0. **Complejidad:** alta. **Dependencia:** TB-002 y TB-006 (no activar toma sin exclusión).

### TB-004 — UI de toma, conflicto y WebSocket

- **Objetivo:** botón en conversación `bot`, composer recién después del 200, conflicto visible.
- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** `ConversationComposer.tsx` líneas 85–116 solo avisa en `bot` y ofrece claim en `waiting_human`.
- **Prioridad:** P0 de producto, después del API. **Complejidad:** media.

### TB-005 — Firma del webhook Twilio inbound

- **Objetivo:** `log` y luego `enforce` sobre el inbound, con la URL real detrás del proxy.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** el status usa `verifyTwilioSignature` (`twilio-webhook.routes.js` línea 8; middleware líneas 24–40, siempre 403). El inbound está comentado como riesgo residual (líneas 9–11). No hay modo `log`. Tests del middleware cubren el callback de estado.
- **Prioridad:** P0. **Complejidad:** media.
- **Riesgo:** enforce con URL distinta a la de Twilio rechaza tráfico legítimo. Por eso el modo `log` va primero.

### TB-006 — Idempotencia SQL always-on

- **Objetivo:** `acquireInboundProcessing` decide el procesamiento aunque el monitoreo esté apagado; un fallo no se marca como hecho.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** migración `007`, `monitoring.repository.js` `acquireInboundProcessing`, `webhook-events.service.js`. Gate en `twilio-webhook.controller.js` líneas 17–24: si `!config.monitoringEnabled` o si la base tira, `tracked: false` y se procesa igual. Líneas 68–81 marcan `webhook-processed-ids.json` **antes** de `processCanonicalTwilioInbound`. El default de `monitoringEnabled` es `false`.
- **Tests presentes:** `webhook-acquire.integration.test.js`, `webhook-events.service.test.js`, `migration-007.test.js`. No demuestran el flag apagado (T09).
- **Prioridad:** P0. **Complejidad:** media.
- **Aceptación:** T07, T08, T09 de la sección 13 del plan.

### TB-007 — Contraseñas y permisos

- **Objetivo:** hash con salt y permisos de toma, transferencia y alcance.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** `verifyPasswordHash` compara SHA-256 hex sin salt (`admin-auth.service.js` líneas 17–22). Roles `admin` y `conversations_only` (`auth/roles.js`). Token sin campo `r` se trata como admin (líneas 17–23). Inbox: cualquier autenticado lee y actúa sobre cualquier id. No hay permiso `takeover`.
- **Prioridad:** P0 el hash; P0/P1 el permiso de toma junto con TB-002. **Complejidad:** media.
- **Cambio:** rehash al login válido (bcrypt o argon2). No reset masivo. Permiso explícito de toma y de quitar una conversación a otro agente.

### TB-008 — Instrumentar transiciones y bucles en shadow

- **Objetivo:** registrar motivo de transición sin cambiar respuestas.
- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** `evaluateTransitionsDetailed` devuelve `fallback` o `stay_on_node`, pero `fallbackCount` solo sube si `usedFallback` (`flow-engine.service.js` líneas 293–296). Un `default` hacia `fallback_global` no entra ahí (`conversationTracker.service.js` líneas 101–104). No hay tabla de señales.
- **Prioridad:** P1. **Complejidad:** media.

### TB-009 — Alertas de conversación estancada en el inbox

- **Objetivo:** indicador, filtro, prioridad y toma rápida. Sin handoff automático al principio.
- **Estado:** `NOT_IMPLEMENTED`
- **Dependencia:** TB-008 para no alertar a ciegas; TB-004 para la acción. **Prioridad:** P1. **Complejidad:** media.

### TB-010 — Matching Unicode, emoji y límites de palabra

- **Objetivo:** keycaps, acentos y `matchIncludes` con frontera, sin fuzzy libre.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** el motor y `compile-flow.js` solo hacen `trim` + `toLowerCase` (`flow-engine.service.js` líneas 20–22). Acentos: `global-commands.js` líneas 1–7. Keycaps: `stripKeycapDigits` en `conversation-reentry-policy.js`, no en el motor. `matchIncludes` es `input.includes(needle)` (motor, rama compilada cerca de las líneas 626–634).
- **Prioridad:** P1. **Complejidad:** media. **Dependencia:** fixtures del flujo publicado. Flag para volver al matching anterior.

### TB-011 — Lint al publicar flujos

- **Objetivo:** exactos duplicados, includes ambiguos, `default` a sí mismo, nodos terminales rotos.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** `flow-validation-management.service.js` valida estructura y compila. No hay reporte de colisiones ni de auto-transiciones.
- **Prioridad:** P1. **Complejidad:** media. Puede publicarse como advertencia antes de bloquear.

### TB-012 — SQL como fuente de verdad de sesiones

- **Objetivo:** write-through y, después, retirar autoridad de `sessions.json`.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** `conversation_sessions` se hidrata al runtime (`message-persistence.service.js` líneas 81–90). `session.service.js` sigue leyendo y escribiendo `data/sessions.json`. El volumen Docker monta `./whatsapp-bot/data`.
- **Prioridad:** P1, después de Fase 0 y 1. **Complejidad:** alta.
- **Riesgo:** cortar JSON antes de tiempo pierde cursores en reinicios parciales.

### TB-013 — Liveness, readiness y actividad

- **Objetivo:** `/livez`, `/readyz` con base y flujo, más actividad de cola.
- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** `/health` y `/healthz` en `app.js`. Actividad en `activity-store.js` y en `MonitoringPage` (ventanas 15m/60m/24h). No hay readiness de base. El healthcheck de Docker pega a `/health`.
- **Prioridad:** P1. **Complejidad:** baja.

### TB-014 — Distinguir transporte TwiML / REST / interno

- **Objetivo:** no contar un evento `system` como WhatsApp ni un texto persistido como enviado.
- **Estado:** `NOT_IMPLEMENTED` como modelo de transporte. Hay un sustituto incompleto.
- **Evidencia:** `sender_type` `user`, `bot`, `agent`, `system`. El bot guarda `providerMessageId: context.providerMessageId || null` (`conversation.service.js` líneas 116–133) y el camino TwiML no pasa SID. El agente REST sí guarda `sent.sid` (`conversation-inbox.service.js` líneas 263–293). El cierre inserta `sender_type: 'system'` sin Twilio (líneas 329–336).
- **Prioridad:** P1, antes de cerrar cifras de costos. **Complejidad:** media.

### TB-015 — Conciliar la diferencia de 1.024 salientes

- **Objetivo:** informe diario SQL vs Usage Records, con tolerancia y alarma.
- **Estado:** `NOT_IMPLEMENTED` para esa diferencia.
- **Evidencia parcial distinta:** `monitoring.service.js` reconcilia conjuntos de SID de Twilio contra la base (cerca de las líneas 172–200). Eso no explica octubre ni separa TwiML sin SID. Cifras 5.235 / 3.442 / 769 / 299 / USD 134,5225: evidencia histórica del plan. **Pendiente de validación** contra la cuenta y la base.
- **Hipótesis, no medida:** el `catch` del webhook responde TwiML de error (`twilio-webhook.controller.js` líneas 173–178) que puede facturarse sin fila de bot; otros números de la cuenta; borde de mes UTC vs Argentina; reintentos. `system` = 299 no cierra la brecha (4.211 + 299 = 4.510, todavía lejos de 5.235).
- **Prioridad:** P1. **Complejidad:** alta. **Dependencia:** TB-014.

### TB-016 — Menús e intención inicial

- **Objetivo:** `collect_email` no parezca ignorar la consulta; no guardar DNI de más.
- **Estado:** `NOT_IMPLEMENTED` como mejora de UX. La recolección de email sí existe (`email-collection-runtime.js`, migración `005`).
- **Prioridad:** P2. **Complejidad:** media. **Dependencia:** métricas de TB-008 para no rediseñar a ciegas.

### TB-017 — Separar páginas y servicios grandes

- **Objetivo:** extraer solo lo que el feature nuevo necesite.
- **Estado:** `NOT_IMPLEMENTED` a propósito.
- **Prioridad:** P2, acompañando TB-002 y TB-009. No es un proyecto propio. **Complejidad:** media si se limita al caso de uso nuevo.

### TB-018 — Plantillas oficiales de inicio proactivo

- **Objetivo:** `ContentSid` para abrir conversación fuera de ventana, con idempotencia.
- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** no hay `ContentSid` en el envío. `twilio-whatsapp.service.js` manda `Body`. La categoría histórica `channels-whatsapp-template-service` no demuestra templates de esta app.
- **Prioridad:** P3. **Complejidad:** alta. **Dependencia:** TB-005, TB-006, TB-014, demanda operativa.

### TB-019 / OPS-01 — Toma desde `bot`, reentrada o cualquier menú

- **Objetivo:** el mismo que TB-002 + TB-003 + TB-004, incluyendo `reentry_json` pendiente.
- **Estado:** `NOT_IMPLEMENTED`
- **Prioridad:** P0. **Complejidad:** alta.
- **Nota:** se implementa una sola vez, con esos tres tickets. No es un cuarto diseño.

### TB-020 / MEDIA-01 — Recibir y ver adjuntos

- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** el adapter lee `Body` (`twilio-inbound.adapter.js`). Si `!event.text`, el controller responde TwiML vacío y no persiste (líneas 97–105). No hay tabla de adjuntos ni UI de preview. `NumMedia` solo está en la allowlist del sanitizer de monitoreo.
- **Prioridad:** P1. **Complejidad:** alta.

### TB-021 / MEDIA-02 — Enviar adjuntos

- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** el envío de agente es texto (`sendWhatsAppMessage` con `body`). Composer sin archivo.
- **Prioridad:** P1, después de recibir. **Complejidad:** alta. **Dependencia:** ventana de 24 h y URL que Twilio pueda leer sin bucket público.

### TB-022 / SEARCH-01 — Búsqueda por contenido

- **Estado:** `PARTIALLY_IMPLEMENTED`
- **Evidencia:** `conversation.repository.js` líneas 253–264: `LIKE` sobre teléfono, nombre y `conversation_messages.body`, con el mismo término. Paginación de lista por `limit`/`offset`. No busca email. No hay FULLTEXT, fragmento, highlight, salto al mensaje ni filtro de emisor/fecha en esa consulta. Placeholder UI: «Teléfono o nombre» (`ConversationFilters.tsx` líneas 74–81).
- **Prioridad:** P1. **Complejidad:** media para cerrar el contrato sobre el `LIKE` actual; alta si se exige FULLTEXT antes de medir.
- **Recomendación:** no instalar FULLTEXT hasta ver latencia. Volumen de referencia histórica: miles de mensajes por mes, no millones.

### TB-023 / MON-01 — Panel mensual de actividad

- **Estado:** `NOT_IMPLEMENTED` como panel mensual.
- **Evidencia parcial:** `MonitoringPage.tsx` muestra diagnóstico, proceso, saldo Twilio, sender, base, última actividad, conteos 15m/60m/24h, entregas, jobs e incidentes. Poll a `GET /api/monitoring/overview`. Sin año/mes, serie diaria, CSV ni corte Argentina.
- **Prioridad:** P1. **Complejidad:** media. **Dependencia:** TB-014 para no dibujar ceros donde faltan SID.

### TB-024 / FIN-01 — Importes Twilio y Meta separados

- **Estado:** `NOT_IMPLEMENTED`
- **Evidencia:** `twilio-monitor.client.js` no llama Usage Records. No hay desglose de categorías ni sección de recargas. El saldo de cuenta que se muestra no es el gasto del mes.
- **Prioridad:** P1. **Complejidad:** alta.
- **Regla:** `totalprice` es control, no se suma otra vez a las categorías. Una recarga no es consumo. El promedio USD 0,01925 de octubre es observado, no una tarifa a hardcodear.

## Requisitos de comportamiento que no son un ticket extra

| ID | Requisito | Estado | Notas |
|---|---|---|---|
| HANDOFF-QUEUE | Derivación del motor a `waiting_human` y pausa de sesión | `IMPLEMENTED_PENDING_VALIDATION` | `human-handoff.service.js` |
| CLAIM-QUEUE | Claim solo desde `waiting_human` | `IMPLEMENTED_PENDING_VALIDATION` | Comportamiento actual, reemplazado por TB-019 |
| HUMAN-SKIP | Inbound en humano no corre el motor | `IMPLEMENTED_PENDING_VALIDATION` | `message-persistence.service.js` líneas 46–64 |
| CLOSE-VS-RETURN | Cerrar sin devolver al bot, distinto de return | `NOT_IMPLEMENTED` | Ambos endpoints vuelven a `bot` |
| EXCLUSIVE-OWNER | Un solo dueño; otro agente recibe 409 | `NOT_IMPLEMENTED` | Claim de `assigned` devuelve la fila sin error (líneas 172–174). Enviar reasigna `assignedAgentId` (líneas 300–303) |
| WS-INBOX | Proyección en vivo | `IMPLEMENTED_PENDING_VALIDATION` | No sustituye un GET |
| FLOW-VERSIONS | Flujos versionados y editor | `IMPLEMENTED_PENDING_VALIDATION` | Fuera del gap P0 |
| SIG-STATUS | Firma del callback de estado | `IMPLEMENTED_PENDING_VALIDATION` | Hecho |
| SIG-META | Firma del webhook Meta | `NOT_IMPLEMENTED` | Ruta montada |
| AUDIT-TAKEOVER | Auditoría de toma | `NOT_IMPLEMENTED` | `audit_logs` se usa en flujos, no en claim |
| READY-DB | Readiness con base | `NOT_IMPLEMENTED` | Parte de TB-013 |
| CI-GATE | Lint, tests y build bloquean merge | `NOT_IMPLEMENTED` | No hay `.github/workflows` ni otro CI en el repo |
| PII-LOGS | No loguear teléfono crudo | `NOT_IMPLEMENTED` | `console.log('Twilio From:', req.body?.From)` línea 45 del controller |

## Qué no está bloqueado

SQL y Twilio no estuvieron disponibles para medir octubre de nuevo. Eso deja TB-015 y TB-024 **pendientes de validación de datos**, no bloqueados para diseñar. La toma manual no depende de esas cifras.
