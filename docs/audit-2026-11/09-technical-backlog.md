# Backlog técnico

Cada ticket es un cambio revisable. Los IDs son los del plan v1.1. TB-019 no se implementa aparte de TB-002, TB-003 y TB-004.

Leyenda de evidencia: código leído el 4 de noviembre de 2026. Tests citados están en el repo y no se reejecutaron. Cifras de octubre son históricas.

---

## TB-001 — Validar reentrada en staging

- **Objetivo:** confirmar que la corrección ya escrita está migrada, flaggeada y se comporta en TEST/staging.
- **Problema:** el plan la da por `READY_FOR_STAGING`. El repo tiene el código. El despliegue no está en el repo.
- **Evidencia:** `migrations/008_conversation_reentry.sql`; `resolveReentryPolicy` default `prompt`; lifecycle `returnConversationToBot`; tests `conversation-reentry.service.test.js` y `conversation-reentry.integration.test.js`.
- **Prioridad:** P0. **Complejidad:** baja.
- **Alcance:** correr la suite de reentrada contra SQL TEST; `db:migrate:status` en staging; un E2E manual de cierre y texto libre; anotar `REENTRY_POLICY` efectivo. Si la columna falta, aplicar `008` en staging, no en producción, dentro de la ventana de cambio del equipo.
- **Fuera de alcance:** reescribir el servicio, cambiar copy, tomar conversaciones.
- **Backend / frontend / DB:** ninguno si ya está aplicado. Si falta la columna, solo correr la migración existente.
- **Endpoints:** los actuales `close` y `return-to-bot`.
- **Autorización:** sin cambio.
- **Tests:** los ya existentes, más el E2E manual registrado en el ticket.
- **Dependencias:** base TEST.
- **Riesgos:** `legacy` en el entorno anula el arreglo. Anotarlo, no «arreglarlo» en silencio en producción.
- **Aceptación:** informe corto con versión de migración, valor del flag, y transcripto del primer mensaje post-cierre (prompt, no `fallback_global`).
- **Rollout:** no hay feature nuevo.
- **Rollback:** `REENTRY_POLICY=legacy` es el rollback ya previsto. No dropear `reentry_json`.

## TB-006 — Idempotencia SQL siempre activa

- **Objetivo:** el `MessageSid` se adquiere en SQL aunque el monitoreo de salud esté apagado, y un fallo deja el evento reintentable.
- **Problema:** `openMonitoringGate` devuelve `tracked: false` si el flag está off o si la base tira. En ese camino `markProcessed` corre antes del motor (`twilio-webhook.controller.js` líneas 17–24 y 68–81).
- **Evidencia:** default `monitoringEnabled` false; migración `007`; `acquireInboundProcessing`.
- **Prioridad:** P0. **Complejidad:** media.
- **Alcance:**
  1. Llamar a `beginInboundEvent` siempre que la base de conversaciones esté habilitada.
  2. Si el acquire falla por error de infraestructura, no escribir el archivo de dedupe. Responder el TwiML de error actual para no dejar a Twilio sin HTTP, y permitir el reintento porque el SID no quedó `COMPLETED`.
  3. Borrar el `markProcessed` previo al pipeline. El archivo queda solo como espejo posterior al éxito, o se deja de escribir si SQL ya es la autoridad. Preferible dejar de usarlo para decidir.
  4. Test T09 con el flag de monitoreo en false.
- **Fuera de alcance:** dashboard, firma, cambiar el texto de error.
- **Backend:** `twilio-webhook.controller.js`, `webhook-events.service.js`. El monitoreo sigue registrando salud por su cuenta.
- **Frontend:** no.
- **DB:** no hay migración nueva si `007` ya está. Si no está en el entorno, aplicarla antes de prender el código.
- **Endpoints:** `POST /webhooks/twilio/:flowId`.
- **Autorización:** sin cambio (la firma es TB-005).
- **Tests:** extender `webhook-events.service.test.js` y la integración de acquire: dos procesos, crash simulado dejando `PROCESSING`, reclaim, flag de monitoreo false, error después del acquire sin segundo outbound.
- **Dependencias:** migración `007` en el entorno de prueba.
- **Riesgos:** reclamar leases demasiado corto (hoy el stale está en config, 120 s) puede duplicar si un turno legítimo tarda más. No bajar ese número en el mismo PR.
- **Aceptación:** T07, T08, T09. Un segundo POST con el mismo SID y el primero `COMPLETED` devuelve TwiML vacío y no inserta otro outbound.
- **Rollout:** deploy del backend. No depende de `MONITORING_ENABLED=true`.
- **Rollback:** revert del deploy. Las filas `provider_webhook_events` se conservan.

