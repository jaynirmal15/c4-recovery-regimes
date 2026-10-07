#!/bin/bash
# 2026-10-02 pre-study validation (NOT study trials): participant-state polling, 120 s give-up,
# long and short durations. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
for ns in c4-livekit c4-janus; do kubectl -n $ns rollout status deploy/event-sink --timeout=180s; done
node run.mjs switch janus
node run.mjs setup
set +e
export C4_TRIALS=validate
node run.mjs iso janus all 2 O
node run.mjs iso janus all 65 O
node run.mjs iso janus all 90 O
node run.mjs iso janus media 30 O
node run.mjs switch livekit
node run.mjs iso livekit all 5 O
node run.mjs iso livekit all 30 O
node run.mjs iso livekit media 28 O
echo "=== VALIDATE_DONE $(date -u +%FT%TZ)"
