#!/bin/bash
# Healthy-session control arm (approved 2026-10-07): one stack per session, 40 sessions.
#   usage: caffeinate -i -s bash control.sh <livekit|janus>      (with C4_GUARD_JOB=control.sh battery-guard.sh alongside)
# Client build: the pre-sampler copies of common.js and driver.js, as in the 215 study trials.
# Records land in control/ as each session finishes; resumable. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
STACK="$1"; case "$STACK" in livekit|janus) ;; *) echo "usage: control.sh <livekit|janus>"; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
pmset -g batt | grep -q "AC Power" || { echo "=== NOT ON AC POWER: session not started"; exit 4; }
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
kubectl get nodes -o wide
for ns in c4-livekit c4-janus; do kubectl -n $ns rollout status deploy/event-sink --timeout=180s; done
export C4_CONTROL=1 C4_CLIENT_BUILD=pre-sampler C4_TRIALS=control
node run.mjs switch "$STACK"
node run.mjs setup
set +e
# one shakedown session per arm first, kept apart from the 40
if [ "${C4_SKIP_SHAKEDOWN:-0}" != "1" ]; then
  C4_TRIALS=control-shakedown C4_CELLS=h0:1,h1:1,h2:1,h3:1 node run.mjs control "$STACK"; echo "SHAKEDOWN_EXIT=$?"
  # gate: every shakedown session valid, RTP kept flowing during the h3 mute, and (LiveKit) h2 renegotiated; otherwise stop before the 40
  node control-gate.mjs "$STACK"; G=$?; [ $G -eq 0 ] || { echo "=== SHAKEDOWN GATE FAILED ($G): not running the 40"; exit $G; }
  [ "${C4_SHAKEDOWN_ONLY:-0}" = "1" ] && exit 0
fi
node run.mjs control "$STACK"; echo "CONTROL_EXIT=$?"
echo "=== CONTROL_DONE $STACK $(date -u +%FT%TZ)"