### Corte de PR

- **PR1:** quitar la marca prematura del archivo y cubrirla con test, incluso si el gate SQL sigue condicionado. Esto solo ya evita el agujero peor cuando el monitoreo está off.
- **PR2:** acquire siempre activo y fail-open sin marcar.

## TB-005 — Firma del inbound Twilio

- **Objetivo:** rechazar inbound no firmado, después de medir falsos rechazos.
- **Problema:** `router.post('/:flowId', receiveTwilioMessage)` no usa el middleware que el status sí usa.
- **Evidencia:** `twilio-webhook.routes.js` líneas 8–11.
- **Prioridad:** P0. **Complejidad:** media.
- **Alcance:** `TWILIO_SIGNATURE_MODE=off|log|enforce`. `log` compara y escribe un código de resultado sin el token y sin el teléfono. `enforce` reutiliza `verifyTwilioSignature`. URL pública configurable si `req` no coincide con la que Twilio firma. Tests de inbound firmado, ausente e inválido.
- **Fuera de alcance:** rotar el auth token; firmar Meta (ver TB-007b abajo, o el ítem META en este archivo).
- **Backend:** middleware y ruta. **Frontend:** no. **DB:** no.
- **Autorización:** la firma es la autenticación de esa ruta.
- **Tests:** los de `verify-twilio-signature.test.js` más la ruta `/:flowId`.
- **Riesgos:** proxy y https. Por eso `log` primero.
- **Aceptación:** en `log`, una semana de muestra sin mismatches antes de `enforce`. En `enforce`, firma mala → 403 y ninguna fila nueva de mensaje. T10.
- **Rollout:** `log` en el deploy, `enforce` con cambio de entorno.
- **Rollback:** volver a `log`. Nunca a «ignorar firma inválida y seguir» sin que el modo lo diga.

## TB-007 — Hash de contraseñas y permisos de atención

- **Objetivo:** dejar de comparar SHA-256 sin salt; separar tomar, reasignar y administrar flujos.
- **Problema:** `admin-auth.service.js` líneas 17–22. Inbox sin permiso de acción. Token sin rol = admin.
- **Prioridad:** P0 el hash. P0 el permiso antes de encender toma. **Complejidad:** media.
- **Alcance PR1 (hash):** verificar con el hash viejo; si coincide, guardar bcrypt o argon2 (elegir una librería ya aceptable para el equipo; no hay ninguna hoy, así que este PR sí agrega dependencia y debe aprobarse explícitamente). El siguiente login ya no acepta solo el hex. Sesiones vigentes siguen hasta expirar. No reset masivo.
- **Alcance PR2 (permisos):** claims `conversation.takeover` y `conversation.reassign`. Admin los tiene. El operador de conversaciones tiene takeover y no reassign, salvo configuración. Dejar de tratar ausencia de `r` como admin: esas cookies se rechazan y obligan a login. Es un corte consciente; anunciarlo.
- **Fuera de alcance:** tabla de usuarios, SSO, equipos.
- **DB:** no hace falta tabla si los usuarios siguen en entorno. El hash nuevo vive en la variable de entorno que ya usan, con prefijo de algoritmo.
- **Tests:** login con hash viejo migra; hash nuevo verifica; operador toma (cuando TB-002 exista) y no reasigna; request sin cookie 401.
- **Riesgos:** dependencia nueva. Mantener el PR de hash chico.
- **Aceptación:** un dump de la variable no es el texto plano ni un SHA-256 pelado. Un token legacy no entra como admin.
- **Rollback:** el verificador acepta ambos formatos durante una versión, así un rollback de código no deja afuera a quien ya rehasheó. Documentar esa ventana.

## META-01 — Cerrar o firmar el webhook Meta

- **Objetivo:** que `POST /webhook` no acepte payloads anónimos.
- **Problema:** ruta montada sin `X-Hub-Signature-256`.
- **Prioridad:** P0 si el puerto es público. **Complejidad:** baja.
- **Alcance:** confirmar en access logs si hay tráfico Meta. Si no hay, dejar de montar el router en producción mediante flag default off. Si hay, verificar firma antes de procesar.
- **Fuera de alcance:** migrar conversaciones Meta.
- **Aceptación:** POST sin firma no crea conversación.
- **Rollback:** flag de montaje.

