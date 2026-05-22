# Desarrollo local — Tea Bot

## 1. SQL Server

```bash
# Desde la raíz del repo
docker compose up -d sqlserver
```

Variables en `whatsapp-bot/.env`:

```env
CONVERSATION_DB_ENABLED=true
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=tea_bot
DB_USER=sa
DB_PASSWORD=TeaBot_Dev_Passw0rd!
DB_TRUST_SERVER_CERTIFICATE=true
DB_ENCRYPT=false
```

## 2. Migraciones y setup completo

```bash
cd whatsapp-bot
npm run db:migrate
# O todo junto (migrate + import flujos + seed conversaciones):
npm run db:setup-local
npm run db:verify
```

## 3. Importar flujos JSON → base de datos

```bash
npm run db:import-flows
```

Idempotente: re-ejecutar no duplica; si el checksum del JSON no cambió, la versión se omite.

## 4. Seed de conversaciones (sin Twilio)

```bash
ALLOW_DEV_SEED=true npm run db:seed-conversations
```

Solo en desarrollo (`NODE_ENV` ≠ `production`) o con `ALLOW_DEV_SEED=true`.

Reiniciar solo datos seed:

```bash
RESET_DEV_SEED=true npm run db:seed-conversations -- --reset
```

## 5. Backend y frontend

```bash
npm run dev          # whatsapp-bot :3000
cd ../frontend && npm run dev   # :5173
```

Login admin → **Conversaciones** (`/conversations`).

## 6. Almacenamiento de flujos (solo DB)

La única fuente de verdad es **SQL Server** (`flows`, `flow_versions`, `flow_version_snapshots`).

```env
FLOW_STORAGE_MODE=db
CONVERSATION_DB_ENABLED=true
```

Al arrancar verás `FLOW_STORAGE_MODE=db` y logs `[DbFlowLoader]`.

**Migración desde JSON local (una vez):**

```bash
npm run flows:migrate-json-to-db
npm run flows:parity-check   # opcional, si aún tenés data/flows/published
```

**UI:** menú **Flujos** → `/flows` (editor de conversación). **Importar JSON** carga una versión nueva en DB, no archivos en disco.

Checklist completo: `audit/dod-verification.md`

## 7. Respuestas manuales sin Twilio

Conversaciones seed usan `provider=internal` → `POST .../messages` solo persiste en DB.

`provider=twilio` + canal WhatsApp real usa Twilio (no aplica a seeds `SIM-*`).

## 8. Gestión de flujos

1. `npm run db:migrate`
2. `npm run flows:migrate-json-to-db` si venís de archivos en `data/flows/`
3. Backend + frontend con sesión admin
4. UI: **Flujos** → listado y editor de conversación (`/flows/:flowId/conversation`)
5. API del editor: `/api/flows` (documento Flow ↔ tablas DB)

Auditoría unificación: `audit/flow-db-unification-audit.md`

## 9. Verificación rápida del inbox

1. `npm run db:seed-conversations`
2. Abrir `/conversations`
3. Filtrar **Simulador** / **Esperando humano**
4. Abrir **Simulación - Asignada** → probar **Enviar** (sin Twilio)
