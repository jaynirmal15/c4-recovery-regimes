#!/bin/bash
# STUDY run 2 (STAGE-A-SPEC §4.5): LiveKit boundary cells + media-only re-run with the fixed driver.
# Records land in study-r2/ as each trial finishes; resumable. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
pmset -g batt | grep -q "AC Power" || { echo "=== NOT ON AC POWER: session not started"; exit 4; }
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
for ns in c4-livekit c4-janus; do kubectl -n $ns rollout status deploy/event-sink --timeout=180s; done
node run.mjs switch livekit
node run.mjs setup
set +e
export C4_TRIALS=study-r2
export C4_CELLS=all:17:10,all:18:10,media:21:10,media:22:10,media:23:5,media:26:10,media:28:10,media:30:5
node run.mjs study livekit; echo "STUDY_EXIT=$?"
echo "=== STUDY_DONE livekit-r2 $(date -u +%FT%TZ)"
