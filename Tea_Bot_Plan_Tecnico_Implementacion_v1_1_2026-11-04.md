# TEA BOT — PLAN TÉCNICO INTEGRAL DE IMPLEMENTACIÓN

**Versión:** 1.1 · **Fecha:** 4 de noviembre de 2026  
**Destino:** planificación interna de desarrollo y auditoría · **No es material ejecutivo para Tea**  
**Estado:** propuesta técnica basada en auditoría histórica, consultas SQL de octubre, evidencia de conversaciones y diagnóstico de código. No equivale a validación contra el estado actual de producción.

## 0. Decisiones ejecutivas de ingeniería

El objetivo no es reescribir el sistema: es **hacer que ninguna consulta se pierda y que la intervención humana sea siempre posible**, preservando la seguridad, la trazabilidad y la estabilidad del motor de flujo.

1. **P0 — Toma manual inmediata por agente autorizado**, aun cuando la conversación esté en `bot`. Debe hacerse con exclusión mutua, una transición de estado auditable y suspensión efectiva del FlowEngine.
2. **P0 — Corrección del ciclo de estados y la integridad de los mensajes**: idempotencia persistida en SQL, bloqueo transaccional entre webhook y acciones del panel, validación de firmas y tests end-to-end. La corrección de reentrada post-cierre está en un trabajo separado con Cursor: no se vuelve a implementar aquí, pero sí se valida su integración.
3. **P1 — Recuperación de conversaciones estancadas**: identificar bucles, falta de progreso, fallbacks reiterados y tiempos de espera; alertar al equipo y permitir toma manual.
4. **P1 — Mejorar matching del bot sin convertirlo en un chatbot abierto**: opciones equivalentes, dígitos emoji, acentos, reglas por palabra, pruebas de regresión por versión publicada.
5. **P1 — Estado único y monitoreo real**: SQL como autoridad, memoria como caché, salud y actividad independientes de las garantías de procesamiento.
6. **P2 — Eficiencia y producto**: reconciliación de mensajes y cargos, rediseño incremental de recorridos, inbox operativo, plantillas oficiales solo cuando exista necesidad real.

**Principio de salida:** ninguna fase se considera terminada solo porque el código compile. Exigir pruebas automatizadas, prueba integrada con SQL TEST, observabilidad, release controlado y rollback.

## 1. Alcance, evidencia y límites

### 1.1 Fuentes de la propuesta

- Auditoría técnica histórica **«Tea Bot — Auditoría Técnica y Plan de Implementación»** (13 páginas): firmas webhook, idempotencia con `provider_webhook_events` / `acquireInboundProcessing`, estado JSON/SQL, monitoreo, contraseñas, CI, UX y templates.
- Presentación ejecutiva histórica (14 páginas): síntesis de riesgos y roadmap técnico.
- Consultas SQL compartidas sobre octubre 2026, `conversation_messages`, `human_handoffs` y `conversation_sessions`.
- Conversaciones reales anonimizadas: fallbacks post-cierre, menús repetidos, opciones escritas que no avanzan.
- Auditoría de código posterior: `conversation-bot-lifecycle.service.js`, `conversation-reopen.service.js`, `conversation.service.js`, `message-persistence.service.js`, `compile-flow.js`, `flow-engine.service.js` y adaptadores Twilio.

### 1.2 Evidencia cuantitativa, con alcances distintos

| Métrica | Resultado | Interpretación técnica |
|---|---:|---|
| Mensajes de usuario en SQL, oct. | 4.362 | `inbound/user/twilio` |
| Salientes bot en SQL, oct. | 3.442 | Mensajes persistidos por aplicación, transportados por TwiML según auditoría de código |
| Salientes de agentes en SQL, oct. | 769 | API REST, con SID persistido |
| Eventos salientes `system` SQL, oct. | 299 | Avisos internos de cierre; no deben contarse como mensajes WhatsApp facturados por ese camino |
| Salientes enviados identificados en SQL | 4.211 | `bot + agent`; no todos tienen SID |
| Salientes facturados en Twilio, oct. | 5.235 | Diferencia **1.024** frente al volumen saliente identificable de SQL |
| Conversaciones con mensajes de agente | 234 de 466 | No equivale a 234 resoluciones ni a tasa de conversión |
| Transiciones de nodo a sí mismo | 214 | No representan necesariamente 214 mensajes ni 214 errores |
| Gasto total Twilio septiembre | USD 45,2100 | Usage Records, cuenta consultada |
| Gasto total Twilio octubre | USD 134,5225 | Usage Records, cuenta consultada |
| Cargo WhatsApp adicional octubre | USD 80,9175 | `channels-whatsapp-template-service`: 4.203 unidades; etiqueta de facturación, no evidencia de templates `ContentSid` |

**No confundir**: `conversation-free` (1.032 en octubre) y `template-service` (4.203) son categorías del proveedor. El precio medio observado de la segunda es **USD 0,01925/evento**, no una tarifa contractual universal. No mezclar recargas de saldo con gasto devengado. Las ventanas UTC/Argentina, números/subcuentas y registros perdidos deben verificarse antes de cerrar diferencias.

### 1.3 Hallazgos comprobados y puntos aún abiertos

**Evidencia de código auditado:** el botón `Cerrar y devolver al bot` resuelve el handoff, termina sesiones, deja `status='bot'`, pone el nodo `welcome` o `collect_email` y permite que el próximo texto libre sea interpretado como respuesta a un menú que no se mostró; el resultado frecuente es `fallback_global`. La corrección ya alcanzó `READY_FOR_STAGING` con 294 pruebas PASS (según informe de Cursor) y se considera **dependencia de integración**, no nueva tarea duplicada.

**Evidencia de conversaciones:** existe un caso de 80 mensajes sin agente con reenvío reiterado de un menú frente a texto como «Periodismo Deportivo» y emojis numéricos; en otras conversaciones el bot vuelve a fallbacks luego de cerrar el operador.

**Hipótesis abiertas:** desglose exacto de los 1.024 mensajes no conciliados; porcentaje real de reintentos, TwiML sin persistencia o canales externos; proporción de transiciones repetidas que verdaderamente producen cobro. Se requiere evidencia instrumental.

## 2. Arquitectura actual y arquitectura objetivo

### 2.1 Camino relevante actual