## TB-003 — Versión de estado y barrera de TwiML

- **Objetivo:** el turno de bot no envía TwiML si la conversación dejó de estar en `bot` durante el procesamiento.
- **Problema:** el pipeline responde con `result.reply` sin releer status (`twilio-inbound-pipeline.js` líneas 151–160). El claim no usa `findByIdForUpdate`.
- **Prioridad:** P0. **Complejidad:** alta.
- **Alcance:**
  1. Migración nueva, número siguiente libre, solo `status_version INT NOT NULL DEFAULT 0` en `conversations`. No escribir el archivo hasta que este ticket se apruebe.
  2. Incrementar la versión en handoff, claim, return-to-bot y, luego, takeover.
  3. Al inicio del inbound, guardar versión y status. Antes de `handleOutbound` y antes de `buildTwimlMessage`, `findByIdForUpdate`. Si la versión cambió o el status no es `bot`, no insertar outbound de bot y responder TwiML vacío. El inbound ya guardado queda.
  4. El mensaje de error del `catch` también respeta esa barrera: si ya hay humano, no mandar «No pudimos procesar…».
- **Fuera de alcance:** el botón. Puede mergearse con la toma apagada.
- **Tests:** T03 con dos llamadas concurrentes simuladas, una toma la fila mientras la otra está entre motor y outbound.
- **Riesgos:** deadlocks si el panel y el webhook bloquean en distinto orden. Orden único: conversación primero, handoff después.
- **Aceptación:** después de commit de una transición a `assigned`, el turno que todavía no había enviado TwiML no lo envía.
- **Rollback:** la columna se queda. El código viejo la ignora.

## TB-002 — Takeover transaccional

- **Objetivo:** `POST /api/conversations/:id/takeover` toma desde `bot`, cola o reentrada.
- **Problema:** `claimConversation` líneas 165–170 rechaza `bot`.
- **Prioridad:** P0. **Complejidad:** alta.
- **Alcance:** el diseño de `03-conversation-lifecycle.md`. Flag `MANUAL_TAKEOVER_ENABLED`. Transacción con `findByIdForUpdate`. Handoff nuevo solo si no hay activo. No reabrir `resolved`. Limpiar `reentry_json` pendiente. Auditoría en `audit_logs`. Mensaje `system` con `event=manual_takeover`, sin Twilio. Idempotencia por mismo agente y por `clientRequestId`. 409 si hay otro dueño. 403 sin permiso.
- **Fuera de alcance:** UI, transferencia (TB-002b), matching, borrar el endpoint `claim` en el primer PR. `claim` de `waiting_human` puede delegar en el mismo servicio en el PR2 para no tener dos escrituras.
- **DB:** usa `status_version` de TB-003. Sin otra tabla.
- **Endpoints:** el POST nuevo. `GET` detalle con `canTakeover`, `statusVersion`, dueño.
- **Autorización:** `conversation.takeover`.
- **Tests:** T01, T02, T04, doble click, reentrada pendiente, handoff `pending` existente, rollback si el insert de handoff falla.
- **Dependencias:** TB-003, TB-007 permiso, TB-001 ya validado para no romper el snapshot al devolver.
- **Riesgos:** incompatibilizar el test de integración que espera 409 en `bot`. Actualizar ese test en el mismo PR, no borrar la cobertura de «sin flag sigue el 409».
- **Aceptación:** con flag on, `bot` pasa a `assigned` de ese agente y el inbound siguiente no llama al motor. Con flag off, el comportamiento actual.
- **Rollout:** flag off en el deploy, on en canary.
- **Rollback:** flag off. Filas `assigned` siguen válidas para `sendAgentMessage`.

## TB-002b — Transferencia de supervisor

