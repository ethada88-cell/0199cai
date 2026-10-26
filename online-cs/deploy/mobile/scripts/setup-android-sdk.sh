#!/usr/bin/env bash
# Idempotent Android SDK bootstrap for Cloud Agent / git environment packaging.
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-/tmp/android-sdk}"
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"

mkdir -p "$SDK_ROOT/cmdline-tools"

if [[ ! -x "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/cmdtools.zip" \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q "$tmp/cmdtools.zip" -d "$tmp"
  rm -rf "$SDK_ROOT/cmdline-tools/latest"
  mkdir -p "$SDK_ROOT/cmdline-tools/latest"
  # zip root is cmdline-tools/
  mv "$tmp/cmdline-tools/"* "$SDK_ROOT/cmdline-tools/latest/"
  rm -rf "$tmp"
fi

yes | "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_ROOT" --licenses >/dev/null || true
"$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_ROOT" \
  "platforms;android-34" "build-tools;34.0.0" "platform-tools"

echo "ANDROID_HOME=$SDK_ROOT"
ls "$SDK_ROOT/platforms" "$SDK_ROOT/build-tools"
