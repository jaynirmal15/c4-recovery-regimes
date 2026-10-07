#!/bin/bash
# 2026-10-01 arm check (NOT study trials): are arms I and O still identical on the current
# client (ladder v2, claim-path re-subscribe, P9)? Always parks (trap).
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
node run.mjs switch livekit
node run.mjs setup
set +e
export C4_TRIALS=arms
for rep in 1 2; do for mode in all media; do for d in 10 30; do for arm in I O; do node run.mjs iso livekit $mode $d $arm; done; done; done; done
node run.mjs switch janus
for mode in all media; do for d in 10 30; do for arm in I O; do node run.mjs iso janus $mode $d $arm; done; done; done
echo "=== ARMS_DONE $(date -u +%FT%TZ)"