`WhatsApp/Twilio webhook -> adapter canónico -> persistencia inbound / dedupe -> conversation + session -> FlowEngine -> TwiML outbound -> SQL/logs`.

`Panel de agentes -> inbox/conversation service -> transición handoff/estado -> Twilio REST (mensajes de agente) -> SQL + WebSocket`.

Los caminos comparten conversación y sesión, pero la auditoría anterior identificó estado en SQL + memoria + JSON y locks por proceso. Esto exige una barrera global sobre la conversación para evitar que un webhook continúe enviando una respuesta después de que un agente tomó el control.

### 2.2 Fuente de verdad propuesta

- **SQL Server**: conversación, modo bot/humano, asignación, handoff, sesión de flujo, deduplicación de webhook y auditoría de cambios.
- **Memoria**: caché reconstruible; nunca autoridad de toma manual, idempotencia o exclusión mutua.
- **Frontend**: proyección del servidor por HTTP/WebSocket, no fuente de autoridad.
- **Twilio**: autoridad del mensaje transportado y sus estados; la aplicación debe guardar correlación, no inferir envío por el simple hecho de persistir texto.

### 2.3 Máquina de estados de referencia

Estados conceptuales: `BOT_ACTIVE`, `WAITING_HUMAN`, `HUMAN_ACTIVE`, `REENTRY_PENDING` (si la corrección Cursor lo formaliza), `CLOSED/RESOLVED` como evento o estado según decisión existente. **No agregar estados arbitrarios si el esquema actual puede representar el ciclo consistentemente.**

Transiciones prioritarias:

| Estado origen | Acción | Destino | Condición / protección |
|---|---|---|---|
| BOT_ACTIVE | `agent_takeover` | HUMAN_ACTIVE | Agente autorizado; lock SQL; pausa o termina sesión bot; handoff nuevo registrado |
| WAITING_HUMAN | `claim` | HUMAN_ACTIVE | Asignación atómica; prohibido doble claim ganador |
| HUMAN_ACTIVE | `transfer` | HUMAN_ACTIVE | Transferencia auditable; cambio de dueño sin reactivar bot |
| HUMAN_ACTIVE | `return_to_bot` | REENTRY_PENDING o BOT_ACTIVE | Ejecuta corrección post-cierre integrada; no consumir siguiente texto como opción de menú |
| HUMAN_ACTIVE | `close` | Estado de cierre explícito, si existe | Distinguir semántica de cerrar vs devolver al bot; definir UX y persistencia |
| BOT_ACTIVE | `auto_escalate` | WAITING_HUMAN | Umbral de estancamiento; no respuesta simultánea del bot |
| Cualquiera | webhook duplicado | Mismo estado | Idempotencia SQL; sin efectos duplicados |

**Decisión de producto/seguridad:** un agente puede solicitar toma manual en cualquier momento, pero solo si su rol/permisos se lo permiten. «Tomar cuando quiera» no significa que cualquier usuario del panel pueda sobreescribir la atención de otro operador sin autorización.

## 3. P0-A — Toma manual inmediata desde cualquier conversación

### 3.1 Problema y comportamiento esperado

Actualmente, según auditoría de código, un agente solo puede reclamar una conversación en determinadas fases de handoff; la toma en `bot` no está disponible. Un usuario puede quedar en bucle mientras nadie puede intervenir desde el panel. Objetivo: **bot activo no debe impedir tomar la conversación**.

Escenarios de UX:

1. Un agente abre conversación marcada `bot` y pulsa **«Tomar conversación»**; el panel pasa a «Atendida por [agente]» y habilita respuesta manual.
2. Si otro agente ya la tomó, el segundo ve a quién está asignada y recibe una respuesta de conflicto; puede solicitar transferencia o usar una acción de supervisor.
3. Mientras esté en manos humanas, cada mensaje entrante se registra pero no produce menú automático.
4. El operador puede devolver el control al bot mediante el mecanismo corregido de reentrada.
5. Se conserva el historial; no se inventa ni borra una derivación anterior.

### 3.2 Diseño backend

Proponer un caso de uso **`TakeoverConversationService.take(conversationId, actorId, reason, expectedVersion?)`** independiente de la UI, reutilizando repositorios y `HumanHandoffService` cuando corresponda.

Transacción única:

1. Verificar identidad y permiso en servidor (no solo botón visible), rol, tenant y alcance de la conversación.
2. `BEGIN TRANSACTION`; leer fila `conversations` con `UPDLOCK, HOLDLOCK` (o mecanismo equivalente validado contra índice/aislamiento).
3. Resolver estado actual y evaluar si el agente ya es dueño (respuesta idempotente) o si otro agente la posee (409, o transferencia autorizada).
4. Invalidar ejecución activa de bot: actualizar estado/epoch de conversación y pausar/terminar sesión de flujo SQL. Conservación de snapshot de navegación conforme al mecanismo existente.
5. Crear/actualizar una entidad de handoff **sin reabrir silenciosamente handoffs resueltos** y asignar el agente.
6. Registrar auditoría con actor, razón, origen `manual_takeover`, estado anterior/nuevo, fecha y correlation id.
7. `COMMIT`, luego emitir evento por WebSocket; recuperación si falla WebSocket sin revertir la transacción.

**Carrera crítica:** entre la lectura del estado y el envío de TwiML, un webhook podría seguir procesando el flujo. El envío debe validar el mismo `conversation_epoch` o `state_version`/token de control antes de cerrar el turno y producir un outbound. Si el agente tomó el control, el resultado automático se descarta. La barrera debe apoyarse en SQL; no basta un `Map` en Node.

**Control de expiración:** un takeover no debe requerir que el cliente escriba de nuevo; se materializa con el click autorizado. Un caso que nunca fue derivado por el bot igualmente puede ser tomado.

### 3.3 Contratos API sugeridos (sujetos a adaptación al repo)

- `POST /api/conversations/:id/takeover` `{ reason, expectedVersion? }` → 200/201; retorna estado y agente asignado.
- `POST /api/conversations/:id/transfer` `{ targetAgentId, reason }` → privilegios de transferencia; 409 en conflicto.
- `POST /api/conversations/:id/return-to-bot` → usa policy de reentrada ya corregida.
- `GET /api/conversations/:id` → incluir `canTakeover`, `takeoverReason`, `assignedAgent`, `statusVersion` calculados por backend o en contrato de permisos.

