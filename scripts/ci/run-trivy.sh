#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
mkdir -p "${ROOT}/audit/raw"

if ! command -v trivy >/dev/null 2>&1; then
  echo "[trivy] no está instalado. bash scripts/ci/install-trivy.sh \"\$HOME/.local/bin\"" >&2
  exit 2
fi

out="${ROOT}/audit/raw/trivy.json"
rm -f "${out}"
# No usar --ignore-unfixed: HIGH/CRITICAL sin parche también se reportan.
# El veredicto lo da la política (advisory id + vencimiento) y el baseline de misconfig.
# Un fallo de trivy (DB, JSON inválido) sigue siendo exit != 0 y no se traga.
set +e
trivy fs \
  --quiet \
  --severity HIGH,CRITICAL \
  --scanners vuln,misconfig \
  --skip-dirs node_modules \
  --skip-dirs dist \
  --skip-dirs coverage \
  --skip-dirs .git \
  --skip-dirs audit/raw \
  --exit-code 0 \
  --format json \
  --output "${out}" \
  .
trivy_status=$?
set -e

if [[ "${trivy_status}" -ne 0 ]]; then
  echo "[trivy] scanner: trivy fs falló (exit ${trivy_status})" >&2
  exit 2
fi

if [[ ! -s "${out}" ]]; then
  echo "[trivy] scanner: reporte vacío" >&2
  exit 2
fi

fail=0
set +e
node "${ROOT}/scripts/ci/trivy-policy.mjs" "${out}"
policy_code=$?
set -e
if [[ "${policy_code}" -eq 2 ]]; then
  exit 2
fi
if [[ "${policy_code}" -ne 0 ]]; then
  fail=1
fi

set +e
python3 "${ROOT}/scripts/ci/sast_baseline.py" \
  --kind trivy-misconfig \
  --current "${out}" \
  --baseline "${ROOT}/audit/baseline/trivy-misconfig.json"
baseline_code=$?
set -e
if [[ "${baseline_code}" -eq 2 ]]; then
  exit 2
fi
if [[ "${baseline_code}" -ne 0 ]]; then
  fail=1
fi
exit "${fail}"
