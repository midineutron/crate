#!/usr/bin/env bash
# sim-offline-test.sh — exercise the "save project offline" PWA feature in the
# iOS Simulator against the REAL Navidrome catalog, the way production behaves.
#
# Unlike sim-test.sh (Vite DEV server), this serves the PRODUCTION BUILD via
# `vite preview`, so the real service worker (public/sw.js) and hashed /assets
# are in play — the only faithful way to test offline shell + media caching.
#
# Stages (the script sets up online; you drive the offline toggle):
#   1. port-forward crate-web -> localhost:$BACKEND_PORT
#   2. vite build + vite preview (proxying /rest + /audio to the backend)
#   3. boot the sim, open /?debug&autosave#enter  ->  auto-saves the first
#      project offline. Watch the HUD OFFLINE line go: saving n/N -> "1 saved".
#   4. To test OFFLINE MEDIA: kill the backend port-forward (leave preview up),
#      then reopen /?debug&autoplay#enter. The saved project must still play
#      (HUD: AUDIOEL playing, FRAMES ✓sidecar, SW controlling) with the backend
#      down — served from the Cache API by the SW.
#   5. To test OFFLINE SHELL: also stop preview (Ctrl-C is fine after saving),
#      reopen the URL; the room must still load (SW serves the cached shell).
#
# Requirements: kubectl (crate context), Xcode + simulators, node.
# Usage: tools/sim-offline-test.sh [iphone-name]   (default: "iPhone 15")
set -euo pipefail

DEVICE="${1:-iPhone 15}"
BACKEND_PORT="${BACKEND_PORT:-8091}"
PREVIEW_PORT="${PREVIEW_PORT:-4173}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM_DIR="$REPO_ROOT/room"
BASE="http://localhost:$PREVIEW_PORT"

pids=()
cleanup() {
  echo "==> cleanup"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

echo "==> port-forward crate-web -> localhost:$BACKEND_PORT"
kubectl -n crate port-forward deploy/crate-web "$BACKEND_PORT:8080" >/tmp/crate-pf.log 2>&1 &
pids+=($!)
for i in $(seq 1 30); do
  curl -sf "http://localhost:$BACKEND_PORT/rest/ping.view?u=crate&v=1.16.1&c=crate-room&f=json" >/dev/null 2>&1 && break
  sleep 0.5
  [ "$i" = 30 ] && { echo "!! port-forward never came up (see /tmp/crate-pf.log)"; exit 1; }
done
echo "   backend up"

echo "==> vite build"
( cd "$ROOM_DIR" && npm run build >/tmp/crate-build.log 2>&1 ) || { echo "!! build failed (see /tmp/crate-build.log)"; exit 1; }

echo "==> vite preview (production build, CRATE_BACKEND=http://localhost:$BACKEND_PORT)"
( cd "$ROOM_DIR" && CRATE_BACKEND="http://localhost:$BACKEND_PORT" npx vite preview --port "$PREVIEW_PORT" --host >/tmp/crate-preview.log 2>&1 ) &
pids+=($!)
for i in $(seq 1 40); do
  curl -sf "$BASE/" >/dev/null 2>&1 && break
  sleep 0.5
  [ "$i" = 40 ] && { echo "!! preview never came up (see /tmp/crate-preview.log)"; exit 1; }
done
echo "   preview up at $BASE"

echo "==> boot simulator: $DEVICE"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DEVICE" -b 2>/dev/null || true

echo "==> open room (auto-save first project)"
xcrun simctl openurl "$DEVICE" "$BASE/?debug&autosave#enter"

cat <<EOF

==> READY. Production build open in the simulator with the debug HUD.

  Stage 3 (online save) — watch the HUD:
    OFFLINE:  saving n/N   ->   1 saved
    SW:       controlling
    Screenshot:  xcrun simctl io "$DEVICE" screenshot /tmp/sim-saved.png

  Stage 4 (offline media) — take the backend down, keep the shell up:
    kill the port-forward:  pkill -f "port-forward deploy/crate-web"
    reopen playing the saved project:
      xcrun simctl openurl "$DEVICE" "$BASE/?debug&autoplay#enter"
    PASS if, with the backend DOWN, the saved track plays:
      AUDIOEL playing · FRAMES ✓sidecar · SW controlling
    Screenshot:  xcrun simctl io "$DEVICE" screenshot /tmp/sim-offline.png

  Stage 5 (offline shell) — also stop this script (Ctrl-C), then reopen the URL.
    PASS if the room still loads with no server at all (SW-cached shell).

  Logs:  /tmp/crate-pf.log  /tmp/crate-build.log  /tmp/crate-preview.log
  Ctrl-C here to tear down preview + port-forward.
EOF

wait