No crear rutas paralelas si `conversation-inbox.service.js` y `conversations.routes.js` ya ofrecen superficies compatibles. Extenderlas donde sea seguro.

### 3.4 Cambios UI

- En una conversación `bot`, botón primario **Tomar conversación** visible para rol autorizado.
- Para conversación ajena en `assigned`, acción secundaria **Solicitar transferencia** o **Tomar como supervisor**, con confirmación y motivo.
- Composer bloqueado mientras el bot tenga el control, desbloqueado después del 200 del servidor; nunca desbloquearlo por estado optimista que pueda fallar.
- Estado de agente, hora de toma, indicador «Bot pausado», aviso de conflicto y actualización WebSocket a todas las pantallas abiertas.
- Historial/timeline registra la toma como **evento interno**, no como WhatsApp enviado.
- Diferenciar *tomar manualmente* de *responder sin tomar*: deshabilitar respuesta manual concurrente sin takeover.

### 3.5 Tests P0-A y aceptación

- `bot -> manual takeover -> inbound`: mensaje entrante persistido, **0 respuestas automáticas**.
- Dos agentes toman en paralelo: exactamente un ganador; el otro recibe 409 con propietario vigente.
- Takeover y webhook concurrentes: no sale respuesta automática tardía después de toma confirmada.
- Takeover repetido por mismo agente: idempotente, sin dos handoffs.
- Conversación `waiting_human`: reclamo mantiene integridad del handoff; conversación ajena transferida requiere permiso.
- Reinicio de contenedor después de toma: control humano se conserva.
- Evento de WebSocket perdido: recarga por GET muestra estado correcto.
- Intento por agente no autorizado: 403 y ninguna modificación.
- Return-to-bot: integración con corrección Cursor; primer texto libre **no cae en fallback**.

**Definition of Done:** integración con SQL TEST; tests de carrera; verificación manual con dos sesiones de agentes; rollback probado; auditoría completa.

## 4. P0-B — Seguridad e integridad del procesamiento

### 4.1 Firma del webhook Twilio

Auditoría histórica: inbound no validaba `X-Twilio-Signature`, aunque existía verificación reutilizable en callbacks. **Revalidar el estado actual** antes de cambiar: pudo haber avances desde octubre.

Plan: activar `TWILIO_SIGNATURE_MODE=log`, comparar URL efectiva del request con la registrada en Twilio, proxies Nginx, HTTPS y parámetros; medir falsos rechazos. Luego `enforce` con pruebas y rollback a `log`. No aceptar “firma inválida” silenciosa en enforce. Documentar tratamiento para pruebas locales sin comprometer producción.

### 4.2 Idempotencia always-on en SQL

Reusar `provider_webhook_events` y `acquireInboundProcessing` de migration 007. Separarlos de `MONITORING_ENABLED`: monitoreo **observa**, no habilita garantías de correctness.

Estado: `PROCESSING` adquirido → resultado `COMPLETED` al finalizar o `FAILED` retryable; reclaim seguro de leases stale; dedupe por `MessageSid` y cuenta/canal pertinente. Registrar intentos, timeouts y errores. No promover a completado antes de persistir efectos. Probar concurrencia con dos procesos, no solo en memoria. Revisar semántica de reintentos con TwiML: el mismo webhook no debe emitir mensajes duplicados.

### 4.3 Contraseñas y permisos

La auditoría anterior registró hashes SHA-256 sin salt. Confirmar la situación actual. Si sigue vigente, rehash progresivo a Argon2id o bcrypt después de login válido, sin reset masivo. Incorporar permisos granulares para takeover, transferencia, acceso a conversaciones y cambios de flujo. Auditar endpoints por IDOR y no permitir acciones fuera del alcance del agente.

### 4.4 CI indispensable

Pipeline mínimo: lint/typecheck frontend, backend tests, build y pruebas de firma/idempotencia/estados como bloqueantes de merge. Los tests con SQL real se ejecutan en entorno TEST aislado; no ejecutar migraciones de validación sobre producción.

## 5. P1-A — Detección de conversaciones estancadas y escalamiento

### 5.1 Estados operativos derivados, sin ampliar indiscriminadamente `conversations.status`

Definir `attention_signal`/alerta: `FALLBACK_LOOP`, `SAME_NODE_LOOP`, `NO_PROGRESS`, `REPEATED_MENU`, `USER_REQUESTED_HUMAN`, `UNANSWERED_HUMAN`, `OUTBOUND_FAILURE`. Son **señales**, no reemplazo del estado de atención.

### 5.2 Heurísticas iniciales configurables

- ≥3 fallbacks en los últimos 5 mensajes del usuario en una sesión.
- ≥3 transiciones al mismo nodo en una ventana de 10 minutos.
- ≥3 mensajes salientes con texto normalizado equivalente, intercalados con inbound, sin avance de nodo.
- Usuario expresa explícitamente «humano», «asesor» o «persona»: ruta directa de derivación sin reiniciar menú.
- `outbound_failed` o webhook con error de persistencia: evento operacional, no mensaje automático de texto libre.

Umbrales **propuestos**, no medidos como óptimos. Validarlos primero en modo shadow contra sesiones reales. Detectar menús repetidos aunque el contador `fallbackCount` sea cero: la auditoría halló que `default -> fallback_global` puede no incrementar ese contador.

### 5.3 Política de respuesta

Fase inicial: registrar alertas y mostrarlas en inbox, sin alterar el flujo. Fase siguiente: si se confirma el estancamiento, ofrecer «¿Querés hablar con una persona?» una sola vez; al aceptar, abrir handoff, pausar bot. Para fallas sistemáticas graves, permitir cola prioritaria de revisión humana, sin asignación forzada masiva. **Siempre existe toma manual desde cualquier estado del bot**, independientemente de que la detección automática esté habilitada.

### 5.4 Modelo de datos

Preferir tabla `conversation_attention_signals` con `id`, `conversation_id`, `session_id`, `kind`, `severity`, `source`, `occurred_at`, `resolved_at`, `metadata_json`, `dedupe_key`, o adaptar estructura de eventos existente. Índices para filtro de alertas activas. Retención y anonimización: no guardar cuerpo completo del mensaje en estas señales.

### 5.5 Criterios de aceptación

