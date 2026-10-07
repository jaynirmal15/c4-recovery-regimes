#!/bin/bash
# Replacement job (lab already up): fresh client pods, isolation smoke on both stacks, GATE,
# then the 48-trial shakedown. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
node run.mjs switch janus
node run.mjs setup
set +e
C4_TRIALS=shakedown-smoke node run.mjs smoke janus
node run.mjs switch livekit
C4_TRIALS=shakedown-smoke node run.mjs smoke livekit
echo "=== SMOKE_DONE $(date -u +%FT%TZ)"
node report.mjs "$ROOT/trials-run5" "$ROOT/logs/aborts.log" --gate > "$ROOT/logs/stageb/run5-report.txt" 2>&1; g1=$?
node report.mjs "$ROOT/shakedown-smoke" "$ROOT/logs/aborts.log" --gate > "$ROOT/logs/stageb/smoke-report.txt" 2>&1; g2=$?
echo "=== GATE targeted=$g1 smoke=$g2 $(date -u +%FT%TZ)"
if [ "$g1" != 0 ] || [ "$g2" != 0 ]; then echo "=== GATE FAILED: shakedown NOT started"; exit 1; fi
export C4_TRIALS=shakedown
node run.mjs shakedown livekit 3
node run.mjs switch janus
node run.mjs shakedown janus 3
echo "=== SHAKEDOWN_DONE $(date -u +%FT%TZ)"
