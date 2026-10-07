#!/bin/bash
# Block-first confirmation (tests 1 and 2), isolation smoke, GATE, then the 48-trial shakedown.
# Always parks (trap). Each stack is switched to explicitly.
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
export C4_TRIALS=trials-run5
node run.mjs targeted janus healthy_rebuild 3 I
node run.mjs targeted janus kick 3 I
node run.mjs switch livekit
node run.mjs targeted livekit healthy_rebuild 3 I
node run.mjs targeted livekit remove_participant 3 I
node run.mjs targeted livekit intruder 3 I
echo "=== TARGETED_DONE $(date -u +%FT%TZ)"
# isolation smoke on LiveKit (stack already active), then Janus
C4_TRIALS=shakedown-smoke node run.mjs smoke livekit
node run.mjs switch janus
C4_TRIALS=shakedown-smoke node run.mjs smoke janus
echo "=== SMOKE_DONE $(date -u +%FT%TZ)"
node report.mjs "$ROOT/trials-run5" "$ROOT/logs/aborts.log" --gate > "$ROOT/logs/stageb/run5-report.txt" 2>&1; g1=$?
node report.mjs "$ROOT/shakedown-smoke" "$ROOT/logs/aborts.log" --gate > "$ROOT/logs/stageb/smoke-report.txt" 2>&1; g2=$?
echo "=== GATE targeted=$g1 smoke=$g2 $(date -u +%FT%TZ)"
if [ "$g1" != 0 ] || [ "$g2" != 0 ]; then echo "=== GATE FAILED: shakedown NOT started"; exit 1; fi
export C4_TRIALS=shakedown
node run.mjs shakedown janus 3
node run.mjs switch livekit
node run.mjs shakedown livekit 3
echo "=== SHAKEDOWN_DONE $(date -u +%FT%TZ)"