La conversación de 80 mensajes sin agentes debe activar al menos una señal reproducible en replay. Un usuario normal que navega y vuelve al menú voluntariamente no debe disparar una derivación automática injustificada. Alertas cerradas/desestimadas no se regeneran indefinidamente por el mismo evento. Inbox y panel muestran antigüedad y responsable.

## 6. P1-B — Motor de matching, navegación y contexto

### 6.1 Problemas confirmados

Normalización actual de matching: `trim` y minúsculas; no resuelve acentos ni keycaps (`1️⃣`, `2️⃣`). `matchIncludes` usa substring sin frontera de palabra: por ejemplo `si` puede coincidir dentro de `inscripciones`. Las reglas exactas y `matchAny` tienen precedencia sobre includes y default, pero hay riesgo de ambigüedad y de autorespuestas desde el mismo nodo.

### 6.2 Correcciones controladas

1. Canonicalizar Unicode (NFKC/NFD según test), eliminar diacríticos solo para comparación de opciones, convertir keycap emoji a dígitos y manejar espacios repetidos. Preservar el texto original para auditoría.
2. Detectar opciones enumeradas a partir de variantes seguras: `2`, `2️⃣`, `opción 2`; **no** usar coincidencia por substring sin límites.
3. `matchIncludes` con frontera de palabra, longitud mínima y excepción explícita para opciones de dominio, con tests de falsos positivos.
4. Analizar colisiones de reglas al publicar un flujo: exactos duplicados, includes ambiguos, transiciones default a sí mismo, nodos terminales mal configurados.
5. Mantener los comandos globales (`menú`, `atrás`, `humano`) separados del matching local; registrar precedencia y resultado.
6. Instrumentar motivo de transición: `exact`, `matchAny`, `includes`, `default`, `global`, `fallback`, `stay_on_node`.

### 6.3 Suite de replay

Convertir las conversaciones anonimizadas en fixtures por versión histórica. Caso de 80 mensajes: intentar “Periodismo Deportivo”, variantes con acentos/capitalización y emoji `2️⃣`; esperar avance al nodo pertinente, no 10 repeticiones del mismo menú. Caso post-cierre: suite desarrollada por Cursor y ejecutada también contra cambios futuros. Fixture para `inscripciones` que **no** debe activar `si` por substring accidental.

### 6.4 UX de la conversación inicial

`collect_email` hoy puede responder «correo inválido» a una consulta natural. Mejorar microcopy y, si la arquitectura lo permite, guardar `initial_intent`/resumen transitorio seguro hasta completar contacto. El correo puede ser requisito, pero el bot no debe parecer que ignora la pregunta. No almacenar innecesariamente DNI ni datos sensibles en tracking.

## 7. P1-C — Persistencia de sesiones, concurrencia y ciclo de vida

### 7.1 SQL fuente de verdad

Transicionar de `sessions.json`/memoria a SQL write-through; conservar lectura dual solo durante migración; una vez estabilizado, retirar la autoridad de JSON. Definir migraciones, índices e invariantes: máximo una sesión de flujo activa por conversación cuando corresponda, handoffs coherentes con estado y owner, versionado optimista/epoch para evitar escrituras obsoletas.

### 7.2 Handoff y reentrada

Integrar el arreglo de Cursor sin duplicarlo. Validar los contratos siguientes:

- Al cerrar o devolver al bot, la aplicación no consume el próximo texto como respuesta de menú no presentado.
- El operador puede **tomar** cualquier conversación bot y devolverla al bot de forma segura.
- Las operaciones de takeover/cierre/retorno se serializan frente al inbound mediante lock transaccional y versionado.
- Handoff `pending`/`assigned` sigue bloqueando la respuesta automática.
- `close` vs `return-to-bot`: definir semántica distinta si el producto necesita ambas; no dejar dos nombres para la misma acción sin explicarlo.

### 7.3 Endpoints operativos

`/livez`: proceso vivo. `/readyz`: conectividad DB, flujo publicado cargable y configuración crítica. Endpoint de actividad: último inbound recibido, procesado y fallido; último outbound emitido; tasa de TwiML y REST; último callback; cola/edad de solicitudes humanas.

## 8. P1-D — Observabilidad y conciliación de costos

### 8.1 Registro de mensajes

`bot` usa TwiML y SQL no posee SID en `provider_message_id`; `agent` usa REST y guarda SID; `system` puede ser solo evento interno. Separar **mensaje mostrado** de **mensaje efectivamente transportado** y persistir `transport = twiml|rest|internal`, `delivery_status`, `correlation_id`, `inbound_provider_sid`, `flow_key`, `flow_version`, `node_key`, `created_by` y `billable_candidate` (heurístico, nunca contabilidad oficial).

No inventar un SID para TwiML ni unir callbacks por texto/timestamp de manera riesgosa. Evaluar un mecanismo oficial de correlación de respuestas TwiML y callbacks si el proveedor lo soporta en el canal configurado; si no, reportar explícitamente la falta de correlación y medir tasa de persistencia, no fingir precisión.

### 8.2 Diferencia de 1.024 salientes

Plan de conciliación: (a) verificar Account SID/subcuentas/números; (b) alinear zona horaria UTC y límites del mes; (c) registrar cuántas respuestas TwiML se emitieron y cuántas se insertaron en SQL; (d) inspeccionar errores `safeRun` y TwiML de error del controlador; (e) conciliar REST de agentes por SID; (f) reconciliar resúmenes por día/categoría. No tratar `system=299` como cargos. Definir tolerancia explícita y alarma por desvíos.

### 8.3 Precios y reportes

El reporte debe mostrar dos conceptos por separado: **USD 0,005 por mensaje Twilio** en datos observados y cargos de WhatsApp por categoría de Meta/Twilio. Octubre tuvo base USD 53,605 y adicionales USD 80,9175, total USD 134,5225. La categoría de cargo extra no demuestra uso de templates ContentSid. Tarifas y categorías pueden cambiar: extraerlas de usage records/facturas y no hardcodear un valor de Meta para todas las conversaciones.

Métricas sugeridas: gasto diario y mensual; costo por conversación (estimado, con bandera de calidad); salientes bot/agent; mensajes gratuitos/facturados; top nodos de emisión; fallbacks; autorrepeticiones; cierres y reingresos; tiempo hasta primera respuesta humana; pendientes y edad de cola; errores de entrega. Alertas por gasto diario, saldo bajo y anomalías de volumen; thresholds configurables por cliente.

