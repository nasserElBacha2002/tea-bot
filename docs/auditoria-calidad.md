# Auditoría de calidad y seguridad (DIN-444, diseño en DIN-552)

Scripts locales y el workflow `.github/workflows/quality-gate.yml`. No corrigen el código de la app: miden, comparan contra un baseline y fallan solo cuando corresponde.

## Calidad (informativa, con baseline)

```bash
npm ci --prefix whatsapp-bot
npm ci --prefix frontend
npm run audit          # diagnóstico, no falla por deuda heredada
npm run audit:baseline # guarda audit/baseline después de una corrida completa
npm run audit:strict   # falla si empeora respecto del baseline
```

`AUDIT_SKIP_RUNTIME=1 npm run audit` omite eslint, tsc, checkJs y la cobertura. Ese modo no puede actualizar el baseline.

El gate de calidad compara:

- errores de ESLint y de `tsc` del frontend
- errores de `tsc --checkJs` del backend (progresivo, `scripts/audit/tsconfig.backend.checkjs.json`, sin `strict`)
- `node --check` del backend
- cobertura de líneas de las pruebas unitarias del backend (sin integración SQL) y cobertura estructural de archivos con test colocalizado
- el exit code de esas pruebas unitarias (`backend.unit_tests.failed`): una falla nueva (regresión 0→1) bloquea aunque la cobertura no baje; la deuda de pruebas ya registrada en el baseline no se reabre
- líneas duplicadas entre archivos (con tolerancia) y ciclos de imports
- complejidad ciclomática por archivo cuando cruza el umbral y crece por encima del baseline

## Diseño y mantenibilidad (DIN-552)

Los scanners viven en `scripts/audit/framework/scanners/`. No modifican la app. Miden el árbol `whatsapp-bot/src` y `frontend/src` (sin tests) y se suman al mismo `npm run audit` / `npm run audit:strict` que corre el job `audit-artifacts`.

| Señal | Gate |
| --- | --- |
| Reglas de capa (controllers/routes → db o repositories, services → controllers/routes, repositories → controllers/twilio/services, components/pages → `axios`, backend ↔ frontend) | Bloquean siempre. No se guardan en el baseline (`scripts/audit/config/audit-policy.json`, `never_baseline_tools`). Una violación nueva no se puede tapar regenerando el baseline. |
| Excepción de arquitectura | `scripts/audit/config/audit-architecture.json`, con `expires_at`. Vencida, la regla vuelve a bloquear. Hoy cubre dos imports previos de `axios` (`isAxiosError` / `isCancel`) porque este ticket no cambia la app. |
| `services` que importan `query` desde `db` | Informativo hasta DIN-553. Sí puede quedar en el baseline. |
| Funciones de más de 80 líneas, CC ≥ 25 y más de 6 parámetros, por archivo | Baseline progresivo, tolerancia 0. Las mide `function_metrics.mjs` con ESLint (`complexity`, `max-lines-per-function`, `max-params`, `max-depth`, `max-statements`). |
| Score god-class por archivo (watch 9 / medium 14 / high 20) | Baseline progresivo, tolerancia 0, a partir del umbral watch. |
| Catch vacío | Baseline progresivo, tolerancia 0. |
| Catch que solo loguea, catch que devuelve un default, `@ts-ignore` / `eslint-disable` / `as any`, env leído y no documentado (`process.env` e `import.meta.env`, incluye `VITE_*`) | Baseline progresivo con tolerancia. |
| SOLID/GRASP, números mágicos, largo de línea (120/160/200), exports sin referencias (equivalente informativo de ts-prune), rutas de más de 350 líneas o 40 ramas | Solo en el reporte. |

El god-class y el SRP usan las señales completas (SQL fuera de repositories, incluida una llamada `query(` suelta, integraciones, dominios, imports, ramas y dependencias de constructor). `reliability.py` no se porta: la firma de Twilio se valida en la ruta (`twilio-webhook.routes.js` / `create-app.js`) y el scanner daba falsos positivos.

`AUDIT_SKIP_RUNTIME=1` sigue sin poder aprobar `audit:strict`. Además de eslint/tsc/checkJs/cobertura, el modo completo corre las métricas de función y los exports muertos; si esos scanners no arrancan, la corrida queda incompleta.

SOLID, cohesión, fan-out y el detalle de god-class quedan en el reporte como heurísticas. Un ciclo nuevo, una regla de capa, una prueba unitaria fallida, un scanner incompleto o una métrica peor sí bloquean `audit:strict`.

El reporte por archivo, con evidencia y acciones P0/P1/P2, queda en `audit/audit-summary.md` (no se versiona; CI lo sube como artefacto `audit-report`).

## Seguridad (hallazgo crítico nuevo bloquea)

Mismos comandos en local y en CI.

```bash
bash scripts/ci/install-gitleaks.sh "$HOME/.local/bin"
bash scripts/ci/install-trivy.sh "$HOME/.local/bin"
bash scripts/ci/install-hadolint.sh "$HOME/.local/bin"
bash scripts/ci/install-semgrep.sh   # venv aislado con Python 3.12; 3.14 rompe protobuf/OTel
export PATH="$HOME/.cache/tea-bot/semgrep-venv/bin:$HOME/.local/bin:$PATH"
npm run audit:security
npm run secrets:install-hook   # opcional: pre-commit con gitleaks
```

| Check | Qué bloquea |
| --- | --- |
| Gitleaks | Cualquier secreto en el historial completo (`--log-opts=--all`) o en el worktree. No hay allowlist de `.env` / `.env.*`. Excepciones de valor usan `condition = "AND"` (no excluyen el archivo entero). El checkout de CI usa `fetch-depth: 0`. |
| `npm audit --omit=dev` | Advisory `GHSA-*` high/critical que no esté en `scripts/ci/audit-allowlist.json` con `review_by` vigente. El id es el de la advisory, no el nombre del paquete. Una entrada vencida hace fallar el scanner. El mismo flag `--omit=dev` se usa en local y en CI. |
| Semgrep | Un `ERROR` nuevo (fingerprint por ocurrencia) respecto de `audit/baseline/semgrep.json` (reglas propias en `scripts/ci/semgrep/` más `p/javascript`, `p/nodejs` y `p/react`). |
| Hadolint | Un error nuevo en los Dockerfile respecto de `audit/baseline/hadolint.json`. |
| Trivy `fs` | Una vulnerabilidad high/critical (con o sin parche) fuera de `scripts/ci/trivy-allowlist.json` (id `CVE-` o `GHSA-`, con vencimiento) o un misconfig high/critical nuevo respecto de `audit/baseline/trivy-misconfig.json`. |

Para regenerar baselines de calidad o SAST hace falta `AUDIT_ALLOW_BASELINE_WRITE=1`. Sin ese control explícito no se pueden ocultar regresiones reescribiendo baselines.

Si el scanner no puede correr o el reporte es inválido, el check sale con código 2. No queda en un estado “findings” que el workflow ignore.

El job `quality-gate` agrega `audit-artifacts` y `security`. Los dos tienen que pasar.

## Renovar una excepción

Editá la entrada en la allowlist: id de advisory, paquete, severidad, `review_by` (fecha ISO) y, si es critical, `critical_waiver`. No alcanza con el nombre del paquete. Cuando `review_by` vence, el check falla hasta renovarla o hasta quitar la entrada si el advisory ya no aplica.

Una excepción de arquitectura se renueva en `scripts/audit/config/audit-architecture.json` (`rule`, `file`, `reason`, `expires_at`). No va al baseline de hallazgos.