- **Objetivo:** `POST /api/conversations/:id/transfer` con motivo, sin reactivar el bot.
- **Problema:** hoy enviar un mensaje reasigna en silencio (`conversation-inbox.service.js` líneas 300–303).
- **Prioridad:** P0 del diseño de exclusión, puede ser el PR siguiente a TB-002. **Complejidad:** media.
- **Alcance:** permiso `conversation.reassign`, motivo obligatorio, auditoría, 409 si la versión no coincide. Quitar la reasignación silenciosa del send: si el status es `assigned` a otro, 409, no update del dueño.
- **Fuera de alcance:** cola de «solicitudes de transferencia» entre agentes. Si hace falta, es otro ticket.
- **Aceptación:** T05. El agente no dueño no cambia `assigned_agent_id` mandando texto.
- **Rollback:** flag de transfer. No volver a habilitar el robo por envío.

## TB-004 — UI de toma

- **Objetivo:** el agente ve «Tomar conversación» en `bot`, el composer espera el 200, el conflicto muestra al dueño.
- **Problema:** `ConversationComposer.tsx` líneas 85–90 bloquean `bot` sin acción.
- **Prioridad:** P0. **Complejidad:** media.
- **Alcance:** usar `canTakeover` del GET. Botón en detalle y en la fila. Estado de carga. Evento `manual_takeover` en el timeline como nota interna, no como burbuja saliente de WhatsApp. WebSocket `conversation.assigned` ya existe: reutilizarlo. No habilitar el textarea antes de la respuesta.
- **Fuera de alcance:** rediseño de `ConversationsPage`, filtros nuevos (TB-009).
- **Tests:** `ConversationComposer` cubre `bot` con botón cuando la prop lo permite, y sin botón cuando no. Test de que un 409 deja el composer cerrado.
- **Dependencias:** TB-002.
- **Aceptación:** T01 y T16 desde la UI. Recargar muestra el mismo dueño.
- **Rollback:** el flag del backend oculta la acción. No hace falta feature flag duplicado en el build si el GET no manda `canTakeover`.

## TB-008 — Motivo de transición en shadow

- **Objetivo:** saber por qué el motor eligió un nodo, sin cambiar el texto.
- **Problema:** `default` hacia fallback no incrementa `fallbackCount`.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** persistir `transitionReason` en metadata del outbound de bot. Valores cerrados listados en `04`. Sin cuerpo de usuario. Contadores en memoria pueden quedar; la fuente para alertas es SQL.
- **Fuera de alcance:** cambiar matching, abrir handoff.
- **DB:** no hay columna obligatoria si entra en `metadata_json`. Si el volumen de JSON molesta, columna chica en un segundo PR.
- **Tests:** un `default` graba `default`; un fallback real graba `fallback`; un includes graba `includes`.
- **Aceptación:** una conversación de prueba muestra la razón en metadata y el mismo reply que antes.
- **Rollback:** dejar de escribir la clave. Los mensajes viejos no la tienen.

## TB-009 — Señales de atasco en el inbox

- **Objetivo:** ver conversaciones en bucle y tomarlas, sin derivar solo.
- **Problema:** no existe detección.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** tabla `conversation_attention_signals` (definición en `04`). Modo `off|shadow|alert`. En `alert`, filtro y badge. Desestimar señal. Acción de toma = TB-004. Umbrales en entorno.
- **Fuera de alcance:** mensaje automático «¿querés un humano?».
- **Autorización:** quien ya ve el inbox ve las señales. Desestimar: cualquier agente del inbox, auditado.
- **Tests:** tres menús iguales crean una señal en shadow y no cambian `status`. Desestimar no regenera la misma `dedupe_key`. `collect_email` esperando correo no dispara `NO_PROGRESS`.
- **Dependencias:** TB-008. La toma es independiente y puede no estar: el badge igual se muestra, la acción se oculta si `canTakeover` es falso.
- **Aceptación:** T13 y T14 en la parte de señal. Cero handoffs creados por el detector.
- **Rollback:** `STALL_DETECTION_MODE=off`. No dropear la tabla.

## TB-010 — Normalización segura del matching

- **Objetivo:** dígitos, keycaps, acentos y includes con frontera.
- **Problema:** `normalizeMessage` solo recorta y pasa a minúsculas. Includes es substring.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** flag `FLOW_MATCH_NORMALIZATION=legacy|safe`. Función compartida por motor y compile. Reglas de `04`. Fixture `inscripciones` / `si`. Fixture keycap. No fuzzy.
- **Fuera de alcance:** reescribir flujos publicados a mano. El lint (TB-011) avisa colisiones nuevas.
- **Tests:** T11, T12, y un replay mínimo de opciones del flujo de TEST, no de producción.
- **Riesgos:** una regla que dependía del substring deja de disparar. Por eso el flag y el replay antes de `safe` en producción.
- **Aceptación:** con `legacy`, los tests actuales del motor siguen verdes. Con `safe`, los fixtures nuevos pasan.
- **Rollback:** `legacy`.