### 8.4 Seguridad de datos y logs

No copiar teléfonos, emails, DNI ni cuerpo completo de mensajes en eventos operativos. Redactar/mascar PII. Restringir vistas de auditoría y facturación por rol. Definir retención coherente con requisitos contractuales y no imprimir tokens Twilio.

## 9. P2 — UX del inbox y arquitectura de producto

- Inbox con filtros `bot`, `espera de agente`, `asignada a mí`, `asignada a otro`, `estancada`, `error de entrega`, `sin respuesta`, `reentrada`.
- Fila compacta con último evento, antigüedad, motivo de alerta, asignación y acción **Tomar conversación**; no obligar a abrir menú o llegar al final del flujo.
- Pestaña de detalles con eventos de takeover/transfer/close e historial sin sobrecargar chat.
- Acceso controlado para supervisores a conversaciones de otros agentes; transferencias con trazabilidad.
- Separar responsabilidades excesivas de `ConversationsPage`, `ConversationEditorPage` y `MonitoringService`; extraer servicios/hook solo cuando la nueva feature lo justifique; no reescribir todo el frontend.
- Mantener adapter canónico Twilio, repositorios SQL y mecanismo de publicación por versiones.

## 10. P2/P3 — Inicio proactivo y Twilio Content Templates

La auditoría histórica propone iniciar conversaciones fuera de la ventana de atención mediante templates oficiales aprobados: `ContentSid`, variables, tracking de entrega e idempotencia por `clientRequestId`. **Es una funcionalidad futura diferente de las respuestas hardcodeadas del FlowEngine** y no es requisito para corregir bugs ni reducir cargos del tráfico existente.

Mantenerla como etapa condicionada a: firma/idempotencia robustas, estados fiables, costo medible y demanda operativa confirmada. V1: aprobación en Twilio Console, catálogo local sincronizado, validación previa, envío idempotente, StatusCallback y policy de respuesta que ingrese a humano o flow. No hacer campañas masivas ni editor propio de templates en esta fase.

## 11. Roadmap de entregas y dependencias

| Entrega | Prioridad | Contenido | Dependencia | Gate de salida |
|---|---|---|---|---|
| R0 — Integrar arreglo de Cursor | Integración inmediata | Validar reentrada post-cierre, tests y rollout | Diff y pruebas Cursor | E2E post-cierre y rollback |
| R1 — Takeover manual | P0 | API, permisos, lock SQL, botón, auditoría y WebSocket | Invariantes de R0 | Dos agentes + webhook concurrente, no doble reply |
| R2 — Seguridad/correctness | P0 | Firma Twilio log→enforce, idempotencia SQL always-on, CI y permisos | Migration 007 validada | Reintentos y firmas testeados con DB TEST |
| R3 — Señales de atasco | P1 | Detección shadow, métricas, alertas en inbox | Correlación mínima de flujo | Replay caso 80 mensajes y falsos positivos medidos |
| R4 — Normalización/matching | P1 | Unicode, emoji, include seguro, lint de flujo, fixtures | Tests versión publicada | No loops por opciones válidas; sin colisiones nuevas |
| R5 — Sesiones y monitoreo | P1 | SQL SoT, dual-read cutover, readiness, activity | R1/R2 robustos | Restart, concurrencia y reconciliación pasan |
| R6 — Reporte consumo | P1/P2 | Twilio usage API, clasificación de transportes, diff diaria | Trazabilidad de R5 o instrumentación previa | Salientes conciliados o desvío explicado |
| R7 — Optimización UX | P2 | Menús, reentrada contextual avanzada, inbox y flujos | R3/R4 métricas | Menos repetición sin caída de éxito |
| R8 — Outbound templates | P3 | Plantillas aprobadas y primer mensaje proactivo | R2/R5/R6 | Rollout canary + aceptación |

**Paralelización:** R1 puede comenzar junto con firma/idempotencia en ramas separadas, pero ninguna acción de takeover se activa en producción sin un mecanismo consistente de exclusión y deduplicación. R3 puede medirse en shadow antes de R4; R6 requiere captura de datos confiable.

## 12. Plan de despliegue sin pérdida de conversaciones

1. Crear ambiente TEST con copia **anonimizada** de esquema y datos representativos, cuenta Twilio de prueba o harness que capture TwiML y REST sin entregar mensajes reales.
2. Identificar estado real de migraciones y flags antes de tocar código. Registrar baseline (tasas de fallback, salientes, handoffs, errores, gasto).
3. Migraciones forward-only, transaccionales cuando sea viable; índices antes de carga; versiones de aplicación compatibles con esquema viejo/nuevo.
4. Deploy del backend con features nuevas OFF; verificar `/readyz`, DB, recepción y firma en `log`.
5. Activación canary por agentes/números autorizados o porcentaje controlado, primero takeover; observación de conflictos, salientes automáticos después de toma y fallos de escritura.
6. Activar detección de estancamiento en shadow y luego alertas; **no** escalamiento automático sin validar falsos positivos.
7. Activar normalización después de replay del flujo publicado; rollback por flag a matching anterior.
8. Monitorear durante y después del rollout: inbound recibido/procesado, mensajes duplicados, errores de estado, duración de cola, reclamos y consumo.

**Rollback:** flag `MANUAL_TAKEOVER_ENABLED=false` oculta nueva acción y deshabilita API, **sin revertir** conversaciones ya tomadas; siguen siendo `assigned` y deben atenderse con funcionalidad existente. Mantener posibilidad de devolver al bot. Si la nueva persistencia agregó columnas, evitar drop en rollback. R0 reentrada tiene su propio tratamiento de `reentry_pending` para no dejar estados huérfanos. Para firmas, `enforce -> log` en emergencia; nunca exponer secreto para resolverlo.

## 13. Matriz de pruebas de integración y regresión

