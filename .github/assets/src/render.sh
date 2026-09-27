#!/usr/bin/env bash
# Regenera las imágenes del README a partir de estos HTML (necesita Chromium y ImageMagick).
# Uso: .github/assets/src/render.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$(dirname "$SRC")"

shot() { # <html> <png> <ancho> <alto> [tema]
  chromium --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --virtual-time-budget=5000 \
    --window-size="$3,$4" --screenshot="$OUT/$2" "file://$SRC/$1${5:+#$5}" >/dev/null 2>&1
  magick "$OUT/$2" -strip -define png:compression-level=9 "$OUT/$2"
  echo "$2"
}

shot banner.html banner.png 1280 440
shot og.html og-image.png 1280 640
shot architecture.html architecture-dark.png 1600 940
shot architecture.html architecture-light.png 1600 940 light
cp "$SRC/logo.svg" "$OUT/logo.svg"
