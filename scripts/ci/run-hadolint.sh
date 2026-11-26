#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "${ROOT}/audit/raw"

if ! command -v hadolint >/dev/null 2>&1; then
  echo "[hadolint] no está instalado. bash scripts/ci/install-hadolint.sh \"\$HOME/.local/bin\"" >&2
  exit 2
fi

out="${ROOT}/audit/raw/hadolint.json"
rm -f "${out}"
set +e
hadolint --format json \
  "${ROOT}/whatsapp-bot/Dockerfile" \
  "${ROOT}/frontend/Dockerfile" > "${out}"
status=$?
set -e

# 0 = limpio, 1 = hallazgos. Cualquier otro código es fallo del scanner.
if [[ "${status}" -gt 1 ]]; then
  echo "[hadolint] scanner: exit ${status}" >&2
  exit 2
fi
if [[ ! -s "${out}" ]]; then
  echo "[hadolint] scanner: reporte vacío" >&2
  exit 2
fi

exec python3 "${ROOT}/scripts/ci/sast_baseline.py" \
  --kind hadolint \
  --current "${out}" \
  --baseline "${ROOT}/audit/baseline/hadolint.json"