## TB-011 — Lint de publicación

- **Objetivo:** el publicador ve transiciones duplicadas, includes anidados y saltos al mismo nodo.
- **Problema:** `validateVersion` compila y no informa esas colisiones.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** warnings en la respuesta de validate/publish y en el diálogo de publicar que ya existe (`PublishConfirmDialog`). No bloquear en el primer release.
- **Fuera de alcance:** impedir publicar.
- **Tests:** un documento con dos exactos iguales produce warning; uno sano no.
- **Aceptación:** publicar un flujo válido no cambia de comportamiento.
- **Rollback:** ignorar warnings en UI; el backend puede seguir calculándolos.

## TB-022 — Búsqueda de contenido usable

- **Objetivo:** encontrar una palabra en los mensajes, ver el fragmento y abrir ese punto del timeline.
- **Problema:** el `LIKE` existe y la UI no lo cuenta; no hay hit a nivel mensaje.
- **Evidencia:** `conversation.repository.js` líneas 253–264; placeholder en `ConversationFilters.tsx` líneas 74–81.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** PR1 placeholder y email si se desea. PR2 `GET /api/conversations/search` con fragmento, paginación por cursor, salto en timeline. Sin FULLTEXT hasta medir p95 > 500 ms en TEST.
- **Fuera de alcance:** búsqueda en adjuntos, multitenant.
- **Autorización:** `requireAuth`, igual que la lista. No loguear el término.
- **Tests:** acentos, frase, paginación, conversación ajena no aplica (no hay tenant), término vacío 400, timeline recibe `focusMessageId`.
- **Aceptación:** los de `05`.
- **Rollback:** quitar el endpoint nuevo. El `LIKE` de la lista puede quedar: ya está en producción de código.

## TB-020 — Recibir y mostrar adjuntos

- **Objetivo:** fotos y PDF entrantes se ven en el panel con sesión.
- **Problema:** sin texto, el webhook tira el evento (`twilio-webhook.controller.js` líneas 97–105).
- **Prioridad:** P1. **Complejidad:** alta.
- **Alcance:** tabla de attachments, descarga con auth Twilio, disco privado, GET autenticado, allowlist MIME, tope de tamaño, timeline de imagen y link de PDF. No correr el motor con body vacío. No backfill.
- **Fuera de alcance:** enviar archivos (TB-021), antivirus externo, bucket público.
- **DB:** migración nueva solo cuando el ticket se apruebe.
- **Tests:** JPEG/PNG/PDF, MIME malo, tamaño, id de otra conversación 404, nombre con path traversal, fallo de descarga no falla el mensaje de texto si venía caption.
- **Riesgos:** Twilio media URL corta. Descargar en el mismo request puede alargar el webhook; si pasa de unos segundos, encolar la descarga **en proceso** (no hace falta Redis: un trabajo después de responder TwiML) y mostrar `pending`. Preferir eso a bloquear el inbound.
- **Aceptación:** un inbound de imagen queda visible para un agente logueado y no es fetchable sin cookie.
- **Rollback:** flag `INBOUND_MEDIA_ENABLED`. Objetos ya bajados no se sirven si el flag de lectura también se apaga. No borrar el disco en el rollback.

## TB-021 — Enviar adjuntos

- **Objetivo:** el agente manda una imagen o PDF por REST con estado real.
- **Problema:** `sendWhatsAppMessage` solo manda texto.
- **Prioridad:** P1. **Complejidad:** alta.
- **Alcance:** upload al mismo storage, URL temporal para Twilio, `MediaUrl`, `clientRequestId`, errores visibles, solo en conversación tomada por ese agente.
- **Fuera de alcance:** campañas, templates, video.
- **Dependencias:** TB-020 storage, TB-002 exclusión. Si no hay forma segura de que Twilio lea el archivo, el ticket se detiene y se documenta el bloqueo. No se abre un bucket público.
- **Aceptación:** un archivo permitido produce un SID y se ve en el timeline; el reintento con el mismo `clientRequestId` no manda dos veces; fuera de ventana se ve el error del proveedor.
- **Rollback:** ocultar el control. No reintentar envíos a medias.

