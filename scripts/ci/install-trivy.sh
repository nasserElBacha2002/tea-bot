#!/usr/bin/env sh
set -eu
VERSION="0.73.0"
DEST="${1:-/usr/local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64)
    ASSET="trivy_${VERSION}_Linux-64bit.tar.gz"
    SUM="2edd39da482bb4e9831962487b68f68e3928ec3137794757f54d00383d79547b"
    ;;
  Darwin-arm64)
    ASSET="trivy_${VERSION}_macOS-ARM64.tar.gz"
    SUM="80cc25faaf6378e37701202d0b4f9f43d9e413d198d594ba60fdf559fe44a683"
    ;;
  *)
    echo "unsupported platform: $OS $ARCH" >&2
    exit 1
    ;;
esac
URL="https://github.com/aquasecurity/trivy/releases/download/v${VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/$ASSET"
if command -v sha256sum >/dev/null 2>&1; then
  echo "${SUM}  ${TMP}/${ASSET}" | sha256sum -c -
else
  echo "${SUM}  ${TMP}/${ASSET}" | shasum -a 256 -c -
fi
tar -xzf "$TMP/$ASSET" -C "$TMP" trivy
mkdir -p "$DEST"
install -m 0755 "$TMP/trivy" "$DEST/trivy"
"$DEST/trivy" --version
