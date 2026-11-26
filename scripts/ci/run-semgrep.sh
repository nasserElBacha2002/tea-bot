#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
mkdir -p "${ROOT}/audit/raw"

if ! command -v semgrep >/dev/null 2>&1; then
  echo "[sast] semgrep no está instalado (pip install semgrep==1.110.0)" >&2
  exit 2
fi

out="${ROOT}/audit/raw/semgrep.json"
set +e
semgrep scan \
  --config "${ROOT}/scripts/ci/semgrep" \
  --config p/javascript \
  --config p/nodejs \
  --config p/react \
  --metrics=off \
  --quiet \
  --json \
  --output "${out}" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude "*.test.js" \
  --exclude "*.test.ts" \
  --exclude "*.test.tsx" \
  whatsapp-bot/src frontend/src
status=$?
set -e

if [[ "${status}" -gt 1 ]]; then
  echo "[sast] scanner: semgrep terminó con exit ${status}" >&2
  exit 2
fi
if [[ ! -s "${out}" ]]; then
  echo "[sast] scanner: semgrep no escribió reporte" >&2
  exit 2
fi

exec python3 "${ROOT}/scripts/ci/sast_baseline.py" \
  --kind semgrep \
  --current "${out}" \
  --baseline "${ROOT}/audit/baseline/semgrep.json"
