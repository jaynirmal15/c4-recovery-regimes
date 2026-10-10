#!/bin/bash
# R3 (REGISTRATION-R3-attempt-timeout.md): LiveKit, full isolation, the SDK's signal-connection timeout at 10, 15 and 25 s.
# One session: four shakedown trials kept apart, a gate on the measured attempt lifetime, then 100 trials.
#   usage: caffeinate -i -s bash timeout.sh      (with C4_GUARD_JOB=timeout.sh battery-guard.sh alongside)
#   C4_SHAKEDOWN_ONLY=1 stops after the gate. Records land in timeout/ and timeout-shakedown/. Always parks (trap).
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
export C4_CONTROL=1 C4_CLIENT_BUILD=pre-sampler C4_TRIALS=timeout
node run.mjs switch livekit
node run.mjs setup
set +e
# shakedown: one trial per arm at a duration whose first attempt goes unanswered, so the attempt's lifetime is observed,
# and one at W15-18, whose first attempt is answered, so one record carries an accepted response (addendum 1)
C4_TRIALS=timeout-shakedown C4_CELLS=W10-17:1,W15-19:1,W25-28:1,W15-18:1 node run.mjs timeout livekit; echo "SHAKEDOWN_EXIT=$?"
# gate (the manipulation check): a valid trial per cell; in the three unanswered cells the first unanswered attempt lived
# the set time, within 50 ms; in W15-18 no attempt went unanswered
node -e '
  const fs=require("fs"),p=require("path"),d=p.join(process.argv[1],"timeout-shakedown");
  const rs=fs.readdirSync(d).filter(x=>fs.existsSync(p.join(d,x,"result.json"))).map(x=>JSON.parse(fs.readFileSync(p.join(d,x,"result.json"))));
  const last={};for(const r of rs.sort((x,y)=>x.tStart<y.tStart?-1:1))last[r.control.arm+"-"+r.iso.plannedS]=r;
  const rows=["W10-17","W15-19","W25-28","W15-18"].map(c=>{const r=last[c];const life=r&&r.control.unansweredAttemptLifetimesMs[0];const answered=c==="W15-18";return {cell:c,arm:r&&r.control.arm,id:r&&r.id,valid:!!(r&&r.valid),invalid:r&&r.invalid,setMs:r&&r.control.wsTimeoutMsInSubjectRecord,firstUnansweredLifetimeMs:life??null,ok:!!(r&&r.valid&&(answered?life==null:(life!=null&&Math.abs(life-r.control.wsTimeoutMs)<=50)))}});
  console.log("SHAKEDOWN",JSON.stringify(rows));process.exit(rows.every(x=>x.ok)?0:6)' "$ROOT"; G=$?; [ $G -eq 0 ] || { echo "=== MANIPULATION CHECK FAILED ($G): not running the 100"; exit $G; }
[ "${C4_SHAKEDOWN_ONLY:-0}" = "1" ] && exit 0
node run.mjs timeout livekit; echo "TIMEOUT_EXIT=$?"
echo "=== TIMEOUT_DONE $(date -u +%FT%TZ)"
