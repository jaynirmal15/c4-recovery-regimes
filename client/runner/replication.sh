#!/bin/bash
# R4 (REGISTRATION-R4-corrected-decoder.md): the corrected-decoder client build in LiveKit full isolation 17 s and Janus
# full isolation 5 s. One session: per stack, one shakedown trial kept apart and a gate, then ten trials.
#   usage: caffeinate -i -s bash replication.sh      (with C4_GUARD_JOB=replication.sh battery-guard.sh alongside)
#   C4_SHAKEDOWN_ONLY=1 stops each stack after its gate. Records land in replication/ and replication-shakedown/. Always parks.
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
export C4_CONTROL=1 C4_CLIENT_BUILD=corrected-decoder
WANT=$(shasum -a 256 "$ROOT/client/builds/common.js.corrected-decoder" | cut -d' ' -f1)
set +e
for STACK in livekit janus; do
  node run.mjs switch $STACK && node run.mjs setup || { echo "=== SETUP FAILED for $STACK"; exit 7; }
  C4_TRIALS=replication-shakedown C4_PER_CELL=1 node run.mjs replication $STACK; echo "SHAKEDOWN_EXIT_$STACK=$?"
  # gate: a valid shakedown trial on this stack, run with the corrected build (the served common.js has the committed
  # file's hash), with a detection recorded and every participant's dump readable for decoder_reject lines
  node -e '
    const fs=require("fs"),p=require("path"),d=p.join(process.argv[1],"replication-shakedown"),stack=process.argv[2],want=process.argv[3];
    const rs=fs.readdirSync(d).filter(x=>fs.existsSync(p.join(d,x,"result.json"))).map(x=>JSON.parse(fs.readFileSync(p.join(d,x,"result.json")))).filter(r=>r.stack===stack&&r.control&&r.control.arm==="R4").sort((x,y)=>x.tStart<y.tStart?-1:1);
    const r=rs[rs.length-1];const S=r&&JSON.parse(fs.readFileSync(p.join(d,r.id,"S.json")));const det=S&&S.driver.history.find(h=>h.state==="detected"&&h.t>r.iso.onset.after);
    const row={stack,id:r&&r.id,valid:!!(r&&r.valid),invalid:r&&r.invalid,build:r&&r.control.build&&r.control.build.name,commonJs:r&&r.control.build&&r.control.build.sha256["common.js"],hashOk:!!(r&&r.control.build&&r.control.build.sha256["common.js"]===want),detection:det?(det.t-r.iso.onset.after)/1000:null,rejects:r&&r.control.decoderRejects};
    row.ok=row.valid&&row.build==="corrected-decoder"&&row.hashOk&&row.detection!=null&&row.rejects&&row.rejects.S!=null;console.log("SHAKEDOWN",JSON.stringify(row));process.exit(row.ok?0:6)' "$ROOT" $STACK $WANT; G=$?
  [ $G -eq 0 ] || { echo "=== SHAKEDOWN GATE FAILED for $STACK ($G): stopping"; exit $G; }
  [ "${C4_SHAKEDOWN_ONLY:-0}" = "1" ] && continue
  C4_TRIALS=replication node run.mjs replication $STACK; echo "REPLICATION_EXIT_$STACK=$?"
done
echo "=== REPLICATION_DONE $(date -u +%FT%TZ)"
