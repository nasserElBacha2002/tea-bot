#!/usr/bin/env bash
# Gitleaks sobre el historial completo y sobre el worktree.
# No excluye .env / .env.*. Un hallazgo sale con código 1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
mkdir -p "${ROOT}/audit/raw"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[secrets] gitleaks no está instalado. Instalá con: bash scripts/ci/install-gitleaks.sh \"\$HOME/.local/bin\"" >&2
  exit 2
fi

rc=0

echo "[secrets] historial git completo (.gitleaks.toml, log --all)"
set +e
gitleaks detect \
  --source "${ROOT}" \
  --config "${ROOT}/.gitleaks.toml" \
  --log-opts="--all" \
  --redact \
  --no-banner \
  --report-format json \
  --report-path "${ROOT}/audit/raw/gitleaks-history.json"
hist_code=$?
set -e
if [[ "${hist_code}" -ne 0 ]]; then
  echo "[secrets] gitleaks encontró secretos en el historial (exit ${hist_code})" >&2
  rc=1
fi

echo "[secrets] worktree, sin allowlist de .env"
set +e
gitleaks detect \
  --source "${ROOT}" \
  --config "${ROOT}/.gitleaks.toml" \
  --no-git \
  --redact \
  --no-banner \
  --report-format json \
  --report-path "${ROOT}/audit/raw/gitleaks-worktree.json"
wt_code=$?
set -e
if [[ "${wt_code}" -ne 0 ]]; then
  echo "[secrets] gitleaks encontró secretos en el worktree (exit ${wt_code})" >&2
  rc=1
fi

if [[ "${rc}" -eq 0 ]]; then
  echo "[secrets] ok"
fi
exit "${rc}"
