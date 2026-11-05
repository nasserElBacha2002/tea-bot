# Monitoreo y costos

## Qué hay hoy

`GET /api/monitoring/overview` (admin) alimenta `MonitoringPage`. Es un tablero de salud:

- proceso, base, flujo publicado, último procesado
- cuenta Twilio, saldo, severidad, días estimados
- sender de WhatsApp
- conteos de mensajes a 15, 60 y 24 horas
- entregas, lecturas y códigos de error cuando hay callback
- jobs de retención y de reconciliación de SID
- incidentes recientes

El cliente de Twilio usado por monitoreo consulta cuenta, balance y senders. No hay Usage Records. No hay filtro año/mes, serie diaria, CSV, comparación contra el mes anterior ni split Twilio / Meta.

La reconciliación existente compara SID listados por la API de mensajes contra `provider_message_id` en SQL (`monitoring.service.js`, alrededor de las líneas 172–200). Un outbound por TwiML casi nunca tiene SID en `persistOutboundBotMessage`. Esa reconciliación, por construcción, ve los REST de agentes y no cierra la brecha de octubre.

`Message.price` no se muestra como total del mes. Tampoco debe empezar a mostrarse así.

## Línea base histórica de octubre 2026

Fuente: plan v1.1, consultas que esta auditoría **no repitió**.

| Dato | Valor | Uso |
|---|---|---|
| Inbound usuario SQL | 4.362 | Referencia de volumen |
| Outbound bot SQL | 3.442 | Persistidos por la app, transporte TwiML |
| Outbound agente SQL | 769 | REST con SID |
| `system` SQL | 299 | Eventos internos, no WhatsApp de ese camino |
| Bot + agente | 4.211 | Salientes identificables |
| Salientes facturados Twilio | 5.235 | Diferencia 1.024 |
| Cargo WhatsApp adicional | USD 80,9175 | Categoría de usage, no prueba de `ContentSid` |
| Base observada | USD 53,605 | No hardcodear como tarifa |
| Total octubre | USD 134,5225 | `totalprice` de control |
| Unidades del cargo extra | 4.203 | Promedio observado USD 0,01925, no tarifa contractual |
| Septiembre total | USD 45,2100 | Comparación histórica |

Hipótesis abiertas, en este orden de investigación:

1. TwiML del `catch` del webhook (`No pudimos procesar tu mensaje…`) facturado y no insertado como mensaje de bot.
2. Otros números o subcuentas en el mismo Account SID.
3. Corte de mes UTC del proveedor contra días Argentina.
4. Reintentos de Twilio contados en usage y dedupeados en SQL, o al revés.
5. Mensajes REST fuera de este proceso.

`system` = 299 no explica 1.024.

## Modelo de cifras

Cada número del panel cae en una de tres clases. La UI lo dice.

| Clase | Ejemplo | Fuente |
|---|---|---|
| Confirmado | Gasto del mes por categoría | Usage Records del período, categoría y `totalprice` |
| Estimado | Salientes bot | Conteo SQL `sender_type = bot` con transporte `twiml`, marcado como proxy de envío |
| Pendiente | SID de un TwiML | No se fabrica. La celda dice «sin correlación», no cero |

### Transporte

Columna o metadata obligatoria antes de cerrar el dashboard, TB-014:

| `sender_type` | `transport` | ¿Entra en «WhatsApp saliente app»? | ¿Entra en gasto? |
|---|---|---|---|
| `user` | `twilio_inbound` | No, es entrante | Solo si usage lo dice |
| `bot` | `twiml` | Sí, como estimado de intentos de respuesta | No se precio por fila |
| `agent` | `rest` | Sí, confirmado si hay SID | Precio de mensaje solo si usage o `Message.price` de ese SID existe; igual no cubre Meta |
| `system` | `internal` | No | No |

`billable_candidate` puede existir como heurística. No es la factura.

No unir callbacks al texto ni al timestamp para inventar un SID.

### Agregación diaria

