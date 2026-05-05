# WhatsApp Bot Runtime (FlowEngine propio + canales Meta/Twilio)

Sistema para crear, publicar y ejecutar flujos conversacionales JSON con motor propio. El runtime soporta canales de entrada/salida por adapters, sin depender de Twilio Studio Flows.

## Arquitectura (V1)

```text
Inbound channel webhook (Meta o Twilio)
  -> Inbound Adapter (normaliza payload al contrato canonico)
  -> FlowEngine (motor propio)
  -> Outbound Adapter (Meta API o TwiML)
```

- Editor/admin/publicacion: `/api/flows/*`
- Simulador: `/api/simulator/*`
- Meta legacy: `GET|POST /webhook`
- Twilio V1: `POST /webhooks/twilio/:flowId`

## Prototipo `tea-twilio` (obsoleto)

La carpeta `tea-twilio/` era solo una prueba con Express + TwiML y un `flow.json` suelto. **El canal Twilio oficial vive en este proyecto (`whatsapp-bot`)**: `POST /webhooks/twilio/:flowId` usa el flujo **publicado activo** del repositorio (`data/flows/published/`), el `FlowEngine` y el mismo modelo JSON que el editor. Ver `tea-twilio/README.md` antes de borrar esa carpeta.

## Contrato canonico inbound

Todos los canales deben normalizar a:

```js
{
  provider: 'twilio' | 'meta',
  flowId: 'main-menu',
  userId: 'twilio:whatsapp:+5491111111111',
  text: 'hola',
  messageId: 'SMxxxxxxxx',
  rawPayload: { ... }
}
```

## Modelo JSON de flujo (publicado)

Contrato minimo de ejecucion:

- `id` (string)
- `schemaVersion` (int, opcional; si falta se asume `1`)
- `entryNode` (string, debe existir en nodes)
- `fallbackNode` (string opcional, si existe debe apuntar a nodo existente)
- `nodes` (array no vacio)
  - cada nodo requiere `id`, `type`, `message`
  - `transitions` si existe debe ser array
  - cada `transition.nextNode` debe existir
  - `nextNode` directo, si existe, debe existir

## Variables de entorno

Copiar base:

```bash
cp .env.example .env
```

### Runtime general

- `PORT`
- `NODE_ENV`
- `APP_BASE_URL`
- `CORS_ORIGIN`

### Meta (legacy / paralelo)

- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`

### Twilio (V1)

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

En V1 Twilio se responde por TwiML sincrono en el webhook, por eso `TWILIO_*` quedan documentadas para futuro outbound async por SDK/API.

### Admin (panel y API de flujos)

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH` (hex SHA-256 de la contraseña; no texto plano)
- `SESSION_SECRET` (≥ 32 caracteres; firma la cookie de sesión)

### Google Sheets (export de conversaciones finalizadas)

- `GOOGLE_SHEETS_ENABLED` (`true|false`)
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_TAB_NAME`
- `GOOGLE_SHEETS_RAW_TAB_NAME` (opcional)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Configuración recomendada:

1. Habilitar Google Sheets API en Google Cloud.
2. Crear una Service Account.
3. Crear y descargar la clave JSON de esa Service Account.
4. Copiar `client_email` en `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
5. Copiar `private_key` en `GOOGLE_PRIVATE_KEY` (respetando `\n`).
6. Compartir el Google Sheet con ese email como **Editor**.
7. Copiar el ID del Sheet en `GOOGLE_SHEETS_SPREADSHEET_ID`.

Notas:

- No subir nunca el JSON real ni la private key al repositorio.
- Con `GOOGLE_SHEETS_ENABLED=false`, la integración queda desactivada.
- Si `GOOGLE_SHEETS_ENABLED=true`, se requieren todas las variables listadas arriba.
- `GOOGLE_SHEETS_RAW_TAB_NAME` permite exportar una copia técnica adicional (opcional).

### Formato de hoja administrativa (principal)

La pestaña principal (`GOOGLE_SHEETS_TAB_NAME`) exporta columnas legibles para uso administrativo:

- Fecha de inicio
- Fecha de cierre
- Duracion
- Telefono
- Canal
- Nombre
- Tipo de usuario
- Consulta principal
- Detalle de consulta
- Estado de la conversacion
- Requiere atencion humana
- Motivo de cierre
- Accion sugerida
- Recorrido resumido
- Ultimo mensaje del usuario
- Observaciones
- Datos tecnicos

Notas:

- El sistema intenta asegurar encabezados solo si la hoja está vacía (no duplica en cada registro).
- La ultima columna (`Datos tecnicos`) mantiene el JSON técnico completo para auditoría.

### Labels humanos en el JSON de flujo (opcional)

Se pueden agregar campos opcionales para mejorar el recorrido resumido exportado:

- Nodo: `label`, `trackingLabel`, `title` o `name`.
- Transición: `track.label`.

Ejemplo nodo:

```json
{
  "id": "si_pg_direccion",
  "type": "message",
  "label": "Direccion de Posgrado",
  "message": "..."
}
```

