# WHATSAPP_BOT_DEPLOY_READINESS_AUDIT

## 1) Resumen ejecutivo

**Estado:** **Listo con correcciones menores** (no bloquea pruebas controladas, pero no recomendable exponer a producción real sin cerrar los hallazgos altos).

### Justificacion corta
- El stack base funciona end-to-end: webhook -> motor -> respuesta -> envio por Meta (`src/controllers/webhook.controller.js`, `src/services/flow-engine.service.js`, `src/services/whatsapp.service.js`).
- Hay persistencia en disco para sesiones y flujos (`data/sessions.json`, `data/flows/**`) y separacion draft/publicado.
- Existen endpoints de admin para validar/publicar/versionar y simulador.
- Pero faltan protecciones operativas clave para despliegue inicial: idempotencia de eventos webhook, control de CORS por entorno, y saneamiento de datos/sesiones grandes en repositorio.

---

## 2) Tabla de variables de entorno

Fuente auditada:
- `whatsapp-bot/.env.example`
- `whatsapp-bot/src/config.js`
- `whatsapp-bot/README.md`
- Busqueda en codigo `process.env.*`

| Variable | Requerida | Donde se usa | Esta documentada | Riesgo si falta | Recomendacion |
|---|---|---|---|---|---|
| `PORT` | No (tiene default 3000) | `src/config.js`, `src/app.js` | Si | Bajo/Medio (conflicto de puerto) | Definir explicitamente en deploy para evitar conflictos |
| `META_VERIFY_TOKEN` | Si | `src/config.js`, `verifyWebhook()` | Si | Alto (Meta no puede verificar webhook) | Obligatoria en produccion; rotarla si se expone |
| `META_ACCESS_TOKEN` | Si | `src/config.js`, `sendTextMessage()` | Si | Critico (no envia mensajes) | Usar token permanente/renovable y monitorear expiracion |
| `META_PHONE_NUMBER_ID` | Si | `src/config.js`, URL Graph API en `whatsapp.service.js` | Si | Critico (envio falla por numero/id invalido) | Validar correspondencia con numero en Meta |
| `APP_BASE_URL` | Recomendado (no estricto) | `src/config.js`, log en startup (`src/app.js`) | Si | Medio (documentacion/logs inconsistentes, confusion de webhook URL) | Setear URL publica HTTPS real en prod |
| `NODE_ENV` | No usado | No aparece en codigo | No | Bajo | Opcional: agregar para logging/comportamiento por entorno |
| `FRONTEND_URL` / `CORS_ORIGIN` | No usado | CORS abierto con `app.use(cors())` | No | Alto (superficie innecesaria) | Agregar variable de origen permitido y restringir CORS |
| `DATABASE_URL` (u otra DB) | No aplica hoy | No hay DB; usa filesystem | No | Medio (expectativa incorrecta) | Documentar explicitamente que persiste en archivos |
| `PUBLISHED_FLOWS_PATH` | No (hardcoded) | `src/repositories/flow.repository.js` | No | Medio (rutas no configurables) | Opcional: hacerlo configurable si se despliega en entornos con volumen distinto |

### Hallazgos de consistencia env/docs
- **Variables usadas pero no documentadas:** ninguna critica detectada.
- **Variables documentadas pero no usadas:** no hay en `.env.example`; README esta alineado con lo usado.
- **Gap:** no existe `.env` en repo (correcto), pero **tampoco hay `.gitignore` en `whatsapp-bot/`** para protegerlo localmente.

---

## 3) Mapa del flujo tecnico (runtime)

1. **Entrada de mensaje**  
   Meta llama `POST /webhook` (`src/routes/webhook.routes.js` -> `receiveMessage`).

2. **Webhook controller**  
   Filtra `object === whatsapp_business_account`, recorre `entry/changes/messages`, normaliza texto por tipo (`text`, `button`, `interactive`) y llama motor (`src/controllers/webhook.controller.js`).

3. **Motor de conversacion**  
   `flowEngine.resolveIncomingMessage({ userId: from, text })`:
   - crea sesion si no existe (`session.service.js`)
   - carga flujo publicado desde `flow-loader`/repo
   - evalua transiciones (`match`, `matchAny`, `matchIncludes`, `default`)
   - actualiza sesion/nodo/variables y retorna reply (`src/services/flow-engine.service.js`).

4. **Estado de usuario**  
   Se guarda en `data/sessions.json` por `userId` (telefono). Persiste reinicios (`loadSessions` en startup).

5. **Respuesta**  
   Controller usa `sendTextMessage({ to, message })`.

6. **Envio por WhatsApp Cloud API**  
   `POST https://graph.facebook.com/v22.0/{META_PHONE_NUMBER_ID}/messages` con `Bearer META_ACCESS_TOKEN` (`src/services/whatsapp.service.js`).

---

## 4) Hallazgos por severidad

### Bloqueantes
- **No se detectan bloqueantes absolutos de arranque** con configuracion correcta.

### Altos
1. **Sin idempotencia/deduplicacion de eventos webhook**  
   - Evidencia: `receiveMessage` procesa cada mensaje recibido y no guarda `message.id` para evitar reprocesar reintentos de Meta (`src/controllers/webhook.controller.js`).  
   - Riesgo: respuestas duplicadas ante retries/timeouts.

2. **CORS abierto sin restriccion por entorno**  
   - Evidencia: `app.use(cors())` sin origen permitido configurable (`src/app.js`).  
   - Riesgo: superficie de abuso no necesaria para endpoints admin/simulator.

