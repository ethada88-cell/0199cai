#!/usr/bin/env bash
# Package 0199 mobile sources with git archive (committed tree only).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

PREFIX="online-cs/deploy/mobile"
DIST="$ROOT/$PREFIX/dist"
mkdir -p "$DIST"

if ! git cat-file -e "HEAD:$PREFIX/README.md" 2>/dev/null; then
  echo "error: $PREFIX is not in HEAD. Commit mobile sources first." >&2
  exit 1
fi

rev="$(git rev-parse --short HEAD)"
stamp="$(date -u +%Y%m%d)"

pack() {
  local path="$1"
  local out="$2"
  git archive --format=zip --prefix="$(basename "$out" .zip)/" "HEAD:$path" -o "$DIST/$out"
  echo "wrote $DIST/$out"
}

pack "$PREFIX/android/app0199" "app0199-android-src-${rev}.zip"
pack "$PREFIX/android/seat0199" "seat0199-android-src-${rev}.zip"
pack "$PREFIX/ios/App0199" "App0199-ios-src-${rev}.zip"
pack "$PREFIX/ios/Seat0199" "Seat0199-ios-src-${rev}.zip"
pack "$PREFIX" "mobile-0199-all-${rev}-${stamp}.zip"

# Stable names (overwrite) for download pages
cp -f "$DIST/app0199-android-src-${rev}.zip" "$DIST/app0199-android-src.zip"
cp -f "$DIST/seat0199-android-src-${rev}.zip" "$DIST/seat0199-android-src.zip"
cp -f "$DIST/App0199-ios-src-${rev}.zip" "$DIST/App0199-ios-src.zip"
cp -f "$DIST/Seat0199-ios-src-${rev}.zip" "$DIST/Seat0199-ios-src.zip"
cp -f "$DIST/mobile-0199-all-${rev}-${stamp}.zip" "$DIST/mobile-0199-all.zip"

# Mirror into web/download when present
WEB_DL="$ROOT/online-cs/web/download"
if [[ -d "$WEB_DL" ]]; then
  for f in \
    app0199-android-src.zip seat0199-android-src.zip \
    App0199-ios-src.zip Seat0199-ios-src.zip \
    mobile-0199-all.zip \
    app0199-release.apk seat0199-release.apk; do
    [[ -f "$DIST/$f" ]] && cp -f "$DIST/$f" "$WEB_DL/$f"
  done
fi

echo "done. rev=$rev"
ls -la "$DIST"/*.zip "$DIST"/*.apk 2>/dev/null || true
