# Navegación y conversaciones estancadas

## Qué hace el matcher hoy

Confirmado por código.

Entrada del motor y de `compile-flow.js`: `trim` + `toLowerCase`. Nada de NFKC, nada de quitar diacríticos, nada de keycaps.

Orden real de `evaluateTransitionsDetailed`: `match`, luego `matchAny` (queda aplanado a exacto en compile), luego `matchIncludes` por substring, luego `default`, luego fallback al nodo configurado o `stay_on_node` si no hay fallback.

`matchIncludes` es `input.includes(needle)`. La cadena `si` puede caer dentro de `inscripciones`. Eso es el riesgo que el plan describe. No hay un test de regresión de ese falso positivo en el motor de transiciones; hay que agregarlo como fixture, no asumir que ya falla en el flujo publicado. **Pendiente de validación** contra el JSON/DB del flujo vigente: esta auditoría no abrió el contenido publicado nodo por nodo.

Acentos y espacios repetidos sí se normalizan en comandos globales (`menú`, `atrás`, `humano`) en `global-commands.js`. Los keycaps `1️⃣` se convierten en dígitos solo en la clasificación de reentrada (`stripKeycapDigits`). Un usuario en un menú del flujo no recibe ese tratamiento.

`fallbackCount` suma solo cuando la razón es `fallback` (`usedFallback`). Si el flujo manda el `default` a `fallback_global`, el contador no se entera y el nodo igual reenvía su texto. `stay_on_node` también reejecuta el mensaje del mismo nodo.

No hay job de estancamiento, ni columna, ni filtro de inbox.

## Normalización propuesta

Una función usada por el motor y por el compile, detrás de un flag `FLOW_MATCH_NORMALIZATION=legacy|safe`. Default `legacy` hasta pasar el replay.

Aplicar solo a la copia de comparación. Persistir el texto original en el mensaje.

1. Unicode NFKC.
2. Quitar diacríticos (NFD + marcas combinantes), igual que los comandos globales.
3. Reemplazar keycap `[0-9]\uFE0F?\u20E3` por el dígito.
4. Colapsar espacios.
5. Case fold.

Matching, en este orden, sin fuzzy:

| Regla | Criterio seguro |
|---|---|
| Exacto y `matchAny` | Igualdad sobre la forma canónica |
| Opción enumerada | El mensaje es `2`, `opción 2`, `opcion 2` o el keycap, y el nodo tiene una opción 2 explícita. No buscar el dígito como substring suelto dentro de una frase larga |
| `matchIncludes` | Frontera de palabra o de token, longitud mínima del needle (propuesta: 3, con lista de excepciones cortas del dominio: `si`, `no`, ids de carrera si el flujo las usa), y el needle no puede ser substring de otro needle activo del mismo nodo |
| Default | Igual que hoy, pero la razón queda registrada como `default`, no como `fallback` |
| Globales | Siguen ganando antes del match local: `menú`, `atrás`, `humano` y las frases de humano ya existentes |

Si dos reglas includes matchean, no elegir la primera en silencio. Quedarse en el nodo y registrar `ambiguous_include`. Eso es preferible a saltar a la carrera equivocada.

No introducir distancia de Levenshtein ni embeddings.

## Lint al publicar

Extender la validación que ya corre `compileFlow`, en modo advertencia primero:

- Dos `match` / `matchAny` con la misma forma canónica.
- Un `matchIncludes` contenido en otro del mismo nodo.
- `default` o cualquier transición cuyo destino es el mismo nodo.
- Destino inexistente.
- Nodo sin salida y sin marca terminal.

TB-011 no bloquea la publicación en la primera entrega. El editor muestra la lista. El segundo paso puede rechazar auto-transiciones.

## Detección de estancamiento

Son señales, no un `conversations.status` nuevo.

Tabla propuesta, no creada:

`conversation_attention_signals`

- `id`, `conversation_id`, `session_id` nullable
- `kind`: `FALLBACK_LOOP`, `SAME_NODE_LOOP`, `NO_PROGRESS`, `REPEATED_MENU`, `USER_REQUESTED_HUMAN`, `UNANSWERED_HUMAN`, `OUTBOUND_FAILURE`
- `severity`, `source` (`shadow` o `active`)
- `occurred_at`, `resolved_at`, `dedupe_key`
- `metadata_json` corto: node key, razón, contadores. **Sin** cuerpo del mensaje ni teléfono.

