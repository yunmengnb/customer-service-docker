#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${1:-$ROOT_DIR/kf-docker.tar.gz}"
TEMP_ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/kf-docker.XXXXXX.tar.gz")"
trap 'rm -f "$TEMP_ARCHIVE"' EXIT

tar \
  --exclude='./.git' \
  --exclude='./.env' \
  --exclude='./kf-docker.tar.gz' \
  --exclude='*/node_modules' \
  --exclude='*/dist' \
  --exclude='./server/uploads' \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  --exclude='*.log' \
  --exclude='*/.gradle' \
  --exclude='*/build' \
  --exclude='*/local.properties' \
  --exclude='*.apk' \
  --exclude='*.aab' \
  --exclude='*.jks' \
  --exclude='*.keystore' \
  --exclude='*/signing/*.properties' \
  -czf "$TEMP_ARCHIVE" -C "$ROOT_DIR" .

rm -f "$OUTPUT"
mv "$TEMP_ARCHIVE" "$OUTPUT"
trap - EXIT

echo "安装包已生成：$OUTPUT"
