#!/usr/bin/env bash
# sim-test.sh — run the crate room in the iOS Simulator against the REAL
# Navidrome catalog, for hands-on testing of background / lock-screen / auto-
# advance playback without deploying first.
#
# What it does:
#   1. port-forwards the in-cluster crate-web (Subsonic proxy + /audio + .fft) to
#      localhost:$BACKEND_PORT   (bypasses the Traefik auth gate)
#   2. starts the LOCAL patched Vite dev server, proxying /rest + /audio there
#   3. boots an iPhone simulator and opens Mobile Safari to the room with the
#      on-screen #debug HUD enabled
#
# The HUD's FRAMES line is the thing to watch: `sidecar` (green) = the fast
# precomputed path; `decode` (red) = the heavy fallback that stalls iOS
# background playback. In catalog mode it must read `sidecar`.
#
# Requirements: kubectl (context on the crate cluster), Xcode + simulators, node.
# Usage: tools/sim-test.sh [iphone-name]   (default: "iPhone 15")
set -euo pipefail

DEVICE="${1:-iPhone 15}"
BACKEND_PORT="${BACKEND_PORT:-8091}"
DEV_PORT=5173
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOM_DIR="$REPO_ROOT/room"
URL="http://localhost:$DEV_PORT/?debug#enter"

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

echo "==> vite dev (CRATE_BACKEND=http://localhost:$BACKEND_PORT)"
( cd "$ROOM_DIR" && CRATE_BACKEND="http://localhost:$BACKEND_PORT" npm run dev >/tmp/crate-vite.log 2>&1 ) &
pids+=($!)
for i in $(seq 1 40); do
  curl -sf "http://localhost:$DEV_PORT/" >/dev/null 2>&1 && break
  sleep 0.5
  [ "$i" = 40 ] && { echo "!! vite never came up (see /tmp/crate-vite.log)"; exit 1; }
done
echo "   dev server up at http://localhost:$DEV_PORT"

echo "==> boot simulator: $DEVICE"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DEVICE" -b 2>/dev/null || true

echo "==> open room in Mobile Safari"
xcrun simctl openurl "$DEVICE" "$URL"

cat <<EOF

==> READY. Room open in the simulator with the debug HUD.

  Test checklist (watch the on-screen HUD):
    - Enter, click a computer, play a track.
        FRAMES must read 'sidecar' (green). If it reads 'decode' (red),
        the sidecar wiring is broken again.
    - Let a track END -> HUD EVENTS should show 'advance (ended)' and the
        next track should start. Repeat across 2-3 tracks.
    - Simulator menu: Device > Lock (or Cmd+L). Audio should keep playing;
        let the track end while locked and confirm it advances.
    - Toggle LOSSY in Settings and repeat (transcoded stream: advance comes
        from 'overrun', progress bar uses the known duration).

  NOTE: the Simulator does NOT perfectly reproduce iOS background-audio
  suspension; it catches wiring/logic regressions (sidecar vs decode, advance
  events, play() retries). Final lock-screen confirmation still needs a device,
  but the HUD makes the failure legible there too (open /#debug on the phone).

  Logs:  /tmp/crate-pf.log  /tmp/crate-vite.log
  Ctrl-C here to tear everything down.
EOF

wait
