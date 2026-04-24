# Tea-bot

Monorepo con backend de flujos (`whatsapp-bot`), editor (`frontend`) y prototipo obsoleto (`tea-twilio`).

## Arquitectura

- **`whatsapp-bot`**: API Express, motor de flujos, publicación draft/published, webhooks **Meta** (`/webhook`) y **Twilio** (`POST /webhooks/twilio/:flowId`), TwiML de salida para Twilio V1.
- **`frontend`**: editor/admin (Vite + React).
- **`tea-twilio`**: prototipo deprecado; ver `tea-twilio/README.md`.

## Requisitos

- Node.js 22+ (local) o Docker + Docker Compose (recomendado en servidor).

## Variables de entorno

- Backend: `whatsapp-bot/.env.example` → copiar a `whatsapp-bot/.env`.
- Frontend (local Vite): `frontend/.env.example` → copiar a `frontend/.env`.
- Compose (build del frontend): raíz `.env.example` → copiar a `.env` en la raíz del repo (define `VITE_API_BASE_URL` para el **navegador**).

`VITE_API_BASE_URL` debe ser la URL pública con la que el navegador puede llamar al API (esquema + host + puerto si aplica), **no** un hostname solo interno de Docker.

## Autenticación del panel

El backend exige `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (SHA-256 en hex de la contraseña) y `SESSION_SECRET` (≥ 32 caracteres). Ver `whatsapp-bot/.env.example`.

- Login: `POST /api/auth/login` (JSON). Sesión: **cookie HTTP-only** `tea_session`, firmada con HMAC-SHA256 usando `SESSION_SECRET` (payload JSON con usuario y expiración). Se eligió cookie en lugar de JWT en header porque encaja bien con axios `withCredentials` y evita exponer el token en `localStorage`; en `localhost` el navegador envía la cookie al API en otro puerto cuando CORS permite credenciales y el origen del front está permitido.
- Rutas públicas: webhooks, `GET /health`, `GET /healthz`, `GET /`.
- Rutas protegidas: `/api/flows/*`, `/api/simulator/*`.

Generar hash de contraseña:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('Tea2026').digest('hex'))"
```

En `whatsapp-bot/.env`, incluí en `CORS_ORIGIN` el origen exacto del frontend (ej. `http://localhost:5173` y/o `http://localhost:8080` con Docker).

## Levantar en local (sin Docker)

### Backend

```bash
cd whatsapp-bot
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Ajustá `VITE_API_BASE_URL` en `frontend/.env` si el backend no está en `http://localhost:3000`.

## Docker Compose (backend + frontend)

En la raíz del repo:

```bash
cp .env.example .env
cp whatsapp-bot/.env.example whatsapp-bot/.env
# Editá whatsapp-bot/.env y la raíz .env (VITE_API_BASE_URL)
docker compose up --build -d
```

- Backend: `http://localhost:${WHATSAPP_BOT_PORT:-3000}` (health: `GET /health`, extendido: `GET /healthz`).
- Frontend: `http://localhost:${FRONTEND_PORT:-8080}`.

Logs:

```bash
docker compose logs -f whatsapp-bot
docker compose logs -f frontend
```

Detener:

```bash
docker compose down
```

### Persistencia de datos

El servicio `whatsapp-bot` monta el volumen:

`./whatsapp-bot/data:/app/data`

Ahí viven flujos publicados, borradores, `sessions.json`, dedupe de webhooks, etc.

## Twilio Sandbox (URL a pegar)

Con el backend accesible por HTTPS (recomendado en producción) o por HTTP según acepte tu entorno:

`https://<tu-dominio>/webhooks/twilio/<flowId>`

Ejemplo con `flowId` publicado `main-menu`:

`https://<tu-dominio>/webhooks/twilio/main-menu`

Método: **POST**. No usa Twilio Studio Flows.

Pruebas locales con curl: ver `whatsapp-bot/README.md`.

## Deploy en servidor

1. Instalar Docker y Docker Compose.
2. Clonar el repo, configurar `.env` (raíz y `whatsapp-bot/.env`).
3. Exponer puertos (ej. 3000 API, 8080 UI) o poner **Nginx** delante con TLS y proxy a los contenedores.
4. **Twilio en producción**: usar HTTPS en la URL del webhook.
5. `CORS_ORIGIN` en `whatsapp-bot/.env` debe incluir el origen exacto del frontend (p. ej. `https://app.tudominio.com`).

## Healthchecks

- `GET /health` — ligero (Docker / load balancer).
- `GET /healthz` — incluye señales de configuración y flujo publicado (sin valores secretos).

Compose usa el healthcheck del backend antes de considerar listo el dependiente `frontend`.
