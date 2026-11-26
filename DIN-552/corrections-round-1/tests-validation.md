# Tests validation (Buenos Aires)

Executed on 2026-11-26 ~20:05 ART:

| Command | Result |
|---------|--------|
| `npm run test:audit` | PASS (27 framework + 20 ci + 2 function_metrics) |
| `npm run test:audit-policy` | PASS (8) |
| `npm run audit:strict` | PASS (gate regression) |
| `npm run audit:security` | FAIL locally (semgrep/hadolint/trivy not installed on agent VM; CI images install them) |

Backend unit tests (audit runtime): exit 1, `fail_count=29`, assertion-heavy (`twilio-message-delivery.service.test.js`).