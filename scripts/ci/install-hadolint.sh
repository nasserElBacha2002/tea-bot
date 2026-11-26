#!/usr/bin/env sh
set -eu
VERSION="v2.12.0"
DEST="${1:-/usr/local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64)
    ASSET="hadolint-Linux-x86_64"
    SUM="56de6d5e5ec427e17b74fa48d51271c7fc0d61244bf5c90e828aab8362d55010"
    ;;
  Darwin-x86_64|Darwin-arm64)
    # El release v2.12.0 publica el binario macOS como x86_64 (corre con Rosetta en Apple Silicon).
    ASSET="hadolint-Darwin-x86_64"
    SUM="2a5b7afcab91645c39a7cebefcd835b865f7488e69be24567f433dfc3d41cd27"
    ;;
  *)
    echo "unsupported platform: $OS $ARCH" >&2
    exit 1
    ;;
esac
URL="https://github.com/hadolint/hadolint/releases/download/${VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/hadolint"
if command -v sha256sum >/dev/null 2>&1; then
  echo "${SUM}  ${TMP}/hadolint" | sha256sum -c -
else
  echo "${SUM}  ${TMP}/hadolint" | shasum -a 256 -c -
fi
mkdir -p "$DEST"
install -m 0755 "$TMP/hadolint" "$DEST/hadolint"
"$DEST/hadolint" --version
