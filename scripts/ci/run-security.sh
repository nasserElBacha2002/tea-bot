#!/usr/bin/env bash
# Suite de seguridad. Cada check bloquea por sí mismo: no queda en estado "findings".
# Se corren todos para dejar reportes; el exit code es distinto de 0 si alguno falla.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
mkdir -p "${ROOT}/audit/raw"

# Evitar que un reporte viejo apruebe una corrida incompleta.
rm -f \
  "${ROOT}/audit/raw/gitleaks-history.json" \
  "${ROOT}/audit/raw/gitleaks-worktree.json" \
  "${ROOT}/audit/raw/npm-audit-whatsapp-bot.json" \
  "${ROOT}/audit/raw/npm-audit-frontend.json" \
  "${ROOT}/audit/raw/semgrep.json" \
  "${ROOT}/audit/raw/hadolint.json" \
  "${ROOT}/audit/raw/trivy.json" \
  "${ROOT}/audit/security-summary.md"

fail=0
run_check() {
  local name="$1"
  local script="$2"
  local code=0
  echo "== ${name} =="
  set +e
  bash "${script}"
  code=$?
  set -e
  if [[ "${code}" -eq 0 ]]; then
    echo "[ok] ${name}"
  else
    echo "[fail] ${name} (exit ${code})" >&2
    fail=1
  fi
}

run_check "gitleaks" "${ROOT}/scripts/secrets/scan.sh"
run_check "npm-audit" "${ROOT}/scripts/ci/run-npm-audit.sh"
run_check "semgrep" "${ROOT}/scripts/ci/run-semgrep.sh"
run_check "hadolint" "${ROOT}/scripts/ci/run-hadolint.sh"
run_check "trivy" "${ROOT}/scripts/ci/run-trivy.sh"

python3 - "${ROOT}" "${fail}" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
fail = sys.argv[2] != "0"
text = """# Seguridad Tea Bot

Este reporte es el artefacto del job de seguridad. El exit code del script es el veredicto:
un hallazgo nuevo de gitleaks, un advisory HIGH/CRITICAL fuera de la allowlist, o un ERROR
nuevo de semgrep/hadolint/trivy misconfig hace fallar el check. No queda en estado informativo.

- Gitleaks: `audit/raw/gitleaks-history.json`, `audit/raw/gitleaks-worktree.json`
- npm audit (`--omit=dev`, igual que en CI): `audit/raw/npm-audit-*.json`
- Semgrep: `audit/raw/semgrep.json`
- Hadolint: `audit/raw/hadolint.json`
- Trivy: `audit/raw/trivy.json` (incluye vulnerabilidades HIGH/CRITICAL sin parche)

Resultado de esta corrida: {status}
""".format(status="FAIL" if fail else "PASS")
(root / "audit" / "security-summary.md").write_text(text, encoding="utf-8")
PY

if [[ "${fail}" -ne 0 ]]; then
  echo "[security] FAIL" >&2
  exit 1
fi
echo "[security] PASS"
exit 0
