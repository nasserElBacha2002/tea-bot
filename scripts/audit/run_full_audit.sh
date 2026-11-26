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

# Eliminar reportes obsoletos antes de la corrida para no aprobar con artefactos viejos.
rm -f \
  "${AUDIT_RAW}/backend-syntax.txt" \
  "${AUDIT_RAW}/backend-syntax.err" \
  "${AUDIT_RAW}/frontend-eslint.json" \
  "${AUDIT_RAW}/frontend-eslint.exit" \
  "${AUDIT_RAW}/frontend-tsc.txt" \
  "${AUDIT_RAW}/frontend-tsc.exit" \
  "${AUDIT_RAW}/backend-checkjs.txt" \
  "${AUDIT_RAW}/backend-checkjs.exit" \
  "${AUDIT_RAW}/backend-coverage.txt" \
  "${AUDIT_RAW}/backend-unit-tests.exit" \
  "${AUDIT_DIR}/audit-summary.md" \
  "${AUDIT_DIR}/audit-status.json" \
  "${AUDIT_DIR}/findings.json" \
  "${AUDIT_DIR}/metrics.json" \
  "${AUDIT_DIR}/current-run.json"

{
  echo "=== backend node --check ==="
} > "${AUDIT_RAW}/backend-syntax.txt"
err_file="${AUDIT_RAW}/backend-syntax.err"
: > "${err_file}"
while IFS= read -r -d '' file; do
  set +e
  node --check "${file}" 2>>"${err_file}"
  check_code=$?
  set -e
  if [[ "${check_code}" -ne 0 ]]; then
    echo "FAIL ${file#"${REPO_ROOT}/"}" >> "${AUDIT_RAW}/backend-syntax.txt"
  fi
done < <(find "${REPO_ROOT}/whatsapp-bot/src" -name '*.js' -type f -print0)

runtime_incomplete=0
if [[ "${AUDIT_SKIP_RUNTIME:-0}" == "1" ]]; then
  export AUDIT_RUNTIME=0
  log_warn "AUDIT_SKIP_RUNTIME=1: no se corre eslint, tsc, checkJs ni cobertura"
  if [[ "${AUDIT_STRICT:-0}" == "1" ]]; then
    log_warn "AUDIT_SKIP_RUNTIME=1 no puede aprobar audit:strict"
    runtime_incomplete=1
  fi
else
  export AUDIT_RUNTIME=1
  TSC_JS="${REPO_ROOT}/frontend/node_modules/typescript/lib/tsc.js"
  if [[ ! -f "${TSC_JS}" ]]; then
    log_warn "TypeScript no está instalado en frontend/node_modules"
    echo "STATUS: MISSING_TOOL" > "${AUDIT_RAW}/frontend-tsc.txt"
    echo "2" > "${AUDIT_RAW}/frontend-tsc.exit"
    echo "STATUS: MISSING_TOOL" > "${AUDIT_RAW}/backend-checkjs.txt"
    echo "2" > "${AUDIT_RAW}/backend-checkjs.exit"
    runtime_incomplete=1
  else
    log_info "frontend tsc"
    set +e
    (cd "${REPO_ROOT}/frontend" && node "${TSC_JS}" -b --noEmit --pretty false) \
      > "${AUDIT_RAW}/frontend-tsc.txt" 2>&1
    tsc_code=$?
    set -e
    echo "${tsc_code}" > "${AUDIT_RAW}/frontend-tsc.exit"

    log_info "backend checkJs"
    set +e
    node "${TSC_JS}" -p "${REPO_ROOT}/scripts/audit/tsconfig.backend.checkjs.json" --pretty false --noEmit \
      > "${AUDIT_RAW}/backend-checkjs.txt" 2>&1
    checkjs_code=$?
    set -e
    echo "${checkjs_code}" > "${AUDIT_RAW}/backend-checkjs.exit"
  fi

  if [[ ! -d "${REPO_ROOT}/frontend/node_modules/eslint" ]]; then
    log_warn "ESLint no está instalado"
    echo "STATUS: MISSING_TOOL" > "${AUDIT_RAW}/frontend-eslint.json"
    echo "2" > "${AUDIT_RAW}/frontend-eslint.exit"
    runtime_incomplete=1
  else
    log_info "frontend eslint"
    set +e
    (cd "${REPO_ROOT}/frontend" && node ./node_modules/eslint/bin/eslint.js . \
      --format json --output-file "${AUDIT_RAW}/frontend-eslint.json")
    eslint_code=$?
    set -e
    echo "${eslint_code}" > "${AUDIT_RAW}/frontend-eslint.exit"
    # ESLint exit 1 = hallazgos; 0 = limpio. No fabricar un [] vacío si falló el scanner.
    if [[ "${eslint_code}" -gt 1 ]]; then
      log_warn "ESLint falló operativamente (exit ${eslint_code})"
      runtime_incomplete=1
      if [[ ! -s "${AUDIT_RAW}/frontend-eslint.json" ]]; then
        echo "{\"error\":\"eslint_failed\",\"exit\":${eslint_code}}" > "${AUDIT_RAW}/frontend-eslint.json"
      fi
    elif [[ ! -s "${AUDIT_RAW}/frontend-eslint.json" ]]; then
      log_warn "ESLint no escribió reporte"
      runtime_incomplete=1
      echo "{\"error\":\"eslint_empty_report\",\"exit\":${eslint_code}}" > "${AUDIT_RAW}/frontend-eslint.json"
    fi
  fi

  log_info "backend unit coverage"
  set +e
  node "${REPO_ROOT}/scripts/audit/run_backend_unit_coverage.mjs" \
    > "${AUDIT_RAW}/backend-coverage.txt" 2>&1
  unit_code=$?
  set -e
  echo "${unit_code}" > "${AUDIT_RAW}/backend-unit-tests.exit"
  if [[ "${unit_code}" -ne 0 ]]; then
    log_warn "backend unit tests fallaron (exit ${unit_code}); no se confunde con cobertura"
  fi
fi

export AUDIT_RUNTIME_INCOMPLETE="${runtime_incomplete}"

log_info "scanners"
python3 "${SCRIPT_DIR}/run_framework_audit.py" --run-id "${RUN_ID}" --print-summary

if [[ "${AUDIT_STRICT:-0}" == "1" ]]; then
  python3 "${SCRIPT_DIR}/enforce_quality_gate.py" --strict
else
  python3 "${SCRIPT_DIR}/enforce_quality_gate.py" || true
  log_info "modo diagnóstico. npm run audit:strict aplica el gate."
fi
