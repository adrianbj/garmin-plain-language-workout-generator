#!/usr/bin/env bash
# Renders public/icons/icon{16,32,48,128}.png from assets/icon.svg via ImageMagick.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets/icon.svg"
OUT_DIR="$ROOT/public/icons"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) not found. Install: brew install imagemagick"
  exit 1
fi

mkdir -p "$OUT_DIR"
for size in 16 32 48 128; do
  magick -background none "$SRC" -resize "${size}x${size}" "$OUT_DIR/icon${size}.png"
  echo "  $OUT_DIR/icon${size}.png  ($(du -h "$OUT_DIR/icon${size}.png" | cut -f1))"
done

echo "Done."
