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
# exit-code 0: el veredicto lo da la política (advisory id + vencimiento) y el baseline de misconfig.
# Un fallo de trivy (DB, JSON inválido) sigue siendo exit != 0 y no se traga.
if ! trivy fs \
  --quiet \
  --severity HIGH,CRITICAL \
  --ignore-unfixed \
  --scanners vuln,misconfig \
  --skip-dirs node_modules \
  --skip-dirs dist \
  --skip-dirs coverage \
  --skip-dirs .git \
  --skip-dirs audit/raw \
  --exit-code 0 \
  --format json \
  --output "${out}" \
  .; then
  echo "[trivy] scanner: trivy fs falló" >&2
  exit 2
fi

if [[ ! -s "${out}" ]]; then
  echo "[trivy] scanner: reporte vacío" >&2
  exit 2
fi

fail=0
if ! node "${ROOT}/scripts/ci/trivy-policy.mjs" "${out}"; then
  code=$?
  if [[ "${code}" -eq 2 ]]; then
    exit 2
  fi
  fail=1
fi
if ! python3 "${ROOT}/scripts/ci/sast_baseline.py" \
  --kind trivy-misconfig \
  --current "${out}" \
  --baseline "${ROOT}/audit/baseline/trivy-misconfig.json"; then
  code=$?
  if [[ "${code}" -eq 2 ]]; then
    exit 2
  fi
  fail=1
fi
exit "${fail}"
