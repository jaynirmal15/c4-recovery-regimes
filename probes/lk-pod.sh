#!/bin/bash
# lk-pod.sh <podname> <lk args...> : start a long-running lk CLI pod (pinned v2.18.8) in c4-livekit, shareProcessNamespace for later SIGKILL
name=$1; shift
args=$(printf '"%s",' "$@"); args="[${args%,}]"
IMG=livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413
kubectl -n c4-livekit run "$name" --restart=Never --image=$IMG --labels=c4.probe=livekit \
  --overrides="{\"spec\":{\"shareProcessNamespace\":true,\"terminationGracePeriodSeconds\":10,\"containers\":[{\"name\":\"lk\",\"image\":\"$IMG\",\"args\":$args,\"envFrom\":[{\"secretRef\":{\"name\":\"lk-cli-env\"}}]}]}}"