Ejemplo transición:

```json
{
  "type": "match",
  "value": "1",
  "nextNode": "si_presenciales_tipo",
  "track": {
    "key": "modalidad_consulta",
    "value": "Presencial",
    "label": "Eligio cursos presenciales"
  }
}
```

Generar hash:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('Tea2026').digest('hex'))"
```

Endpoints auth (sin `requireAuth`):

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Protegidos con cookie HTTP-only firmada: `/api/flows/*`, `/api/simulator/*`. No se loguean contraseña ni hash.

Pruebas manuales (ajustá usuario/contraseña según tu `.env`):

Login correcto:

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tea-bot","password":"Tea2026"}'
```

Login incorrecto:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tea-bot","password":"mal"}'
```

Listar drafts sin cookie (401):

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/flows/
```

Twilio sin auth (debe seguir respondiendo):

```bash
curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=hola&MessageSid=SM123"
```

## Levantar backend

```bash
npm install
npm run dev
# o npm start
```

Salud:

- `GET /` — respuesta mínima
- `GET /health` — ok, `service`, `timestamp`, `environment` (sin secretos; pensado para Docker/load balancer)
- `GET /healthz` — señales extra (config Meta como booleanos, flujo publicado activo)

## Docker (backend + frontend)

Instrucciones de `docker compose`, puertos y `VITE_API_BASE_URL`: ver el `README.md` en la **raíz del monorepo**.

## Publicacion y resolucion de flowId

1. Editar draft en editor/API.
2. Publicar (`POST /api/flows/:flowId/publish`).
3. Runtime usa `activeVersion` publicado para ese `flowId`.

Twilio usa explicitamente el flow en URL:

- `POST /webhooks/twilio/main-menu` -> ejecuta published activo de `main-menu`.

Si no existe version publicada activa para ese flow, se loguea error controlado y se devuelve respuesta segura sin crashear.

## Webhook Meta (legacy)

- `GET /webhook` verificacion Meta (`hub.*`).
- `POST /webhook` mensajes Meta.

Se mantiene por compatibilidad.

## Webhook Twilio (V1)

Endpoint:

- `POST /webhooks/twilio/:flowId`
- `Content-Type: application/x-www-form-urlencoded`

Campos usados de Twilio:

- `From`
- `Body`
- `MessageSid`
- `WaId` (opcional)

Respuesta:

```xml
<Response>
  <Message>respuesta del flujo</Message>
</Response>
```

## Idempotencia

Deduplicacion persistida en:

- `data/webhook-processed-ids.json`

Clave dedupe:

- `provider:messageId`
- Ejemplo Twilio: `twilio:SM123...`
- Ejemplo Meta: `meta:wamid....`

Si llega duplicado:

- no se vuelve a ejecutar el FlowEngine
- se responde 200
- Twilio devuelve TwiML vacio (`<Response></Response>`)
- log: `duplicate=true action=ignored`

## Sesiones por proveedor

Clave de sesion por usuario con prefijo de proveedor:

- Twilio: `twilio:whatsapp:+549...`
- Meta: `meta:549...`

Esto evita colisiones de estado entre canales.

## Ejemplos curl (Twilio)

### 1) Mensaje inicial

```bash
curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=hola&MessageSid=SM123"
```

### 2) Respuesta SI / NO

```bash
curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=si&MessageSid=SM124"

curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=no&MessageSid=SM125"
```

### 3) Duplicado (mismo MessageSid)

```bash
curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=hola&MessageSid=SM-DUP-1"

curl -X POST http://localhost:3000/webhooks/twilio/main-menu \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=hola&MessageSid=SM-DUP-1"
```

### 4) flowId inexistente

```bash
curl -X POST http://localhost:3000/webhooks/twilio/flow-inexistente \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+5491111111111&Body=hola&MessageSid=SM404"
```

### 5) Fallback

Enviar un texto que no matchee transiciones del nodo actual para validar fallback del flujo publicado.

## Checklist Twilio Sandbox

1. En Twilio Console -> WhatsApp Sandbox.
2. En **When a message comes in** configurar:
   - Metodo: `POST`
   - URL: `https://tu-dominio/webhooks/twilio/main-menu`
3. Guardar configuracion.
4. Desde WhatsApp enviar mensaje al numero sandbox (tras `join` al sandbox).
5. Verificar logs del backend para `provider=twilio` y `duplicate=false`.

## Logs esperados (sin secretos)

- `provider`, `flowId`, `userId`, `messageId`, `duplicate`.
- Si aplica, `node` resultante.
- Nunca se imprimen tokens/secrets.

## Endpoints principales

- `GET /`
- `GET /health`
- `GET /healthz`
- `GET|POST /webhook` (Meta legacy)
- `POST /webhooks/twilio/:flowId`
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET/POST/PUT/... /api/flows/*` (requiere sesión)
- `POST /api/simulator/*` (requiere sesión)
