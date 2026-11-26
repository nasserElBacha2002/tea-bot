# Architecture rules validation

- Globs cover `frontend/src/**/components/**`, `frontend/src/components/**`, `frontend/src/**/pages/**`, `frontend/src/pages/**`.
- Default axios import in UI layers: blocking + `never_baseline`.
- HTTP axios calls: `components-must-not-call-axios-http` (critical, always blocking).
- Exceptions in `audit-architecture.json` require `allowed_members`:
  - HistoryTimeline: `isAxiosError`
  - MonitoringPage: `isCancel`
- Expired or out-of-scope usage leaves finding blocking (see `exception_applies`).

Automated: `scripts/audit/framework/tests/test_design_scanners.py`.