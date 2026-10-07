#!/bin/bash
# STUDY session (approved 2026-10-02, STAGE-A-SPEC §4.4): one stack per session. usage: study.sh <livekit|janus>
# Records land in study/ as each trial finishes; resumable. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
STACK=$1
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
pmset -g batt | grep -q "AC Power" || { echo "=== NOT ON AC POWER: session not started"; exit 4; }
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
for ns in c4-livekit c4-janus; do kubectl -n $ns rollout status deploy/event-sink --timeout=180s; done
node run.mjs switch $STACK
node run.mjs setup
set +e
export C4_TRIALS=study
node run.mjs study $STACK; echo "STUDY_EXIT=$?"
echo "=== STUDY_DONE $STACK $(date -u +%FT%TZ)"
