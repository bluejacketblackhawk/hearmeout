#!/bin/bash
# Compile HearMeOutHelper with the Swift compiler that ships with Xcode /
# the Command Line Tools. No packages, no SPM, no download needed. Output
# lands in ../bin/helper/ as a universal binary — the same bin/ payload is
# bundled into both the arm64 and x64 apps, and Intel iMacs are first-class.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "error: swiftc not found — install the Xcode Command Line Tools (xcode-select --install)" >&2
  exit 1
fi

OUT=../bin/helper
mkdir -p "$OUT"

swiftc -O -swift-version 5 -target arm64-apple-macos11.0 \
  HearMeOutHelper.swift -o "$OUT/HearMeOutHelper-arm64"
swiftc -O -swift-version 5 -target x86_64-apple-macos11.0 \
  HearMeOutHelper.swift -o "$OUT/HearMeOutHelper-x64"
lipo -create "$OUT/HearMeOutHelper-arm64" "$OUT/HearMeOutHelper-x64" \
  -output "$OUT/HearMeOutHelper"
rm -f "$OUT/HearMeOutHelper-arm64" "$OUT/HearMeOutHelper-x64"

echo "built bin/helper/HearMeOutHelper ($(lipo -archs "$OUT/HearMeOutHelper"))"
