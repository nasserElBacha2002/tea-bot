#!/usr/bin/env bash
# npm audit de dependencias de producción. Mismo flag en local y en CI: --omit=dev.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "${ROOT}/audit/raw"
fail=0

for dir in whatsapp-bot frontend; do
  out="${ROOT}/audit/raw/npm-audit-${dir}.json"
  echo "[audit] npm audit --omit=dev ${dir}"
  set +e
  npm audit --omit=dev --json --prefix "${ROOT}/${dir}" > "${out}"
  status=$?
  set -e
  if [[ ! -s "${out}" ]]; then
    echo "[audit] scanner: npm audit no escribió JSON para ${dir} (exit ${status})" >&2
    exit 2
  fi
  if ! NPM_AUDIT_EXIT_CODE="${status}" node "${ROOT}/scripts/ci/evaluate-audit.mjs" < "${out}"; then
    code=$?
    if [[ "${code}" -eq 2 ]]; then
      exit 2
    fi
    fail=1
  fi
done

exit "${fail}"
