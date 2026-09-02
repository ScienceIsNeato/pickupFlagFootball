#!/usr/bin/env bash
# Build the Google Play artifact (Trusted Web Activity wrapper around the PWA).
#
# The TWA is a shell that opens pickupflagfootball.com in the user's Chrome with
# the URL bar removed — so this is only rebuilt to change app-shell config
# (name, icons, version), never to ship site changes. See ANDROID.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PW_FILE="$HOME/.pff-android-keys/upload-keystore-password.txt"

# Bubblewrap wants the .jdk bundle, NOT its Contents/Home — it appends that
# itself, and the usual JAVA_HOME gives you .../Contents/Home/Contents/Home.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

fail() { echo "error: $*" >&2; exit 1; }

command -v bubblewrap >/dev/null || fail "bubblewrap not installed (npm i -g @bubblewrap/cli)"
[[ -d "$ANDROID_HOME" ]] || fail "no Android SDK at $ANDROID_HOME (see ANDROID.md)"
# Bubblewrap shells out to <sdk>/tools/bin/sdkmanager; without this symlink it
# tries to install build tools through a path that doesn't exist and dies with a
# ClassNotFoundException that says nothing about the real cause.
[[ -e "$ANDROID_HOME/tools/bin/sdkmanager" ]] \
  || fail "missing $ANDROID_HOME/tools — run: ln -sfn $ANDROID_HOME/cmdline-tools/latest $ANDROID_HOME/tools"
[[ -f "$KEY_PW_FILE" ]] || fail "no upload-key password at $KEY_PW_FILE (see ANDROID.md)"
[[ -f "$ROOT/android/android.keystore" ]] || fail "no upload keystore at android/android.keystore (see ANDROID.md)"

PW="$(cat "$KEY_PW_FILE")"
cd "$ROOT/android"

# Regenerate the Gradle project from twa-manifest.json (the only source file
# here) so a hand-edit to the generated project can never silently ship.
BUBBLEWRAP_KEYSTORE_PASSWORD="$PW" BUBBLEWRAP_KEY_PASSWORD="$PW" \
  bubblewrap update --skipVersionUpgrade

# --skipPwaValidation: Lighthouse-over-the-network on every build is slow and
# flaky, and the manifest is already covered by the app's own test suite.
BUBBLEWRAP_KEYSTORE_PASSWORD="$PW" BUBBLEWRAP_KEY_PASSWORD="$PW" \
  bubblewrap build --skipPwaValidation

echo
echo "Built:"
ls -la "$ROOT"/android/*.aab "$ROOT"/android/*.apk 2>/dev/null || true
echo
echo "Upload the .aab to Play Console. The .apk is for sideloading only."
