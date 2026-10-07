#!/bin/bash
# 2026-10-05 backlog cell (follow-up measurement, NOT part of the 215): Janus media-only 16 s and 20 s,
# n=5 each, with WebRTC receiver/sender statistics sampled at 250 ms. Records land in backlog-cell/.
# Always parks (trap).
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
node run.mjs switch janus
node run.mjs setup
set +e
export C4_TRIALS=backlog-cell
export C4_CELLS=media:16:5,media:20:5
node run.mjs study janus; echo "STUDY_EXIT=$?"
echo "=== BACKLOG_DONE $(date -u +%FT%TZ)"
