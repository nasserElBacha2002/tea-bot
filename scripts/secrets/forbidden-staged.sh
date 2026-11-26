#!/usr/bin/env bash
# Rechaza secretos staged antes de que entren al historial.
set -euo pipefail

is_env_file() {
  local path="$1"
  local base
  base="$(basename "${path}")"
  case "${base}" in
    .env|.env.*)
      case "${base}" in
        .env.example|.env.*.example) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

fail=0
while IFS= read -r path; do
  [[ -z "${path}" ]] && continue
  base="$(basename "${path}")"
  if is_env_file "${path}"; then
    echo "[secrets] rechazado: archivo de entorno en staging (${path})" >&2
    fail=1
  fi
  case "${base}" in
    credentials.json|*.pem|*.p12|*.keystore|id_rsa|id_rsa.pub)
      echo "[secrets] rechazado: archivo sensible en staging (${path})" >&2
      fail=1
      ;;
  esac
  if git diff --cached -- "${path}" | grep -qE '^\+.*(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----)'; then
    echo "[secrets] rechazado: patrón de secreto en staging (${path})" >&2
    fail=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACM)

exit "${fail}"
