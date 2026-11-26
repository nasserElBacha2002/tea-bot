# Baseline comparison (vs `main`)

Compared `audit/baseline/metrics.baseline.json` on this branch against `origin/main` (DIN-444 baseline).

## Intentional metric baseline changes (not a full regen for PASS)

| Metric | main | this branch | Justification |
|--------|------|-------------|---------------|
| `backend.unit_tests.fail_count` | absent | `29` | P1-02: stop masking failures as `failed=1`; TAP-backed count |
| `backend.unit_tests.failed` | `1` | `1` | Binary flag unchanged; regression still 0→1 |
| `maps.functions.cyclomatic_peak` | absent | per-file max CC | P2: magnitude regression on known hot files |

All other progressive numbers remain aligned with the DIN-552 initial baseline except scanner-driven drift within tolerance (`backend.coverage.lines_pct` ~54.2).