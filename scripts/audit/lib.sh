#!/usr/bin/env bash
# Helpers for the quality audit. Source this file from bash, not from sh.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIT_DIR="${REPO_ROOT}/audit"
AUDIT_RAW="${AUDIT_DIR}/raw"

log_info() {
  echo "[audit] $*"
}

log_warn() {
  echo "[audit][warn] $*" >&2
}