| ID | Test | Condición de éxito |
|---|---|---|
| T01 | Bot activo, takeover manual | `assigned` y bot detenido sin exigir handoff previo |
| T02 | Dos agentes simultáneos | Un dueño, sin asignaciones dobles |
| T03 | Inbound simultáneo al takeover | Sin TwiML del bot posterior a takeover confirmado |
| T04 | Agente sin permiso | HTTP 403, estado intacto |
| T05 | Transferencia autorizada | Cambia agente y registra auditoría |
| T06 | Devolver al bot tras takeover | Reentrada R0 correcta, sin fallback falso |
| T07 | Repetir `MessageSid` | Un único procesamiento y efecto |
| T08 | Crash entre acquire y commit | Reclaim sin pérdida ni duplicación |
| T09 | `MONITORING_ENABLED=false` | Idempotencia sigue activa |
| T10 | Firma inválida en enforce | 403 y cero procesamiento |
| T11 | `1️⃣`, `2️⃣`, `sí`/`si` | Mismo destino que opción equivalente aprobada |
| T12 | `inscripciones` con regla `si` | No dispara falso positivo |
| T13 | Replay de conversación de 80 mensajes | Detecta bucle; matching corregido avanza |
| T14 | `fallback_global` repetido | Señal y recuperación sin spam infinito |
| T15 | Reiniciar contenedor durante handoff | Persistencia y propietario correctos |
| T16 | WebSocket perdido | GET refleja estado real |
| T17 | `system` cierre | Auditoría SQL sin mensaje WhatsApp nuevo |
| T18 | TwiML sin inserción SQL | Evento de fallo y contabilidad de discrepancia |
| T19 | Fuera de ventana 24h con texto libre | Proveedor/policy rechaza o exige template según reglas vigentes |
| T20 | Rollback con takeover activo | Conversación humana sigue atendible |

## 14. Observabilidad mínima / indicadores de éxito

**SLO propuestos para acordar, no compromisos actuales:** cero respuestas automáticas posteriores a un takeover confirmado; cero doble envío por webhook reintentado; ninguna conversación marcada como humana sin owner elegible o cola identificable; alertas operativas por bucles reiterados; divergencia de salientes explicada y reducida.

**KPIs mensuales recomendados:** proporción de consultas con intervención manual; tiempo hasta que un agente toma una conversación estancada; episodios de fallback por 100 inbound; sesiones con autorrepeticiones; tasa de abandono (definir método antes de reportar); tiempo a resolución humana; costo oficial Twilio/Meta; ahorro efectivamente verificado, no proyectado.

**Panel operativo mínimo:** proceso vivo, DB lista, flow válido, último inbound recibido, último inbound procesado, último fallo, cola pendiente, conversaciones con alerta, mensajes salientes por transporte, balance/consumo y diferencia SQL vs Twilio.

## 15. Backlog desglosado para ejecución

| Ticket | Prioridad | Cambio concreto | Entregable |
|---|---|---|---|
| TB-001 | P0 | Diagnóstico integración cierre Cursor + contrato de reentrada | E2E verde y decisión formal de close/return |
| TB-002 | P0 | Use case takeover + permiso servidor | Servicio transaccional + endpoint |
| TB-003 | P0 | Serializar takeover vs inbound y sync sesión | Lock/epoch + tests concurrencia |
| TB-004 | P0 | UI takeover, conflicto, auditoría, WebSocket | Inbox funcional y consistente |
| TB-005 | P0 | Firma webhook Twilio | log→enforce con validación proxy |
| TB-006 | P0 | SQL dedupe always-on, sin gate monitoring | Lease/idempotencia y tests DB |
| TB-007 | P0 | Validar hashes y permisos de administrador | Migración de hashing y RBAC si aplica |
| TB-008 | P1 | Instrumentación transiciones y loop detection shadow | Métricas por nodo/sesión |
| TB-009 | P1 | Alertas de conversación estancada + inbox | Cola de revisión humana |
| TB-010 | P1 | Matching Unicode, emojis y boundaries | Motor + fixtures por versión |
| TB-011 | P1 | Lint publicación de flujos | Colisiones/aristas peligrosas reportadas |
| TB-012 | P1 | SQL fuente de verdad sesiones | Migración + cutover controlado |
| TB-013 | P1 | Liveness/readiness/activity + logs estructurados | Dashboard técnico |
| TB-014 | P1 | Distinguir outbound TwiML/REST/internal | Eventos + métricas por transporte |
| TB-015 | P1 | Conciliar 1.024 salientes faltantes | Informe diario de diferencias |
| TB-016 | P2 | Simplificar menús y initial intent | UX del flujo medible |
| TB-017 | P2 | Separar servicios/pages demasiado grandes | Refactor acotado, tests |
| TB-018 | P3 | Plantillas oficiales de inicio proactivo | V1 con flags y tracking |

## 16. Riesgos, límites y decisiones pendientes

**Riesgos P0:** race entre toma y mensaje TwiML ya resuelto, doble claim, permisos demasiado amplios, falla de estado runtime después del commit, despliegue de firma con URL errónea, incompatibilidad entre corrección Cursor y takeover.

**Riesgos P1:** falsos positivos de detección de bucles, cambio de matching que altere reglas existentes, sesiones históricas sin snapshot consistente, contabilidad incompleta de transportes, registros con PII en logs.

**Decisiones técnicas previas a codificar R1:** confirmar nombres reales de `status`, endpoint de claim existente, manejo del handoff no solicitado, transacción/repositorio que soporta `UPDLOCK`, tratamiento de mensajes pendientes del bot, mecanismo de autorizaciones y estado que dejó Cursor tras implementar reentrada. Resolverlas inspeccionando el repositorio; **no asumir que el esquema propuesto ya existe**.

**Decisiones de producto que afectan implementación:** qué roles pueden tomar; si supervisor puede quitar una conversación a otro agente; si takeover requiere motivo; prioridad/horario de alertas; cuándo una conversación se considera resuelta; política de devolución al bot y ventana de continuidad.

## 17. Secuencia sugerida de trabajo del equipo técnico

**Bloque 1 — Protección operacional:** cerrar e integrar R0 de Cursor, levantar SQL TEST, construir pruebas de concurrencia y R1 de takeover manual. Permitir control humano a demanda sin degradar el bot.

**Bloque 2 — Garantía de entrega:** R2 firmas e idempotencia en producción controlada; verificar recovery ante retries/crash; habilitar CI y RBAC.

**Bloque 3 — Recuperación inteligente sin IA:** instrumentar y activar señales de estancamiento, arreglar matching y pruebas con conversaciones reales, mejorar la experiencia de inicio y transferencia.

