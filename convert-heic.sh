#!/bin/bash
# Converts HEIC files in media/ to JPG then removes originals.
# Run once after dropping files in: bash convert-heic.sh
# Requires ImageMagick: sudo apt install imagemagick

cd "$(dirname "$0")"

if ! command -v convert &>/dev/null; then
  echo "ImageMagick not found. Run: sudo apt install imagemagick"
  exit 1
fi

count=0
for f in media/*.HEIC media/*.heic; do
  [ -f "$f" ] || continue
  out="${f%.*}.jpg"
  if convert "$f" "$out"; then
    rm "$f"
    echo "✓ $(basename "$f") → $(basename "$out")"
    ((count++))
  else
    echo "✗ failed: $f"
  fi
done

echo "Done. Converted $count HEIC files."
