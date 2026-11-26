#!/usr/bin/env bash
# Rechaza secretos staged antes de que entren al historial.
set -euo pipefail

fail=0
while IFS= read -r path; do
  [[ -z "${path}" ]] && continue
  base="$(basename "${path}")"
  case "${path}" in
    */.env|.env|.env.*)
      case "${base}" in
        .env.example|.env.*.example) ;;
        *)
          echo "[secrets] rechazado: archivo de entorno en staging (${path})" >&2
          fail=1
          ;;
      esac
      ;;
  esac
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