3. **No hay `.gitignore` en `whatsapp-bot/`**  
   - Evidencia: archivo inexistente; potencial de commitear `.env`/data sensibles accidentalmente.  
   - Riesgo: filtracion de secretos y/o PII.

### Medios
1. **`validateConfig()` solo advierte, no falla startup**  
   - Evidencia: warning sin `process.exit` en `src/config.js`.  
   - Riesgo: servicio levanta “en verde” pero falla en envio real.

2. **Posible crash si sesion apunta a nodo inexistente**  
   - Evidencia: `evaluateTransitions(node, ...)` asume `node` no nulo (`node.transitions`) (`src/services/flow-engine.service.js`).  
   - Riesgo: sesion corrupta rompe procesamiento.

3. **Persistencia de sesiones en un JSON unico grande**  
   - Evidencia: `data/sessions.json` muy grande y contiene snapshots de simulacion embebidos; escritura completa en cada update (`session.service.js`).  
   - Riesgo: degradacion I/O, crecimiento no controlado.

4. **README desactualizado en estructura**  
   - Evidencia: menciona `utils/message-handler.js` que no existe; arquitectura real es flow-engine/flows repo.  
   - Riesgo: onboarding/deploy confuso.

5. **Frontend acoplado a `localhost:3000`**  
   - Evidencia: `API_BASE` hardcoded en `frontend/src/features/flows/api/*.ts`.  
   - Riesgo: despliegue multi-entorno requiere build/modificacion manual.

### Bajos
1. **`APP_BASE_URL` se usa solo para log**  
   - No impacta funcionalidad directa, pero puede inducir error operacional si esta mal configurada.
2. **Sin healthcheck profundo**  
   - `GET /` solo confirma proceso HTTP, no valida conectividad Meta ni estado de flowLoader.

---

## 5) Checklist final de deploy (pre-conexion telefono real)

1. Preparar `.env` en servidor con variables criticas (`META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `PORT`, `APP_BASE_URL`).
2. Levantar backend y validar salud basica (`GET /`).
3. Verificar que hay **al menos un flujo publicado activo** (metadata/version activa en `data/flows/published/<flowId>/metadata.json`).
4. Probar API admin:
   - `GET /api/flows`
   - `GET /api/flows/:flowId/versions`
5. Verificar webhook de Meta:
   - `GET /webhook` con `hub.mode/hub.verify_token/hub.challenge`.
6. Simular mensaje entrante (payload WhatsApp) a `POST /webhook`.
7. Confirmar envio saliente a Meta (respuesta 200 del Graph API).
8. Probar usuario nuevo y usuario existente (estado no se pisa).
9. Probar respuesta invalida/default (ruta fallback).
10. Reiniciar servidor y confirmar continuidad de sesiones y flujo activo.
11. Validar comportamiento cuando no hay published activo (debe ser error controlado, no silencioso).

---

## 6) Comandos sugeridos

### Instalacion
```bash
cd whatsapp-bot
npm install
cp .env.example .env
```

### Levantar backend
```bash
npm run dev
# o produccion
npm start
```

### Levantar frontend (si aplica editor)
```bash
cd ../frontend
npm install
npm run dev
```

### Validar flujo antes de publicar (API)
```bash
curl -X POST http://localhost:3000/api/flows/validate \
  -H "Content-Type: application/json" \
  --data-binary @whatsapp-bot/data/flows/drafts/main-menu.json
```

### Publicar flujo
```bash
curl -X POST http://localhost:3000/api/flows/main-menu/publish
```

### Verificar webhook (Meta challenge)
```bash
curl "https://TU_URL_PUBLICA/webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=12345"
```

### Simular mensaje entrante (payload minimo)
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object":"whatsapp_business_account",
    "entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"5491111111111","type":"text","text":{"body":"hola"}}]}}]}]
  }'
```

### Ver logs
```bash
npm start
# revisar stdout/stderr (errores de Graph API / flow loader / session)
```

---

## 7) Recomendaciones

## Antes de subir (prioridad alta)
- Implementar deduplicacion de eventos webhook por `message.id` (idempotencia).
- Restringir CORS con variable de entorno (`CORS_ORIGIN` o similar).
- Agregar `.gitignore` en `whatsapp-bot/` para excluir `.env`, logs y datos sensibles (`data/sessions.json` segun politica).
- Endurecer startup: si faltan credenciales criticas en prod, fallar rapido (no solo warning).

## Puede quedar para despues (prioridad media)
- Healthcheck extendido (`/healthz`) con chequeo de flow published activo.
- Mejorar robustez del motor ante sesiones corruptas (guard si `currentNode` no existe).
- Separar/limpiar sesiones de simulacion para evitar inflar `sessions.json`.
- Configurar API base del frontend por entorno (evitar hardcode localhost).

## Documentacion faltante o desalineada
- Actualizar `whatsapp-bot/README.md` para reflejar arquitectura real (flow engine, admin/versiones/simulator, paths reales de datos).
- Agregar runbook operativo:
  - URL exacta webhook de Meta (`https://dominio/webhook`)
  - rotacion de token
  - recuperacion ante “sin flow publicado”.

---

## Veredicto operativo

Con el estado actual, el sistema es **viable para pruebas de integracion reales controladas** con WhatsApp Cloud API, pero para un despliegue inicial mas robusto conviene aplicar las correcciones menores/altas listadas arriba antes de abrir trafico real.
