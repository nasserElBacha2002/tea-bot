# DIN-552 — Findings resolution matrix (corrections round 1)

| ID | Finding | Resolution | Evidence |
|----|---------|------------|----------|
| P1-01 | `UnboundLocalError` (`del map_key`) en `_ingest_function_metrics` | Eliminado en commit previo; ingest + maps validados con test | `test_function_metrics_ingest_builds_maps` |
| P1-02 | Unit tests `exit 1` normalizado como `failed=1` | `fail_count` real vía TAP; breakdown assertion/config/infra; bloqueo por regresión de conteo | `run_backend_unit_coverage.mjs`, `backend-unit-tests.json` |
| P1-03 | Integridad scanners / `ok:true` con parse errors | Telemetría `scanner_telemetry`; `ok:false` con parse/readdir; `framework_status` incomplete | `run_framework_audit.py`, `function_metrics.mjs` |
| P1-04 | `eslint-disable` altera métricas | `linterOptions.noInlineConfig: true` | `function_metrics.spec.mjs` |
| P1-05 | Matching components/pages y axios HTTP | Globs `frontend/src/components/**` y `pages/**`; regla `components-must-not-call-axios-http` | `test_design_scanners.py` |
| P1-06 | Excepciones axios demasiado amplias | Schema `allowed_members`; `axios_allowed_usage`; excepción rechazada si hay HTTP | `audit-architecture.json`, `architecture_util.py` |
| P2 | Magnitud CC por función | Mapa `functions.cyclomatic_peak` en gate progresivo | `baseline.py` progressive maps |
| P2 | `readdir` silenciado | Contadores `read_errors` / `readdir_errors` en dead_exports y function-metrics | scanners `*.mjs` |
| P2 | Catches `return` sin `;` | Regex actualizado en `exceptions.py` | `test_catch_return_without_semicolon` |
| P2 | ENV backend vs Vite | `backend_vars` / `vite_vars` en evidence de `dead_env` | `dead_env.py` |
| P2 | God class `?.` inflaba ramas | Quitado `?.` de `BRANCH_RE` | `heuristics.py` |
| P2 | Baseline vs main | `baseline-comparison.md` (métricas `fail_count` + `cyclomatic_peak`) | baseline patch justificado |