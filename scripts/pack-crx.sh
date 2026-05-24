#!/usr/bin/env bash
# Packs the production build at dist/ into a signed .crx using Chrome's
# --pack-extension. Generates and persists .crx-key.pem on first run so
# subsequent builds keep the same extension ID.

set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
KEY="$ROOT/.crx-key.pem"
VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"
OUT="$ROOT/$NAME-$VERSION.crx"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at $CHROME. Edit pack-crx.sh to point at your install."
  exit 1
fi

if [ ! -d "$DIST" ]; then
  echo "dist/ not found. Run 'npm run build' first."
  exit 1
fi

if [ -f "$KEY" ]; then
  echo "Using existing key at $KEY (same extension ID across builds)."
  "$CHROME" --pack-extension="$DIST" --pack-extension-key="$KEY" --no-message-box >/dev/null
else
  echo "No key found — Chrome will generate one and save it as .crx-key.pem."
  "$CHROME" --pack-extension="$DIST" --no-message-box >/dev/null
  mv "$ROOT/dist.pem" "$KEY"
  echo "Saved key to $KEY. Keep this file: losing it means future builds get a new extension ID."
fi

mv "$ROOT/dist.crx" "$OUT"

# Also produce a plain zip — recipients can "Load unpacked" the unzipped
# contents in chrome://extensions, bypassing Chrome's self-signed CRX block.
ZIP_OUT="$ROOT/$NAME-$VERSION.zip"
rm -f "$ZIP_OUT"
( cd "$DIST" && zip -qr "$ZIP_OUT" . )

echo ""
echo "Packed:"
echo "  CRX: $OUT  ($(du -h "$OUT" | cut -f1))   — for signed self-hosted distribution"
echo "  ZIP: $ZIP_OUT  ($(du -h "$ZIP_OUT" | cut -f1))   — unzip + Load unpacked in chrome://extensions"
