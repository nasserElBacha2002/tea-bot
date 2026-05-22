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

## 6. FLOW_STORAGE_MODE (independencia de JSON)

| Valor | Comportamiento |
|--------|----------------|
| `json` | Runtime lee `data/flows/` |
| `db` | **Solo** `flow_version_snapshots` (sin fallback a JSON) |
| `db_with_json_fallback` | DB primero; si falla, JSON + warning |

```env
FLOW_STORAGE_MODE=db
```

Reiniciar el servidor tras cambiar el modo. Al arrancar verás `FLOW_STORAGE_MODE=db` y logs `[DbFlowLoader]`.

**Prueba DoD:** renombrar `data/flows` → `data/flows_DISABLED` y confirmar que el bot sigue cargando `main-menu` desde DB.

Checklist completo: `audit/dod-verification.md`

## 7. Respuestas manuales sin Twilio

Conversaciones seed usan `provider=internal` → `POST .../messages` solo persiste en DB.

`provider=twilio` + canal WhatsApp real usa Twilio (no aplica a seeds `SIM-*`).

## 8. Gestión de flujos (Fase 6)

1. `npm run db:migrate` (incluye `004_audit_logs.sql`)
2. Backend + frontend con sesión admin
3. UI: **Flujos DB** → `/admin/flows`
4. Crear borrador desde versión publicada → editar mensaje → **Validar** → **Publicar**
5. API: prefijo `/api/flow-management` (ver `audit/phase6-flow-management.md`)

El editor JSON legacy sigue en `/flows` (archivos en disco).

## 9. Verificación rápida del inbox

1. `npm run db:seed-conversations`
2. Abrir `/conversations`
3. Filtrar **Simulador** / **Esperando humano**
4. Abrir **Simulación - Asignada** → probar **Enviar** (sin Twilio)
