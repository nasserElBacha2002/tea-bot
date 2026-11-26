# Auditoría de calidad y seguridad (DIN-444)

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
- líneas duplicadas entre archivos (con tolerancia) y ciclos de imports
- complejidad ciclomática por archivo cuando cruza el umbral y crece por encima del baseline

SOLID, cohesión, fan-out y god-class quedan en el reporte como heurísticas. Un ciclo nuevo o una métrica peor sí bloquean `audit:strict`.

El reporte por archivo, con evidencia y acciones P0/P1/P2, queda en `audit/audit-summary.md` (no se versiona; CI lo sube como artefacto `audit-report`).

## Seguridad (hallazgo crítico nuevo bloquea)

Mismos comandos en local y en CI.

```bash
bash scripts/ci/install-gitleaks.sh "$HOME/.local/bin"
bash scripts/ci/install-trivy.sh "$HOME/.local/bin"
bash scripts/ci/install-hadolint.sh "$HOME/.local/bin"
bash scripts/ci/install-semgrep.sh   # requiere Python 3.12; 3.14 rompe semgrep 1.110.0
export PATH="$HOME/.local/bin:$PATH"
npm run audit:security
npm run secrets:install-hook   # opcional: pre-commit con gitleaks
```

| Check | Qué bloquea |
| --- | --- |
| Gitleaks | Cualquier secreto en el historial completo (`--log-opts=--all`) o en el worktree. No hay allowlist de `.env` / `.env.*`. El checkout de CI usa `fetch-depth: 0`. |
| `npm audit --omit=dev` | Advisory `GHSA-*` high/critical que no esté en `scripts/ci/audit-allowlist.json` con `review_by` vigente. El id es el de la advisory, no el nombre del paquete. Una entrada vencida hace fallar el scanner. El mismo flag `--omit=dev` se usa en local y en CI. |
| Semgrep | Un `ERROR` nuevo respecto de `audit/baseline/semgrep.json` (reglas propias en `scripts/ci/semgrep/` más `p/javascript`, `p/nodejs` y `p/react`). |
| Hadolint | Un error nuevo en los Dockerfile respecto de `audit/baseline/hadolint.json`. |
| Trivy `fs` | Una vulnerabilidad high/critical fuera de `scripts/ci/trivy-allowlist.json` (id `CVE-` o `GHSA-`, con vencimiento) o un misconfig high/critical nuevo respecto de `audit/baseline/trivy-misconfig.json`. |

Si el scanner no puede correr o el reporte es inválido, el check sale con código 2. No queda en un estado “findings” que el workflow ignore.

El job `quality-gate` agrega `audit-artifacts` y `security`. Los dos tienen que pasar.

## Renovar una excepción

Editá la entrada en la allowlist: id de advisory, paquete, severidad, `review_by` (fecha ISO) y, si es critical, `critical_waiver`. No alcanza con el nombre del paquete. Cuando `review_by` vence, el check falla hasta renovarla o hasta quitar la entrada si el advisory ya no aplica.
