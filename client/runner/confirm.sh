#!/bin/bash
# 2026-10-01 confirmation job (NOT study trials): new sink + completeness check, deliberate
# starved-sink failure, clock probe, ladder v2. Always parks (trap).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
export PATH="${C4_NODE_BIN:-/usr/local/opt/node@24/bin}:$PATH"
cd "$(dirname "$0")"
park() { echo "=== PARK $(date -u +%FT%TZ)"; ( cd "$LAB" && make park; echo "MAKE_PARK_EXIT=$?" ); echo "=== JOB_DONE $(date -u +%FT%TZ)"; }
trap park EXIT
set -e
( cd "$LAB" && make unpark ); echo "=== UNPARKED $(date -u +%FT%TZ)"
for ns in c4-livekit c4-janus; do
  kubectl -n $ns create configmap c4-sink --from-file=$ROOT/deploy/sink/sink.mjs --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n $ns delete deploy event-sink --ignore-not-found
  kubectl apply -f $ROOT/deploy/sink/sink-$ns.yaml
  kubectl -n $ns rollout status deploy/event-sink --timeout=180s
  kubectl -n $ns get svc event-sink -o jsonpath='{.spec.selector}{" "}{.spec.ports[0].port}->{.spec.ports[0].targetPort}{"\n"}'
done
node run.mjs switch janus
node run.mjs setup
set +e
export C4_TRIALS=confirm
node run.mjs iso janus all 10 I
node run.mjs iso janus all 30 I
node run.mjs iso janus all 30 O
node run.mjs iso janus all 30 I
C4_TRIALS=confirm-starve C4_STARVE_SINK=1 node run.mjs iso janus all 10 I
kubectl -n c4-janus rollout status deploy/event-sink --timeout=120s
node run.mjs iso janus media 30 I
node run.mjs switch livekit
node run.mjs iso livekit all 10 I
node run.mjs iso livekit all 30 I
C4_TRIALS=confirm-starve C4_STARVE_SINK=1 node run.mjs iso livekit all 10 I
kubectl -n c4-livekit rollout status deploy/event-sink --timeout=120s
node run.mjs iso livekit media 10 O
echo "=== CONFIRM_DONE $(date -u +%FT%TZ)"