Tabla o vista `message_daily_rollups` por día **de presentación** `America/Argentina/Buenos_Aires`, con columnas separadas: inbound, bot, agent, system, failed. El job es idempotente por día. `MONITORING_ENABLED` no lo habilita: es un job propio. Varios updates de delivery no multiplican la fila del mensaje; el estado de entrega vive en `message_delivery_status`, ya único por SID.

Días sin datos: null y «sin sincronizar», no 0.

## Facturación

Cuatro bloques que no se suman entre sí de más:

1. **Twilio base.** Categorías de mensajería del usage (entrantes y salientes de canal). Precio de la categoría, no un 0,005 fijo en código.
2. **WhatsApp / Meta.** Categorías reales del usage, con el nombre que devuelva la API (`channels-whatsapp-conversation-free`, `channels-whatsapp-template-service`, y las que aparezcan). El nombre `template-service` no se rotula «plantillas aprobadas por Tea» sin evidencia de `ContentSid`.
3. **Total del proveedor.** `totalprice` del período, mostrado como control. Si la suma de categorías elegidas no lo empata, se muestra la diferencia. No se agrega `totalprice` encima de las categorías.
4. **Saldo y recargas.** Sección aparte. Una recarga no incrementa el gasto.

Si el cargo Meta no se puede asignar a una conversación, se queda en el mes. No se prorratea por mensaje para «completar» un costo unitario. El costo por conversación, si se muestra, lleva la etiqueta estimado y el denominador escrito (por ejemplo salientes SQL del mes).

## UI

Misma estructura que el pedido operativo: filtros arriba, tarjetas, gráfico diario, tabla, CSV. No traer entidades de Dinamic Operations.

Filtros: año, mes, dirección, origen bot/agente, estado de entrega si existe. Nota fija del corte UTC junto a la zona Argentina.

Tarjetas: entrantes, salientes bot, salientes agente, fallidos, total de mensajes del criterio, costo base, costo WhatsApp, total de control, delta contra el mes anterior.

Gráfico: mensajes por día (tres series) y, si el usage trae granularidad diaria, costo por día. Si el usage solo es mensual, el gráfico de costo diario no se inventa: queda «no disponible por el proveedor» y el mensual sí se muestra.

CSV: las mismas columnas de la tabla diaria más una fila de totales y la marca de tiempo de sincronización.

Alertas: umbral configurable de gasto del mes y de fallo de sincronización. No alertar con el saldo mezclado con el gasto.

Última actualización y error de API visibles. Credenciales solo en backend. El browser no llama a Twilio.

## Conciliación operativa mínima

Informe, no un número único:

- Account SID consultado (enmascarado).
- Ventana UTC usada y ventana Argentina mostrada.
- Conteo SQL por transporte.
- Conteo usage de mensajes salientes.
- Diferencia y tolerancia (propuesta inicial: explicar, no alarmar, si la diferencia relativa es menor al 2 % **después** de excluir `system`; la tolerancia se ajusta con el primer mes medido, no se presenta como SLO vigente).
- TwiML de error contados en logs o en una métrica nueva del `catch`.
- SID de agentes presentes en usage/messages y ausentes en SQL, y al revés.

## Aceptación

- Octubre 2026, cuando se vuelva a consultar la cuenta, reproduce el total USD 134,5225 o muestra la discrepancia con la fecha de la consulta. No se da por hecho sin esa llamada.
- `system` no entra en salientes facturables.
- Recarga de prueba no sube el gasto.
- Un día incompleto no figura como cero mensajes.
- Apagar `MONITORING_ENABLED` no detiene el job de rollup ni la idempotencia de inbound (eso último es TB-006).
- Dos corridas del job no duplican el total del día.

## Seguridad de esta pantalla

Solo `admin`. No incluir cuerpos, teléfonos ni tokens en el CSV ni en los logs del cliente Twilio. El sanitizer de webhooks ya existe para snapshots de monitoreo; los usage records no necesitan el cuerpo del mensaje.