**Bloque 4 — Plataforma medible:** SQL autoridad de sesiones, panel de actividad, conciliación Twilio y reporte de gastos, reducción de mensajes redundantes guiada por datos.

**Bloque 5 — Evolución opcional:** outbound proactivo con Content Templates oficiales y refactors de mantenimiento, después de estabilizar garantías de operación.

## 18. Cierre técnico

El hallazgo de producto más urgente después de la corrección post-cierre no es un nuevo tipo de nodo ni una integración externa: es la incapacidad de un agente de **recuperar inmediatamente una conversación que el bot no está resolviendo**. El camino correcto es un takeover transaccional con protección de concurrencia y permiso servidor, complementado con detección de atasco y revisión humana.

La auditoría histórica sigue siendo válida como base del hardening (firmas, idempotencia, sesiones, monitoreo y CI), pero el nuevo orden responde a incidentes reales. No se recomienda migrar a microservicios, Redis o IA conversacional para resolver estos problemas. La calidad del cambio debe evaluarse por invariantes cumplidas, pruebas de regresión y mejora de métricas reales, no por cantidad de código modificado.

---

**Estado de la evidencia:** la auditoría posterior no pudo conectarse a SQL Server local; los resultados SQL son los compartidos desde el entorno consultado por el usuario. El código de Cursor de la corrección P0 debe evaluarse sobre su diff final antes de asumir que está desplegado. Las rutas, nombres de flags y tablas propuestos en este plan son **diseño recomendado**, no afirmación de que ya existan.


# ACTUALIZACIÓN V1.1 — Requisitos operativos, inbox multimedia, búsqueda y costos

**Origen:** requerimientos del equipo del 4/11/2026 y referencia visual del panel de costos de Dinamic Operations. **Alcance:** extensión de la auditoría y del backlog; no se consideran funcionalidades existentes ni verificadas en Tea Bot hasta contrastar el repositorio y el entorno.

## 19. Requisitos nuevos, prioridad y dependencias

| ID | Prioridad | Requisito | Dependencia crítica | Resultado medible |
|---|---|---|---|---|
| TB-019 / OPS-01 | P0 | Toma manual por agente autorizado desde conversación `bot`, `reentry_pending` o cualquier menú, sin esperar derivación | Integridad de estados, RBAC y lock SQL; coordinar con R0 | El agente toma control, se detiene el bot y se registra auditoría |
| TB-020 / MEDIA-01 | P1 | Recibir y visualizar fotos, capturas, documentos y adjuntos en inbox | Webhook media, almacenamiento privado, autorizaciones | Agente abre archivo con acceso controlado |
| TB-021 / MEDIA-02 | P1 | Enviar fotos/documentos desde el composer | Reglas WhatsApp, ventana de 24h, carga, Twilio MediaUrl y callbacks | Envíos validables con progreso y resultado |
| TB-022 / SEARCH-01 | P1 | Buscar contenido por palabras clave en mensajes y conversaciones | Índices SQL, paginación y RBAC | Buscar texto, ver coincidencia y saltar al mensaje |
| TB-023 / MON-01 | P1 | Panel mensual de volumen de WhatsApp, serie diaria, filtros y exportación | Eventos persistidos + conciliación UTC/AR | Totales y gráfico diario reproducibles |
| TB-024 / FIN-01 | P1 | Mostrar importe real separado por Twilio / Meta, sin doble contabilización | Usage Records API + conciliación + calidad de costos | Costos reales y cobertura visibles por mes |

### Criterio transversal

Un mensaje visualizado en el chat, un mensaje facturado y un evento interno son entidades distintas. No contar `system` internos como WhatsApp, no atribuir cargos Meta a un mensaje concreto sin conciliación y no presentar solo `Message.price` como total pagado.

## 20. OPS-01 — Intervención humana inmediata

**UX:** botón `Tomar conversación` disponible en conversaciones atendidas por bot y elegibles para el rol del agente. Si hay otro agente asignado, no permitir apropiación silenciosa; una acción de supervisor `Reasignar` con motivo y auditoría será independiente. Deshabilitar correctamente durante la operación, pero validar permisos en el backend. Debe funcionar desde lista y detalle, incluso cuando un usuario está atascado.

**API sugerida:** `POST /api/conversations/:id/takeover` con `clientRequestId` idempotente y motivo opcional/obligatorio según política. Contrato exacto a definir leyendo endpoints existentes. **Transacción:** validar RBAC y estado bajo `UPDLOCK`; resolver o cerrar reentry pendiente de manera segura; crear/actualizar handoff y asignación; pausar sesión automática; actualizar estado de conversación; escribir evento de auditoría; confirmar una vez. El motor debe volver a comprobar estado antes de emitir TwiML y antes de sincronizar cursor. Una respuesta TwiML ya aceptada antes del takeover es una carrera residual a documentar.

**Tests críticos:** bot en welcome; bot en menú intermedio; fallback repetitivo; reentrada `pending` y `awaiting_choice`; agente concurrente; doble clic; handoff existente; usuario sin permiso; supervisor; webhook in-flight; rollback. **Aceptación:** un takeover confirmado produce a lo sumo una asignación activa, sin respuesta automática posterior iniciada tras el commit, sin borrar mensajes ni perder la trazabilidad del nodo anterior.

## 21. MEDIA-01 / MEDIA-02 — Archivos y contenido multimedia

**Entrada:** inspeccionar el parsing canónico Twilio de `NumMedia`, `MediaUrlN`, `MediaContentTypeN` y referencias a adjuntos. Persistir metadata por adjunto (mensaje, índice, MIME, tamaño, nombre seguro, ID del proveedor, estado de descarga, almacenamiento interno y auditoría), sin guardar URL de Twilio como enlace público permanente. Descargar mediante backend autorizado, con límite de tamaño, allowlist de MIME, timeout, reintentos y aislamiento de errores; almacenar en servicio privado con retención coherente. Ver imágenes y documentos desde el chat con vista previa, indicadores de carga y descarga autenticada. Cuidado especial con DNI y documentos de alumnos.

**Salida:** validar extensión/MIME/tamaño antes de cargar; exigir permisos de operador y ventana de WhatsApp compatible; subir archivo a almacenamiento privado o mecanismo de MediaUrl accesible por Twilio mediante URL temporal segura; enviar vía API REST con `MediaUrl`, correlacionar `MessageSid`, delivery, errores y costo. No subir archivos a un bucket público ni exponer credenciales. Mantener `Body` opcional y evitar envíos duplicados con `clientRequestId`.

