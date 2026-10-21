#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/extension"
DIST_DIR="$ROOT_DIR/dist"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to build the Chrome Web Store package." >&2
  exit 1
fi

VERSION="$(
  python3 - <<'PY' "$EXTENSION_DIR/manifest.json"
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
print(json.loads(manifest_path.read_text())["version"])
PY
)"

PACKAGE_NAME="pinterest-localboard-v${VERSION}-chrome-web-store.zip"
PACKAGE_PATH="$DIST_DIR/$PACKAGE_NAME"
PACKAGE_FILES=(
  "manifest.json"
  "popup.html"
  "popup.css"
  "popup.js"
  "background.js"
  "content.js"
  "vendor/jszip.min.js"
  "assets/localboard-logo.png"
  "icons/icon-16.png"
  "icons/icon-32.png"
  "icons/icon-48.png"
  "icons/icon-128.png"
)

node --check "$EXTENSION_DIR/popup.js"
node --check "$EXTENSION_DIR/background.js"
node --check "$EXTENSION_DIR/content.js"
python3 -m json.tool "$EXTENSION_DIR/manifest.json" >/dev/null

for package_file in "${PACKAGE_FILES[@]}"; do
  if [[ ! -f "$EXTENSION_DIR/$package_file" ]]; then
    echo "Required package file is missing: $package_file" >&2
    exit 1
  fi
done

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE_PATH"

(
  cd "$EXTENSION_DIR"
  zip -q "$PACKAGE_PATH" "${PACKAGE_FILES[@]}"
)

echo "Built $PACKAGE_PATH"
