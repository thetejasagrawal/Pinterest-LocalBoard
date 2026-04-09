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

mkdir -p "$DIST_DIR"
rm -f "$PACKAGE_PATH"

(
  cd "$EXTENSION_DIR"
  zip -qr "$PACKAGE_PATH" . -x "*.DS_Store"
)

echo "Built $PACKAGE_PATH"
