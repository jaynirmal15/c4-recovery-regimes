#!/usr/bin/env bash
# Run the driven-SDK spike on the lab. Observer joins first, then the subject runs its timeline.
# Results land in spike/out/<role>.json and spike/out/<role>.log.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NS=c4-clients
IMG="mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e" # v1.62.1-noble
mkdir -p "$HERE/out"

kubectl create namespace $NS --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl label namespace $NS c4.role=clients --overwrite >/dev/null
# Credentials copied from the LiveKit namespace's CLI secret; never printed.
KEY=$(kubectl -n c4-livekit get secret lk-cli-env -o jsonpath='{.data.LIVEKIT_API_KEY}' | base64 -d)
SEC=$(kubectl -n c4-livekit get secret lk-cli-env -o jsonpath='{.data.LIVEKIT_API_SECRET}' | base64 -d)
kubectl -n $NS create secret generic spike-lk --from-literal=LIVEKIT_API_KEY="$KEY" --from-literal=LIVEKIT_API_SECRET="$SEC" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n $NS create configmap spike-files --from-file="$HERE/www/driver.js" --from-file="$HERE/runner.mjs" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

SFU_IP=$(kubectl -n c4-livekit get pod -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].status.podIP}')
[ -n "$SFU_IP" ] || { echo "no LiveKit pod IP" >&2; exit 1; }
echo "LiveKit pod IP: $SFU_IP"

pod() { # role, add-NET_ADMIN(yes|no)
  local role=$1 cap=$2 caps='[]'; [ "$cap" = yes ] && caps='["NET_ADMIN"]'
  kubectl -n $NS delete pod "spike-$role" --ignore-not-found --wait=true >/dev/null
  cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: spike-$role, namespace: $NS, labels: { app: spike, role: $role } }
spec:
  restartPolicy: Never
  terminationGracePeriodSeconds: 5
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - topologyKey: kubernetes.io/hostname
          namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: c4-livekit } }
          labelSelector: { matchLabels: { app.kubernetes.io/name: livekit-server } }
        - topologyKey: kubernetes.io/hostname
          namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: c4-janus } }
          labelSelector: { matchLabels: { app: janus } }
  containers:
    - name: runner
      image: $IMG
      securityContext: { capabilities: { add: $caps } }
      env:
        - { name: ROLE, value: "$role" }
        - { name: SFU_IP, value: "$SFU_IP" }
      envFrom: [ { secretRef: { name: spike-lk } } ]
      command: ["/bin/bash", "-c"]
      args:
        - |
          set -euo pipefail
          if [ "$cap" = yes ]; then apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables >/dev/null && iptables -S >/dev/null && echo "iptables ready"; fi
          mkdir -p /work /spike /out && cd /work && npm init -y >/dev/null
          npm install --no-audit --no-fund --silent playwright@1.62.1 livekit-client@2.22.3
          cp /cfg/driver.js /spike/ && cp /cfg/runner.mjs /work/
          echo "node \$(node -v) ready"; node runner.mjs; echo "RUNNER_EXIT=\$?"; sleep 3600
      volumeMounts: [ { name: cfg, mountPath: /cfg } ]
      resources: { requests: { cpu: 250m, memory: 512Mi }, limits: { memory: 1536Mi } }
  volumes: [ { name: cfg, configMap: { name: spike-files } } ]
EOF
}

waitlog() { # pod, pattern, timeout_s
  for _ in $(seq 1 "$3"); do kubectl -n $NS logs "$1" 2>/dev/null | grep -q "$2" && return 0; sleep 1; done
  echo "timeout waiting for '$2' in $1" >&2; kubectl -n $NS logs "$1" --tail=30 >&2 || true; return 1
}

pod observer no
waitlog spike-observer '"step":"joined"' 300
echo "observer joined"
pod subject yes
waitlog spike-subject '"step":"joined"' 300
echo "subject joined; timeline running (~4 min)"
waitlog spike-subject 'RUNNER_EXIT=' 600
waitlog spike-observer 'RUNNER_EXIT=' 400
for r in observer subject; do
  kubectl -n $NS logs spike-$r > "$HERE/out/$r.log"
  kubectl -n $NS cp spike-$r:/out/result.json "$HERE/out/$r.json" >/dev/null
  kubectl -n $NS get pod spike-$r -o jsonpath='{.spec.nodeName}{"\n"}' | sed "s/^/$r node: /"
done
grep -h "RUNNER_EXIT" "$HERE"/out/*.log
kubectl -n $NS delete pod spike-observer spike-subject --wait=false >/dev/null
echo "results in $HERE/out"
