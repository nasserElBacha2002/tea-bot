#!/usr/bin/env bash
# Auditoría de calidad. Los hallazgos heredados no tumben el proceso en modo diagnóstico.
# AUDIT_STRICT=1 hace fallar solo regresiones contra el baseline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export AUDIT_RUN_ID="${RUN_ID}"
mkdir -p "${AUDIT_RAW}"

log_info "run ${RUN_ID}"

{
  echo "=== backend node --check ==="
} > "${AUDIT_RAW}/backend-syntax.txt"
err_file="${AUDIT_RAW}/backend-syntax.err"
: > "${err_file}"
while IFS= read -r -d '' file; do
  if ! node --check "${file}" 2>>"${err_file}"; then
    echo "FAIL ${file#"${REPO_ROOT}/"}" >> "${AUDIT_RAW}/backend-syntax.txt"
  fi
done < <(find "${REPO_ROOT}/whatsapp-bot/src" -name '*.js' -type f -print0)

if [[ "${AUDIT_SKIP_RUNTIME:-0}" == "1" ]]; then
  export AUDIT_RUNTIME=0
  rm -f "${AUDIT_RAW}/frontend-eslint.json" \
    "${AUDIT_RAW}/frontend-tsc.txt" \
    "${AUDIT_RAW}/backend-checkjs.txt" \
    "${AUDIT_RAW}/backend-coverage.txt"
  log_warn "AUDIT_SKIP_RUNTIME=1: no se corre eslint, tsc, checkJs ni cobertura"
else
  export AUDIT_RUNTIME=1
  TSC_JS="${REPO_ROOT}/frontend/node_modules/typescript/lib/tsc.js"
  if [[ ! -f "${TSC_JS}" ]]; then
    log_warn "TypeScript no está instalado en frontend/node_modules"
    echo "STATUS: SKIPPED" > "${AUDIT_RAW}/frontend-tsc.txt"
    echo "STATUS: SKIPPED" > "${AUDIT_RAW}/backend-checkjs.txt"
  else
    log_info "frontend tsc"
    set +e
    (cd "${REPO_ROOT}/frontend" && node "${TSC_JS}" -b --noEmit --pretty false) \
      > "${AUDIT_RAW}/frontend-tsc.txt" 2>&1
    set -e
    log_info "backend checkJs"
    set +e
    node "${TSC_JS}" -p "${REPO_ROOT}/scripts/audit/tsconfig.backend.checkjs.json" --pretty false --noEmit \
      > "${AUDIT_RAW}/backend-checkjs.txt" 2>&1
    set -e
  fi

  if [[ ! -d "${REPO_ROOT}/frontend/node_modules/eslint" ]]; then
    log_warn "ESLint no está instalado"
    echo "STATUS: SKIPPED" > "${AUDIT_RAW}/frontend-eslint.json"
  else
    log_info "frontend eslint"
    set +e
    (cd "${REPO_ROOT}/frontend" && node ./node_modules/eslint/bin/eslint.js . \
      --format json --output-file "${AUDIT_RAW}/frontend-eslint.json")
    set -e
    if [[ ! -s "${AUDIT_RAW}/frontend-eslint.json" ]]; then
      echo "[]" > "${AUDIT_RAW}/frontend-eslint.json"
    fi
  fi

  log_info "backend unit coverage"
  set +e
  node "${REPO_ROOT}/scripts/audit/run_backend_unit_coverage.mjs" \
    > "${AUDIT_RAW}/backend-coverage.txt" 2>&1
  set -e
fi

log_info "scanners"
python3 "${SCRIPT_DIR}/run_framework_audit.py" --run-id "${RUN_ID}" --print-summary

if [[ "${AUDIT_STRICT:-0}" == "1" ]]; then
  python3 "${SCRIPT_DIR}/enforce_quality_gate.py" --strict
else
  python3 "${SCRIPT_DIR}/enforce_quality_gate.py" || true
  log_info "modo diagnóstico. npm run audit:strict aplica el gate."
fi
