#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
mkdir -p "${ROOT}/audit/raw"

SEMGREP_BIN="${SEMGREP_BIN:-}"
if [[ -z "${SEMGREP_BIN}" ]]; then
  VENV_DIR="${SEMGREP_VENV:-${HOME}/.cache/tea-bot/semgrep-venv}"
  if [[ -x "${VENV_DIR}/bin/semgrep" ]]; then
    SEMGREP_BIN="${VENV_DIR}/bin/semgrep"
  elif command -v semgrep >/dev/null 2>&1; then
    SEMGREP_BIN="$(command -v semgrep)"
  fi
fi

if [[ -z "${SEMGREP_BIN}" || ! -x "${SEMGREP_BIN}" ]]; then
  echo "[sast] semgrep no está instalado (bash scripts/ci/install-semgrep.sh)" >&2
  exit 2
fi

out="${ROOT}/audit/raw/semgrep.json"
rm -f "${out}"
set +e
"${SEMGREP_BIN}" scan \
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
