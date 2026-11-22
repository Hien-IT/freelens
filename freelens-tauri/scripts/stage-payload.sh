#!/bin/bash
# Copyright (c) Freelens Authors. All rights reserved.
# Licensed under MIT License. See LICENSE in root directory for more information.
#
# Stages what the installer of the experimental build carries besides the core
# and the spike UI (specs/001-tauri-shell-spike/research.md, R8): kubectl and
# helm, verified against freelens/binaries.lock.json, and the renderer bundle
# without its source maps. freelens-k8s-proxy is not shipped.
set -euo pipefail

PACKAGE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(dirname "$PACKAGE")
BUILD="$ROOT/freelens/static/build"
BINARIES="$ROOT/freelens/binaries/client/darwin/arm64"
OUT="$PACKAGE/src-tauri/payload"

if [[ ${FREELENS_SKIP_DOWNLOAD_BINARIES-} == true ]]; then
  echo "FREELENS_SKIP_DOWNLOAD_BINARIES=true skips the verification of kubectl and helm; unset it" >&2
  exit 1
fi
if [[ ! -f "$BUILD/index.html" ]]; then
  echo "$BUILD/index.html is missing: run pnpm build first" >&2
  exit 1
fi

# Re-hashes kubectl and helm against the lock, downloading them again on a mismatch.
(cd "$ROOT/freelens" && pnpm build:binaries)

rm -rf "$OUT"
mkdir -p "$OUT/arm64" "$OUT/renderer"
cp "$BINARIES/kubectl" "$BINARIES/helm" "$OUT/arm64/"
rsync -a --exclude '*.map' --exclude 'main.js' --exclude 'main.js.*' "$BUILD/" "$OUT/renderer/"
