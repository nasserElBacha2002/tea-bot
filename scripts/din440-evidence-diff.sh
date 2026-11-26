#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/DIN-440/phase-corrections}"
mkdir -p "$OUT_DIR"

TMP_LIST="$(mktemp)"
{
  git -C "$ROOT" diff --name-only --diff-filter=ACMRT 2>/dev/null || true
  git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null || true
} | rg '^(whatsapp-bot/src/(utils/conversation-search|repositories/conversation-search|services/conversation-search|middleware/conversation-search|services/conversation-inbox|controllers/conversations|routes/conversations|repositories/conversation-message)|frontend/src/features/conversations/)' | sort -u > "$TMP_LIST"

FILES=()
while IFS= read -r line; do
  FILES+=("$line")
done < "$TMP_LIST"

{
  echo "# DIN-440 scoped diff — $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "# BASE_SHA=$(git -C "$ROOT" rev-parse HEAD)"
  if ((${#FILES[@]} > 0)); then
    git -C "$ROOT" diff -- "${FILES[@]}" 2>/dev/null || true
  fi
  for f in "${FILES[@]}"; do
    if [[ ! -f "$ROOT/$f" ]]; then continue; fi
    if git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then continue; fi
    echo ""
    echo "### NEW FILE: $f ###"
    cat "$ROOT/$f"
  done
} > "$OUT_DIR/implementation-corrections-diff.txt"

if ((${#FILES[@]} > 0)); then
  git -C "$ROOT" diff --stat -- "${FILES[@]}" 2>/dev/null | tee "$OUT_DIR/implementation-corrections-diffstat.txt" || true
else
  echo "(no DIN-440 files)" > "$OUT_DIR/implementation-corrections-diffstat.txt"
fi

cp "$OUT_DIR/implementation-corrections-diff.txt" "$OUT_DIR/latest-diff.txt"
cp "$OUT_DIR/implementation-corrections-diffstat.txt" "$OUT_DIR/latest-diffstat.txt"
git -C "$ROOT" status -sb | tee "$OUT_DIR/latest-status.txt"
rm -f "$TMP_LIST"