**Pruebas:** JPEG/PNG/PDF válidos, archivos grandes, formatos bloqueados, media inexistente, URL vencida, caída de almacenamiento, permisos cruzados, envío fuera de ventana, reintentos, XSS en nombre de archivo y controles de retención. **Aceptación:** el agente puede ver y enviar medios permitidos y el sistema refleja éxito/error real, sin filtrar contenido entre conversaciones.

## 22. SEARCH-01 — Buscador de contenido de mensajes

**Función:** búsqueda global y dentro de la conversación; coincidencias en cuerpos de mensajes con filtro de fecha, emisor y estado; resultados paginados con fragmento resaltado, conversación, fecha y salto a posición exacta del timeline. Separar búsqueda por teléfono/contacto de búsqueda por contenido. Respetar autorización por usuario/equipo y no devolver mensajes de otras empresas.

**Backend:** revisar volumen y tipo de `conversation_messages.body`; evaluar índice `FULLTEXT` de SQL Server en columnas compatibles y claves adecuadas antes de usar `LIKE '%texto%'`. No crear un full scan sin paginación en producción. Consultas parametrizadas, normalización acentos/Unicode, orden estable por fecha e ID y límites de longitud. No registrar términos sensibles en logs. **Tests:** español/acento, una frase, paginación, coincidencia exacta, permisos, textos largos, carga con miles de mensajes y navegación al resultado.

## 23. MON-01 — Dashboard mensual de actividad

**Referencia de UI:** mantener la lógica visual de la imagen proporcionada de Dinamic Operations: encabezado, filtros arriba, tarjetas KPI, gráfico temporal, tabla de desglose y exportación CSV. Adaptar a Tea Bot, sin traer entidades de Dinamic Clean que no correspondan.

**Filtros:** año, mes, dirección `inbound/outbound`, origen `bot/agent`, estado de entrega y número/cuenta Twilio cuando aplique. Zona de presentación `America/Argentina/Buenos_Aires`, junto con nota de corte UTC del proveedor.

**Indicadores:** mensajes entrantes, salientes bot, salientes agente, enviadas/entregadas/leídas/fallidas según disponibilidad, conversaciones activas, conversaciones con humano, fallbacks y mensajes repetidos; línea o barras de mensajes por día (idealmente series inbound/bot/agent) y tabla por día exportable. Los eventos internos `system` deben quedar diferenciados y excluidos del total facturable. Mostrar hora de última sincronización, cobertura y período incompleto, y no etiquetar datos faltantes como cero.

**Modelo:** agregación diaria desde SQL; reconciliar contra Usage Records y status callbacks sin multiplicar filas por actualizaciones de delivery. Precomputar materializaciones/snapshots si la performance lo requiere. Jobs idempotentes, observables y sin dependencia de MONITORING_ENABLED para correctness.

## 24. FIN-01 — Costos reales Twilio + Meta / WhatsApp

La pantalla de referencia advierte que `Message.price` solo representa la tarifa de canal y **no incluye los cargos adicionales del proveedor Meta**. No copiar ese total como si fuera gasto completo. El panel debe separar:

1. **Twilio base:** entrantes y salientes, con precio confirmado por mensaje cuando corresponda.
2. **WhatsApp / Meta:** categorías de Usage Records, incluyendo `channels-whatsapp-template-service` y `channels-whatsapp-conversation-free` según nomenclatura real del proveedor, sin presumir que el bot usa plantillas aprobadas por el nombre de la categoría.
3. **Total facturado por proveedor:** `totalprice` como valor de control, nunca sumado otra vez a las subcategorías.
4. **Saldo y recargas:** mostrar en sección diferenciada; una recarga de saldo no es otro gasto de consumo.

**Datos de referencia octubre 2026:** USD 53,605 base; USD 80,9175 adicional WhatsApp; USD 134,5225 total, según consulta del usuario. Los 4.203 eventos adicionales promediaron USD 0,01925, **promedio observado, no tarifa garantizada**. Distinguir estimado de confirmado y exponer reglas de asignación/conciliación. Si no es posible imputar el cargo Meta por conversación individual, mostrarlo como costo agregado y no distribuirlo ficticiamente.

**Visualización:** total USD por mes, comparación con mes anterior, desglose Twilio/Meta, barras de gasto por día si el proveedor soporta granularidad, mensajes por día, costo promedio por mensaje calculado con denominador explicitado, exportación CSV y alertas configurables por gasto. Registrar moneda, corte horario, fecha de sincronización, errores de API, paginación y discrepancias con SQL. Cuentas o números múltiples necesitan segmentación clara.

**Seguridad:** credenciales de Twilio solo backend, privilegios mínimos, caché y rate limiting; ninguna llamada directa desde navegador a Account API.

## 25. Secuencia incremental y definición de terminado

**Release 1 — OPS-01 (P0):** integrar la implementación P0 de reentrada `READY_FOR_STAGING` tras sus pruebas finales, luego construir takeover manual transaccional. No asumir que ya está desplegada. Dependencia explícita con `reentry_json` y migración 008. Validación de doble toma, role checks y webhook concurrente.

**Release 2 — MEDIA y SEARCH (P1):** auditoría de adjuntos actuales, metadata y almacenamiento; primero recibir/ver, después enviar; búsqueda con índices y permisos. Cualquier funcionalidad de envío está condicionada a las políticas y ventanas de WhatsApp.

**Release 3 — MON y FIN (P1):** instrumentación de mensajes por transporte, conciliación con Usage Records, dashboard mensual y gráfico diario, importes confirmados/estimados, exportación CSV y alarmas de costo. Retener separación entre cobros por mensajes y recargas.

**Release paralelo — hardening P0/P1:** no postergar firma de Twilio, SQL idempotencia always-on, hashing de credenciales, reconciliación de salientes TwiML vs REST y transacciones de persistencia. Pueden avanzar en ramas separadas con tests de integración y release gates.

**Definición global de terminado:** cambios revisados con diff, pruebas unitarias + integración SQL TEST, seguridad/RBAC, manejo de fallos, métricas, documentación, prueba manual end-to-end, despliegue gradual y rollback. `README` y ejemplos de API actualizados; no declarar producción validada por tests locales únicamente.