Índice por conversación donde `resolved_at IS NULL`.

### Heurísticas iniciales

Umbrales del plan, todavía no medidos. Corren en shadow (`STALL_DETECTION_MODE=off|shadow|alert`). Default `off`.

| Señal | Disparo propuesto |
|---|---|
| `FALLBACK_LOOP` | 3 razones `fallback` o `default` hacia nodo fallback en las últimas 5 entradas del usuario de la sesión |
| `SAME_NODE_LOOP` | 3 transiciones al mismo `node_key` en 10 minutos |
| `REPEATED_MENU` | 3 outbound de bot con el mismo texto canónico, con inbound de por medio, sin cambio de nodo |
| `NO_PROGRESS` | La sesión no cambia de nodo en N turnos (empezar por 4) y no está en un nodo de captura deliberada (`collect_email`) |
| `USER_REQUESTED_HUMAN` | El global `humano` no estaba disponible y el texto canónico contiene `humano`, `asesor` o `persona` como token, no como substring de otra palabra |
| `UNANSWERED_HUMAN` | `waiting_human` más viejo que un umbral configurable, sin primer mensaje de agente |
| `OUTBOUND_FAILURE` | Fallo de REST del agente o TwiML de error del `catch` |

`collect_email` no debe marcarse como loop solo porque el usuario todavía no escribió un correo. Sí puede marcarse si alterna con `fallback_global`.

`USER_REQUESTED_HUMAN` en la fase de alertas ofrece una sola vez la derivación que el flujo ya tiene, o abre handoff si el nodo global humano existe. No es la fase 1. La fase 1 solo registra.

Dedupe: la misma `dedupe_key` no reabre una señal resuelta o desestimada. Hace falta una acción de inbox «desestimar».

### La conversación de 80 mensajes

Evidencia histórica del plan, no un fixture en el repo. El replay todavía no existe. Criterio cuando se construya: el texto «Periodismo Deportivo», variantes de acento y `2️⃣` deben avanzar si el flujo publicado tiene esa opción. Si el flujo publicado no tiene esa transición, el matching nuevo no la inventa: la señal `REPEATED_MENU` sí debe disparar. Esas dos salidas se verifican por separado. No declarar el matching arreglado si el flujo no contiene la arista.

## Intervención en el inbox

Fase shadow: escribir señales y una métrica. El agente no las ve.

Fase alerta, con el flag `alert`:

- Badge en la fila y filtro `stalled=1`.
- Orden opcional por señal más vieja sin resolver.
- Causa visible (`REPEATED_MENU`, hora).
- Acción «Tomar conversación», que es TB-019, no un handoff automático.
- Notificación: reutilizar el sonido de handoff solo si el producto lo pide. Default: badge, sin alarma sonora nueva, para no entrenar al equipo a ignorarla.

No crear handoff automático en estas fases. La oferta «¿querés hablar con una persona?» es un ticket posterior, una sola vez por episodio, y solo si shadow mostró pocos falsos positivos. Un usuario que vuelve al menú con el comando global no genera derivación.

## Instrumentación mínima del motor

En el patch de sesión o en metadata del outbound, guardar `transitionReason`: `exact`, `matchAny`, `includes`, `default`, `global`, `fallback`, `stay_on_node`, `ambiguous_include`. Sin el texto del usuario.

Eso desbloquea TB-008 sin cambiar respuestas mientras el flag de normalización siga en `legacy`.

## Aceptación

- Fixture `inscripciones` con needle `si` no transiciona por includes.
- `1️⃣` y `1` coinciden solo si hay opción enumerada.
- `sí` y `si` coinciden en exacto cuando la regla publicada es esa palabra, no dentro de otra.
- Replay anonimizado del caso largo: o avanza, o emite señal. El informe dice cuál de las dos.
- Un recorrido que usa «menú» a propósito no abre señal de derivación.
- Señales desestimadas no vuelven con la misma `dedupe_key`.
- Con `STALL_DETECTION_MODE=shadow`, cero cambios de status y cero mensajes extra.