## TB-014 — Transporte del mensaje

- **Objetivo:** distinguir TwiML, REST e interno en lo que se persiste de ahora en más.
- **Problema:** el bot no tiene SID; el `system` es outbound en dirección y no en WhatsApp.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** `transport` en metadata o columna `twiml|rest|internal`. Rellenar en los tres escritores actuales (`persistOutboundBotMessage`, `sendAgentMessage`, `_returnConversationToBot` y el system de takeover). Métrica del `catch` cuando se emite TwiML de error sin fila, o fila `transport=twiml` `sender_type=bot` `metadata.event=webhook_error` si se decide persistir ese texto. No inventar SID.
- **Fuera de alcance:** backfill histórico perfecto. Los mensajes viejos quedan `transport` null = desconocido.
- **Aceptación:** un turno de bot nuevo guarda `twiml`; un mensaje de agente guarda `rest` y SID; un cierre guarda `internal`. T17.
- **Rollback:** dejar de leer la columna. No dropearla.

## TB-013 — Readiness

- **Objetivo:** `/readyz` falla si la base no responde o no hay flujo publicado cargable.
- **Problema:** `/health` no mira SQL y Docker lo usa de healthcheck.
- **Prioridad:** P1. **Complejidad:** baja.
- **Alcance:** `GET /readyz` sin datos de negocio. `/health` sigue siendo liveness. Cambiar el healthcheck de Compose a `/readyz` en un PR separado, después de ver que el endpoint responde en TEST.
- **Aceptación:** base caída → 503. Base y flujo ok → 200.
- **Rollback:** el compose puede volver a `/health`.

## TB-015 — Informe de la brecha de salientes

- **Objetivo:** explicar la diferencia SQL vs Twilio por día, sin declararla cerrada de antemano.
- **Problema:** octubre histórico 5.235 contra 4.211. La reconciliación actual compara SID y los TwiML no tienen.
- **Prioridad:** P1. **Complejidad:** alta.
- **Alcance:** script o job de solo lectura: usage del mes, conteos SQL por `sender_type` y `transport`, métrica de TwiML de error, SID REST faltantes. Salida en JSON/CSV interno admin. No modifica mensajes.
- **Fuera de alcance:** ajustar la factura, prorratear Meta por conversación.
- **Dependencias:** TB-014 para días nuevos. Para octubre, el informe dice «transporte desconocido» en filas viejas.
- **Aceptación:** el informe muestra las cifras y la diferencia. No rellena con ceros. T18 si se simula un fallo de insert.
- **Rollback:** apagar el job. No hay writes de negocio.

## TB-023 — Panel mensual de actividad

- **Objetivo:** año, mes, series diarias, exportación.
- **Problema:** `MonitoringPage` es salud de las últimas horas, no el mes.
- **Prioridad:** P1. **Complejidad:** media.
- **Alcance:** rollup diario, página nueva o sección nueva, zona `America/Argentina/Buenos_Aires`, CSV, `system` separado. Reutilizar auth admin y el cliente HTTP del feature `monitoring`. No reescribir `MonitoringService` entero: un módulo de rollup al lado.
- **Dependencias:** TB-014 para etiquetar estimado vs confirmado.
- **Aceptación:** dos corridas no duplican el día. Un día sin sync no es 0. CSV abre en una planilla con las columnas del gráfico.
- **Rollback:** ocultar la ruta. La tabla de rollup queda.

## TB-024 — Costos Twilio y Meta

- **Objetivo:** gasto del mes separado en base, categorías WhatsApp, total de control y recargas.
- **Problema:** no hay Usage Records. El saldo no es el gasto.
- **Prioridad:** P1. **Complejidad:** alta.
- **Alcance:** cliente backend de usage, cache corta, rate limit simple en memoria, pantalla descrita en `06`. Sin tarifas hardcodeadas. Sin sumar `totalprice` a las categorías. Sin distribuir el cargo Meta por conversación.
- **Fuera de alcance:** facturar a Tea desde esta pantalla, pagos, alertas a Slack.
- **Autorización:** admin. El browser no recibe el auth token de Twilio.
- **Tests:** fixture de usage con una categoría padre y una hija no se suma dos veces; una categoría de recarga cae en la otra sección; error de API muestra «pendiente», no cero.
- **Dependencias:** TB-023 para el shell visual. Puede mostrar costos aunque TB-015 siga abierto: la fuente del gasto es Twilio, no SQL.
- **Aceptación:** contra una respuesta fixture que reproduzca la forma de octubre (base, adicional, total), la UI muestra tres números distintos y el total de control. La corrida real contra la cuenta queda como validación de staging, no como parte del unit test.
- **Rollback:** flag de la sección de costos.
- **Riesgos:** paginación de usage y zona horaria. El ticket incluye un test de límites de mes en UTC.

