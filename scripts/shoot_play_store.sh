#!/usr/bin/env bash
# Capture the Google Play listing screenshots (1080x1920 PNG) into
# store/play/screenshots/. Reuses the splash-gallery runner's stack + seed;
# only the capture script differs. See ANDROID.md.
set -euo pipefail
cd "$(dirname "$0")/.."
SHOTS_SCRIPT="tests/demos/play-store-shots.mts" exec ./scripts/shoot_demos.sh
