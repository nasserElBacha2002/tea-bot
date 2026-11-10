# Diagnóstico — Periodismo Deportivo

## Versiones

Producción, archivo `main-menu.json`: `main-menu` **v62**, 89 nodos, `entryNode=collect_email`, `fallbackNode=fallback_global`, `status=published`.

Base local `tea-bot`, snapshot activo por `version_number` descendente: `main-menu` **v24**, 88 nodos, `entryNode=welcome`, publicado. Hay un draft v25 sin snapshot. No se usó v24 como si fuera producción.

`si_pd_menu` y `si_pd_direccion` son idénticos entre v62 y v24. También lo son `si_pg_menu`, `si_presenciales_tipo` y `fallback_global`.

Difieren, y por eso el export de producción manda:

- `welcome`: el texto local saluda y pregunta si es estudiante o egresado/a de la escuela. v62 pregunta si es estudiante o egresado/a de Tea y Deportea. Las transiciones son las mismas.
- `collect_email` existe solo en v62. Es la entrada.
- `human_handoff`: v62 agrega el teléfono 4370 6464. Las transiciones son las mismas.
- También cambian mensajes de `no_menu`, charlas e informes de distancia y presencial, y `si_pd_sec_d`.

## Recorrido reproducido

Sesión en `si_pd_menu` del documento v62, motor anterior:

| Entrada | Nodo resultante | Por qué |
|---|---|---|
| `3` | `si_pd_direccion` | `match` exacto del valor `"3"` |
| `3️⃣` | `si_pd_menu` | el keycap no se convertía a `3`; el `default` vuelve al mismo nodo |
| `Dirección de estudios` | `si_pd_menu` | `"dirección de estudios"` no contiene el needle `"direccion"` porque la tilde se conservaba |
| `Direccion de estudios` | `si_pd_direccion` | sin tilde, `matchIncludes` `"direccion"` sí coincidía |
| `DIRECCIÓN DE ESTUDIOS` | `si_pd_menu` | misma falla de tilde |
| ` Dirección de estudios ` | `si_pd_menu` | el trim no alcanza: sigue la tilde |
| `¿Mañana hay clases?` | `si_pd_menu` | ningún match; `default` reenvía el mismo mensaje |
| `Menú` | `welcome` | comando global, anterior a las opciones |

La primera reproducción contra la base local mostró el texto de bienvenida de v24 porque una sesión ya creada carga el publicado del loader, no el snapshot pasado al motor. Con `simulatorFlowOverride` del export v62, `Menú` muestra la pregunta de estudiante o egresado/a de Tea y Deportea.

## Causa raíz

Está en el motor, no en un destino faltante.

El nodo `si_pd_menu` de v62 tiene nueve `match` numéricos. El `3` apunta a `si_pd_direccion`. Ese nodo existe, es de tipo `message` y entrega el mail `direcciondeportea@teaydeportea.edu.ar` y el interno 134. No es un handoff.

También hay `matchIncludes` con needle `direccion`. El motor comparaba con `trim` + `toLowerCase`, sin NFKC, sin keycaps y sin quitar diacríticos. `"dirección de estudios".includes("direccion")` es falso. El `default` del nodo apunta a `si_pd_menu`, con razón `default` y `usedFallback=false`. Por eso el mismo menú se repetía y `fallbackCount` no subía.

`Menú` no es un fallo de matching. `detectGlobalCommand` corre antes que las opciones y, si hay email guardado, abre `welcome`. En v62 ese nodo hace la pregunta que se vio en la captura. La sesión no se reinicia de cero: se conserva el flujo y se vacía el historial de `atrás`.

## Matching

Anterior, en este orden: `match`, `matchAny`, `matchIncludes` por substring, `default`, y si no hay nada el fallback del flujo o el mismo nodo.

Nuevo, sobre una forma canónica compartida por el compile y el motor:

1. Comandos globales.
2. `match` y `matchAny` canónicos. Si dos valores distintos normalizan igual y van a destinos distintos, la clave queda ambigua y no se elige.
3. Etiqueta completa de una línea `N️⃣ *texto*` o `N *texto*`, unida al `match` de ese número. Si dos etiquetas canónicas coinciden y van a destinos distintos, no se elige.
4. `matchIncludes` solo como tokens enteros, needle de al menos 3 caracteres. Si dos reglas activas apuntan a destinos distintos, no se elige.
5. `default`.
6. Fallback del flujo o permanencia.

No hay similitud semántica. Los números que ya funcionaban siguen siendo `match` exacto. `Dirección de estudios` ahora es la etiqueta de la opción 3 y llega a `si_pd_direccion` igual que `3`. `Blanqueo de mail institucional` llega a `si_pd_mail_inst` por etiqueta completa, antes de que `blanqueo`, `mail` e `institucional` compitan. `blanqueo de mail`, que no es una etiqueta completa y pega en más de un destino, se queda en el menú.

## Fallback

Si el nodo muestra opciones numeradas y la transición se queda en el mismo nodo por `default`, permanencia o ambigüedad, la respuesta dice que no reconoció una opción, recuerda número, nombre, `menú`, `atrás` y `humano` cuando el flujo tiene nodo humano, y vuelve a mostrar el menú. La segunda vez seguida cambia el texto. El contador queda en `variables.unmatchedOptionCount`. No se borra la sesión ni se inventa calendario.

`fallback_global` ya explica la falla y no se envuelve otra vez. Un nodo sin opciones numeradas, incluida la captura y `human_handoff`, conserva su texto. La captura guarda el texto original recortado.

## Menú y atrás

Volver al menú principal, con email guardado, es abrir `welcome` en el flujo actual. Sin email, es `entryNode`. En v62 eso es `collect_email`; en el v24 local es `welcome`. Se vacía `history`. Se conservan las variables que el nodo de destino no pisa. No se cambia de flujo. Una conversación `assigned` o `waiting_human`, o con handoff activo, no entra al motor: `Menú` no la interrumpe. Durante la captura de email, `Menú` tampoco sale de `collect_email`.

`Atrás` saca el último nodo de `history`. Si no queda historial, va a `entryNode`. El comando global gana sobre el `matchAny` de atrás del nodo. En `si_pd_menu` ese `matchAny` iría a `si_presenciales_tipo`; el global hace ese salto solo cuando ese nodo está en el historial.

## Documento y despliegue

No se modificó el documento publicado ni el snapshot local. No hace falta publicar otra versión para que `Dirección de estudios` funcione: la etiqueta ya está en el mensaje y el destino ya existe. El arreglo viaja con el código del motor, junto con TB-005 y TB-006. No se tocó firma Twilio, idempotencia, fencing, reclaim, replay, reentrada, takeover ni las migraciones 009 y 010.

El retry del mismo MessageSid sigue leyendo el outbound ya persistido. La transición a `si_pd_direccion` queda en una sola fila.
