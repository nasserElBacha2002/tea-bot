#!/usr/bin/env bash
# semgrep 1.110.0 no arranca en Python 3.14 (protobuf: Metaclasses with custom tp_new).
set -euo pipefail

PY="${PYTHON:-python3}"
if ! command -v "${PY}" >/dev/null 2>&1; then
  echo "[semgrep] no está ${PY}" >&2
  exit 2
fi

read -r major minor < <("${PY}" -c 'import sys; print(sys.version_info[0], sys.version_info[1])')
if [[ "${major}" -gt 3 || ( "${major}" -eq 3 && "${minor}" -ge 14 ) ]]; then
  echo "[semgrep] semgrep 1.110.0 no corre en Python ${major}.${minor}. Usá Python 3.12." >&2
  exit 2
fi

"${PY}" -m pip install --user "semgrep==1.110.0"
if ! command -v semgrep >/dev/null 2>&1; then
  echo "[semgrep] el binario no quedó en PATH. Agregá ~/.local/bin." >&2
  exit 2
fi
semgrep --version