## TB-012 — Sesiones SQL como autoridad

- **Objetivo:** el motor reconstruye la sesión desde SQL y `sessions.json` deja de decidir.
- **Problema:** dual write, archivo como mapa caliente (`session.service.js`).
- **Prioridad:** P1, fase 5. **Complejidad:** alta.
- **Alcance:** write-through ya parcialmente existe. Paso 1: si SQL tiene sesión y el archivo no, SQL gana. Paso 2: dejar de leer el archivo para decidir el nodo. Paso 3: dejar de escribirlo. Un solo paso por PR.
- **Fuera de alcance:** multi-región, Redis.
- **Tests:** reinicio con archivo vacío y fila SQL conserva el nodo. Dos procesos no usan un JSON local distinto como verdad. Humano `assigned` no se reanuda como bot.
- **Dependencias:** TB-006, TB-003.
- **Aceptación:** T15. Borrar `sessions.json` en TEST no cambia el siguiente turno.
- **Rollback:** cada paso es reversible mientras el write a JSON siga en el paso 1 y 2. El paso 3 solo después de un ciclo de observación.

## TB-016 — Copy de recolección de email

- **Objetivo:** una pregunta que no es un email no se responda como si el usuario hubiera fallado un formulario, o el texto explique que primero hace falta el correo.
- **Prioridad:** P2. **Complejidad:** media.
- **Alcance:** solo si TB-008 muestra volumen en `collect_email`. Cambio de copy en el flujo publicado mediante el editor existente, más un acuse corto de que la consulta quedó pendiente. No guardar el texto libre como dato sensible de más.
- **Fuera de alcance:** NLU, DNI.
- **Aceptación:** fixture de una frase natural recibe el copy nuevo y sigue sin avanzar de nodo hasta un email válido.
- **Rollback:** publicar la versión anterior del flujo. El mecanismo de versiones ya existe.

## TB-017 — Extraer el caso de uso que ya creció

- **Objetivo:** que takeover y señales no sigan agrandando `conversation-inbox.service.js` y `ConversationsPage.tsx` sin límite.
- **Prioridad:** P2, hecho **dentro** de los PR de TB-002 y TB-009, no como refactor previo.
- **Alcance:** mover la transacción de toma a un servicio que el inbox llama. Extraer el hook de acciones del page si el page suma más de un botón. Sin cambiar comportamiento en un PR vacío.
- **Aceptación:** los tests de inbox existentes siguen verdes y no hay PR que solo mueva archivos.
- **Rollback:** revert del PR de feature, no un revert de «arquitectura».

## TB-018 — Plantillas para iniciar conversación

- **Objetivo:** un envío proactivo con template aprobado, idempotente, con callback.
- **Prioridad:** P3. **Complejidad:** alta.
- **Condición:** pedido operativo escrito y fases 0, 1 y 4 en producción. Si no, no se agenda.
- **Alcance v1:** lista leída de Twilio, envío de una conversación, `ContentSid`, variables, `clientRequestId`, status. Sin editor propio y sin lote masivo.
- **Aceptación:** T19 en la forma «fuera de ventana, texto libre falla, template de prueba en cuenta sandbox no falla por ese motivo». Canary a un número interno.
- **Rollback:** flag off. No borrar templates en la consola de Twilio desde la app.

## Orden de ejecución sugerido

1. TB-001 (validar), TB-006 PR1, TB-005 en `log`, META-01.
2. TB-006 PR2, TB-007 hash.
3. TB-003, TB-007 permisos, TB-002, TB-002b, TB-004.
4. TB-008, TB-010, TB-011, TB-009.
5. TB-022, TB-014, TB-013, TB-020, TB-015.
6. TB-023, TB-024, TB-021.
7. TB-012, TB-016, TB-017 según hayan quedado.
8. TB-018 solo con demanda.
