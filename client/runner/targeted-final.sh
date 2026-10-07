#!/bin/bash
# Full targeted-test run on ONE code version. Always parks (trap). Each stack is switched to EXPLICITLY.
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark )
echo "=== UNPARKED $(date -u +%FT%TZ)"
node run.mjs switch janus
node run.mjs setup
set +e
node run.mjs targeted janus healthy_rebuild 3 I
node run.mjs targeted janus kick 3 I
node run.mjs targeted janus rogue 1 I
node run.mjs placement-selftest janus
node run.mjs switch livekit
node run.mjs targeted livekit healthy_rebuild 3 I
node run.mjs targeted livekit remove_participant 3 I
node run.mjs targeted livekit intruder 3 I
node run.mjs targeted livekit rogue 1 I
node run.mjs placement-selftest livekit
echo "=== TESTS_DONE $(date -u +%FT%TZ)"
