#!/bin/bash
# usage: lk-oneshot.sh <podname> <lk args...>   runs the official lk CLI (v2.18.8, pinned) once in c4-livekit
name=$1; shift
args=$(printf '"%s",' "$@"); args="[${args%,}]"
kubectl -n c4-livekit run "$name" --restart=Never --image=livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413 \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"$name\",\"image\":\"livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413\",\"args\":$args,\"envFrom\":[{\"secretRef\":{\"name\":\"lk-cli-env\"}}]}]}}" >/dev/null
kubectl -n c4-livekit wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$name" --timeout=90s >/dev/null 2>&1 || kubectl -n c4-livekit wait --for=jsonpath='{.status.phase}'=Failed pod/"$name" --timeout=5s >/dev/null 2>&1
kubectl -n c4-livekit logs "$name"; phase=$(kubectl -n c4-livekit get pod "$name" -o jsonpath='{.status.phase} exit={.status.containerStatuses[0].state.terminated.exitCode}')
echo "[$name] $phase"; kubectl -n c4-livekit delete pod "$name" --wait=false >/dev/null
