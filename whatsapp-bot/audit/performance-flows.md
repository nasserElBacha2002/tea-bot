# Performance y runtime de flujos

Esta fase agrega instrumentacion y mejora interna del runtime sin cambiar el formato publico del JSON.

## Variables de entorno

- `PERF_LOG_ENABLED=true|false` (default: `false`)
- `PERF_LOG_SAMPLE_RATE=1` (default: `1`)
- `PERF_LOG_SLOW_MS=500` (default: `500`)
- `PERF_BENCH_MESSAGES=1000` (default benchmark)

## Cache de flujos activos

- El runtime mantiene cache por `flowId` en `FlowLoader`.
- `getFlow(flowId)` devuelve cache hit o recarga desde `published`.
- `reloadFlow(flowId)` reemplaza cache solo si valida y compila correctamente.
- `invalidateFlow(flowId)` limpia flow crudo + flow compilado.
- `getCacheInfo(flowId)` expone metadatos (version, age, nodos, transiciones).
- Al publicar o importar con activacion, se ejecuta `reloadFlow(flowId)` para evitar cache stale.

## Compiled flow

- Al cargar/reload se compila una estructura interna:
  - `nodesById`
  - `exactMatchByNodeId`
  - `includesRulesByNodeId`
  - `defaultTransitionByNodeId`
- El engine usa indices O(1) para resolver nodos y matching exacto.
- No cambia semantica de nodos/transiciones ni formato JSON.

## Comandos globales

- Se soportan en engine, antes del matching normal:
  - menu: `menu`, `menú`, `inicio`, `volver al menu`, `volver al menú`
  - back: `atras`, `atrás`, `volver atras`, `volver atrás`
  - human: `humano`, `persona`, `asesor`, `asesora`, `representante`
- Prioridad: comando global interno > transiciones normales del nodo.
- `atrás` usa `session.history` (compatibilidad segura para sesiones legacy sin `history`).

## Activar logs de performance

```bash
PERF_LOG_ENABLED=true PERF_LOG_SAMPLE_RATE=1 npm start
```

Los logs salen con prefijo `[PERF]` y payload JSON para facilitar filtros.

Ejemplo:

```txt
[PERF] {"ts":"2026-05-05T14:00:00.000Z","event":"twilio_webhook","flowId":"main-menu","totalMs":12.41,"engineMs":1.23,"dedupeCheckMs":0.44,"sessionWriteMs":0.81,"replyLength":180,"nodeId":"welcome","nextNodeId":"alumni_yes","flowCacheHit":true}
[PERF] {"ts":"2026-05-05T14:00:01.000Z","event":"flow_cache_hit","flowId":"main-menu","version":"v12","ageMs":5123}
[PERF] {"ts":"2026-05-05T14:00:01.010Z","event":"flow_compile","flowId":"main-menu","version":"v13","compileMs":2.91,"nodes":86,"transitions":391,"exactValues":801}
[PERF] {"ts":"2026-05-05T14:00:01.020Z","event":"flow_resolve","flowId":"main-menu","version":"v13","nodeId":"welcome","resolveMs":0.42,"globalCommand":"menu","matched":"global"}
```

## Correr benchmark local

```bash
node scripts/benchmark-flow-runtime.js --flow main-menu --versions v10,v11,v12 --messages 1000
```

Tambien admite defaults sin flags:

```bash
node scripts/benchmark-flow-runtime.js
```

El script guarda un reporte JSON en:

- `audit/raw/perf-benchmark-flow-runtime.json`

## Interpretacion rapida

- `engineMs` alto: costo en resolucion/matching del engine.
- `sessionWriteMs` alto: cuello en persistencia de `sessions.json`.
- `dedupePersistMs` alto: cuello en persistencia dedupe.
- `outboundSendMs` alto: latencia externa de envio a Meta.
- `totalMs` alto: impacto total percibido en webhook.
- `flow_cache_miss` frecuente: cache no estable o invalidaciones excesivas.
- `flow_compile` alto: flujo con demasiada complejidad al cargar.
