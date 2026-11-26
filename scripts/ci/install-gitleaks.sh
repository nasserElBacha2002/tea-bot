#!/usr/bin/env sh
set -eu
VERSION="8.30.1"
DEST="${1:-/usr/local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64)
    ASSET="gitleaks_${VERSION}_linux_x64.tar.gz"
    SUM="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Darwin-arm64)
    ASSET="gitleaks_${VERSION}_darwin_arm64.tar.gz"
    SUM="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  *)
    echo "unsupported platform: $OS $ARCH" >&2
    exit 1
    ;;
esac
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/$ASSET"
if command -v sha256sum >/dev/null 2>&1; then
  echo "${SUM}  ${TMP}/${ASSET}" | sha256sum -c -
else
  echo "${SUM}  ${TMP}/${ASSET}" | shasum -a 256 -c -
fi
tar -xzf "$TMP/$ASSET" -C "$TMP" gitleaks
mkdir -p "$DEST"
install -m 0755 "$TMP/gitleaks" "$DEST/gitleaks"
"$DEST/gitleaks" version
