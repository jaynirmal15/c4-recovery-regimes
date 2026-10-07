#!/bin/bash
# Remaining targeted tests, then ALWAYS park (trap), under caffeinate by the caller.
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
node run.mjs targeted livekit healthy_rebuild 1 I
node run.mjs targeted livekit remove_participant 3 I
node run.mjs targeted livekit intruder 3 I
node run.mjs targeted livekit rogue 1 I
node run.mjs switch janus
node run.mjs targeted janus healthy_rebuild 3 I
node run.mjs targeted janus kick 3 I
node run.mjs targeted janus rogue 1 I
node run.mjs placement-selftest janus
echo "=== TESTS_DONE $(date -u +%FT%TZ)"
