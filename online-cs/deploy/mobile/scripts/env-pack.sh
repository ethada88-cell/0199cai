#!/usr/bin/env bash
# Build 0199 APKs from the git working tree in this Cloud Agent / local env,
# then produce git-archive source zips.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MOBILE="$ROOT/online-cs/deploy/mobile"
DIST="$MOBILE/dist"
ANDROID_HOME="${ANDROID_HOME:-/tmp/android-sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "error: ANDROID_HOME=$ANDROID_HOME has no platforms. Install Android SDK first." >&2
  exit 1
fi

mkdir -p "$DIST"

build_one() {
  local name="$1"
  local dir="$MOBILE/android/$name"
  echo "==> assembleRelease $name"
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$dir/local.properties"
  (
    cd "$dir"
    chmod +x ./gradlew
    ./gradlew --no-daemon assembleRelease
  )
  local apk="$dir/app/build/outputs/apk/release/app-release.apk"
  if [[ ! -f "$apk" ]]; then
    echo "error: missing $apk" >&2
    exit 1
  fi
  cp -f "$apk" "$DIST/${name}-release.apk"
  if [[ -f "$dir/${name}.keystore" ]]; then
    cp -f "$dir/${name}.keystore" "$DIST/${name}.keystore"
  fi
  echo "ok $DIST/${name}-release.apk ($(wc -c < "$apk") bytes)"
}

build_one app0199
build_one seat0199

WEB_DL="$ROOT/online-cs/web/download"
mkdir -p "$WEB_DL"
cp -f "$DIST/app0199-release.apk" "$DIST/seat0199-release.apk" "$WEB_DL/"
cp -f "$DIST/"*.keystore "$WEB_DL/" 2>/dev/null || true

# Source zips require committed tree; only run when mobile is in HEAD
if git cat-file -e "HEAD:online-cs/deploy/mobile/README.md" 2>/dev/null; then
  bash "$MOBILE/scripts/git-pack.sh"
else
  echo "skip git-pack: mobile not in HEAD yet (commit first)"
fi

echo
echo "env-pack done"
ls -la "$DIST"/*.apk "$DIST"/*.zip 2>/dev/null || ls -la "$DIST"
