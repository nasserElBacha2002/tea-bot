#!/usr/bin/env bash
# Instala semgrep 1.110.0 en un venv aislado con Python 3.12.
# Python 3.14 rompe protobuf/OpenTelemetry; setuptools>=81 quita pkg_resources.
set -euo pipefail

SEMGREP_VERSION="1.110.0"
VENV_DIR="${SEMGREP_VENV:-${HOME}/.cache/tea-bot/semgrep-venv}"

resolve_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    echo "${PYTHON}"
    return
  fi
  for candidate in python3.12 python3; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      echo "${candidate}"
      return
    fi
  done
  echo "[semgrep] no hay Python 3.12 disponible" >&2
  exit 2
}

PY="$(resolve_python)"
read -r major minor < <("${PY}" -c 'import sys; print(sys.version_info[0], sys.version_info[1])')
if [[ "${major}" -ne 3 || "${minor}" -lt 10 || "${minor}" -ge 14 ]]; then
  echo "[semgrep] se necesita Python 3.10–3.13 (encontrado ${major}.${minor}). Usá Python 3.12." >&2
  exit 2
fi

mkdir -p "$(dirname "${VENV_DIR}")"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  "${PY}" -m venv "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
# setuptools>=81 elimina pkg_resources; OpenTelemetry de semgrep 1.110.0 aún lo importa.
python -m pip install --disable-pip-version-check "setuptools>=70,<81" "semgrep==${SEMGREP_VERSION}"

if [[ ! -x "${VENV_DIR}/bin/semgrep" ]]; then
  echo "[semgrep] el binario no quedó en ${VENV_DIR}/bin/semgrep" >&2
  exit 2
fi

"${VENV_DIR}/bin/semgrep" --version

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${VENV_DIR}/bin" >> "${GITHUB_PATH}"
fi
echo "[semgrep] instalado en ${VENV_DIR} (agregá ${VENV_DIR}/bin al PATH)"
