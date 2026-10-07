#!/bin/bash
# 2026-10-01 second confirmation job (NOT study trials): Janus claim-path subscriber fix.
# Janus full 30 s x3 must recover with inbound media; two regression trials. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; [ -n "$SS" ] && kill $SS 2>/dev/null; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
for ns in c4-livekit c4-janus; do kubectl -n $ns rollout status deploy/event-sink --timeout=180s; done
node run.mjs switch janus
node run.mjs setup
set +e
# server-side TCP state of the signalling sockets, once a second (retransmission backoff evidence)
kubectl -n c4-janus exec deploy/janus -- sh -c 'while true; do echo "T $(date -u +%s.%N)"; ss -tino "( sport = :31188 )" 2>&1; sleep 1; done' > $ROOT/logs/confirm2/janus-ss.log 2>&1 &
SS=$!
export C4_TRIALS=confirm2
node run.mjs iso janus all 30 I
node run.mjs iso janus all 30 O
node run.mjs iso janus all 30 I
node run.mjs iso janus all 10 I
node run.mjs iso janus media 30 I
echo "=== CONFIRM2_DONE $(date -u +%FT%TZ)"
