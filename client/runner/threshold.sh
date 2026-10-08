#!/bin/bash
# R2 (REGISTRATION-R2-detection-threshold.md, registered 2026-10-08): LiveKit, 2 s outages, detection threshold
# 4 s against a concurrent 2 s arm. One session, 30 trials, after four shakedown trials kept apart.
#   usage: caffeinate -i -s bash threshold.sh      (with C4_GUARD_JOB=threshold.sh battery-guard.sh alongside)
# Client build: the pre-sampler copies of common.js and driver.js. Records land in threshold/. Always parks (trap).
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
export C4_CONTROL=1 C4_CLIENT_BUILD=pre-sampler C4_TRIALS=threshold
node run.mjs switch livekit
node run.mjs setup
set +e
# shakedown: one trial per arm and condition, kept apart from the 30 and not analysed with them
C4_TRIALS=threshold-shakedown C4_CELLS=T4:1,T2:1 node run.mjs threshold livekit; echo "SHAKEDOWN_EXIT=$?"
# gate: four valid shakedown trials, each with the intended threshold in the subject's record and the kernel settings read
node -e '
  const fs=require("fs"),p=require("path"),d=p.join(process.argv[1],"threshold-shakedown");
  const rs=fs.readdirSync(d).filter(x=>fs.existsSync(p.join(d,x,"result.json"))).map(x=>JSON.parse(fs.readFileSync(p.join(d,x,"result.json"))));
  const last={};for(const r of rs.sort((x,y)=>x.tStart<y.tStart?-1:1))last[r.iso.mode+"-"+r.control.arm]=r;
  const want=["all-T4","all-T2","media-T4","media-T2"];const bad=want.filter(k=>!last[k]||!last[k].valid||last[k].control.mediaAgeMsInSubjectRecord!==last[k].control.mediaAgeMs);
  const k=Object.values(last).map(r=>r.control.clientKernel);const kernelOk=k.length&&k.every(c=>c&&["S","O1","O2"].every(w=>c[w]&&c[w].release&&Number.isFinite(c[w].tcp_syn_linear_timeouts)));
  console.log("SHAKEDOWN",JSON.stringify({groups:Object.fromEntries(Object.entries(last).map(([g,r])=>[g,{id:r.id,valid:r.valid,invalid:r.invalid,threshold:r.control.mediaAgeMsInSubjectRecord}])),invalidOrMissing:bad,clientKernel:k[0]||null,kernelOk}));
  process.exit(bad.length||!kernelOk?6:0)' "$ROOT"; G=$?; [ $G -eq 0 ] || { echo "=== SHAKEDOWN GATE FAILED ($G): not running the 30"; exit $G; }
[ "${C4_SHAKEDOWN_ONLY:-0}" = "1" ] && exit 0
node run.mjs threshold livekit; echo "THRESHOLD_EXIT=$?"
echo "=== THRESHOLD_DONE $(date -u +%FT%TZ)"
