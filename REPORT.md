# C4 gate one: report (2026-09-29)

Scope: deploy LiveKit and Janus (VideoRoom) on the EKS lab and map each stack's
participant-lifecycle vocabulary. No clients, no multi-party call, no fault injection.
Nothing committed, nothing pushed. The lab repo was not modified.

## 1. What deployed

| Stack | Result | Attempts | Evidence |
|---|---|---|---|
| **LiveKit** server v1.13.7 (chart 1.9.0, image pinned by digest) | **Deployed and verified**: API authenticated (`lk room list`), webhooks delivered to its own sink, adapter live check OK | 1 (helm exit 0) | `logs/livekit-deploy-attempt1.log` |
| **Janus** 1.4.1, Debian build `1.4.1+ds-4+b2` arm64 (stock `debian:sid-slim` plus a pinned snapshot.debian.org apt source) | **Deployed and verified**: `info`, Admin API, event handler to sink, VideoRoom join/leave, adapter live check OK | **2** | `logs/janus-deploy-attempt{1,2}.log`, `logs/janus-attempt1-*` |

**Janus attempt 1 failed.**
- Symptom: CrashLoopBackOff, apt exit 100: `Version '1.4.1+ds-4' for 'janus' was not found`.
- Cause (mine): I pinned the **source** version. The arm64 **binary** in the pinned snapshot
  is the binNMU `1.4.1+ds-4+b2` (first seen 2026-09-19); confirmed from the snapshot's own
  `Packages` index.
- Attempt 2 changed only the pin, and it rolled out in about 1 minute.
- The community image was not tried (D2).

**Isolation:**
- Namespaces `c4-livekit` and `c4-janus`, each with its own Service and event sink; the
  two stacks never reference each other.
- Required pod anti-affinity keeps them on different nodes.
- All ports sit in 30000–32767, reachable only from inside the VPC. No new NLB, no
  security-group change, no Terraform change, no new AWS resource.

**Step 0.**
- `make up` attempt 1: exit 2, nothing created (`up.sh` prompts unless `ASSUME_YES=1`;
  no stdin).
- `make up` attempt 2 (`ASSUME_YES=1`): exit 0, 05:11–05:29 UTC, 53 resources.
- Verified: 2 nodes Ready (arm64), coturn 1/1, NLB active with 21/21 targets healthy,
  STUN 5/5. The first STUN batch went 0/5 during NLB warm-up, the same as last session.

## 2. Participant-event vocabulary

Full, source-cited files:
- `vocabulary/livekit.md` and `vocabulary/janus.md`: ground truth, OBSERVED vs DOCS-ONLY.
- `vocabulary/*-docs.md`: documentation and source at the pinned versions.
- `vocabulary/payloads/`: real payloads.
- `probes/raw/`: every captured byte.

### LiveKit (observed via lk CLI probes, no media)

| What happened | Server (webhook) | Server state API | Other participant (lk / Go SDK) |
|---|---|---|---|
| Join | `participant_joined` when ICE is connected (ACTIVE), ~26 ms after the WS join | ACTIVE | `participant connected` (+0.8–2.3 s) |
| Graceful leave | `participant_left` `CLIENT_INITIATED`, 1.1 s after SIGTERM | removed | `participant disconnected` (+1.2 s) |
| Process killed, no leave | `participant_left` **`CONNECTION_TIMEOUT` at +20.8 s**. Server log: WS closed +0 s (participant kept), ICE disconnected +9.7 s, failed +15.7 s, closed +20.7 s | **ACTIVE the whole 20.8 s**, then gone | `participant disconnected` at +23 s, with no earlier sign |
| Same identity joins again | old sid `participant_left` **`DUPLICATE_IDENTITY`**, new sid `participant_joined` 22 ms later | same identity, new sid | **Nothing at all** (Go SDK hides the replacement) |
| Resume (same sid, ICE restart) | **no webhook** (docs) | unchanged | nothing (docs) |

### Janus VideoRoom (observed via raw WebSocket-API probes, no PeerConnection)

| What happened | Server (event handler) | Self | Other participant |
|---|---|---|---|
| Join | plugin `joined` (only VideoRoom event with a session id) | `joined` | `joining` (1 ms) |
| Graceful `leave` | plugin `leaving` | `leaving:"ok"` | `leaving` **only** (docs wrongly say `unpublished` too) |
| WS closed, no leave | transport `disconnected` → session `destroyed` → `unpublished` → `leaving`, **same ms** (reclaim=0) | none | `unpublished` + `leaving`, 0 ms |
| Silent session, WS open | session `timeout` at **+60.05 s** → `unpublished` → `leaving`; the WS stays open | `{"janus":"timeout"}` | `unpublished` + `leaving`, indistinguishable from WS close |
| Rejoin with a live feed id | **nothing** | **436** "User ID 1003 already exists"; old participant not evicted | nothing |
| `claim` after WS close | **nothing** | **458** "No such session" (reclaim=0 makes claim impossible) | nothing |
| ICE failure / hangup / media stall | docs: webrtc `hangup{reason}`, media `receiving:false`; participant **stays**, `publisher:false` | docs | docs: `unpublished` without `leaving` |

### How each stack expresses the four study regimes (summary)

| Regime | LiveKit | Janus |
|---|---|---|
| Continues | invisible | invisible (media events only) |
| Transport restart in session | resume, same sid; **no webhook or state change** | app-initiated ICE restart; `claim` impossible at reclaim=0 |
| Rebuild | new sid; old one evicted `DUPLICATE_IDENTITY` | new session; **same feed id refused (436) until the old session dies** (0 s after WS close, 60 s if silent) |
| Never recovers | `CONNECTION_TIMEOUT` at ~20.8 s (hard-coded) | WS close: instant. Silent: 60 s. Silent media with WS up: possibly **never** (docs; consent freshness off) |

## 3. Adapter scaffolding

`adapters/`:
- `canonical-events.json`: 20 stack-neutral events, cause-specific `left.*` variants.
- `interface.md`.
- `base.mjs`.
- `livekit/` and `janus/`: `adapter.mjs`, `mapping.json`, `replay-cases.json`, `fixtures/`.
- `conformance.mjs`.

Results:
- **Coverage:** LiveKit 9 observed / 9 docs-only / 2 unsupported; Janus 8 / 9 / 3. Every
  "unsupported" has a reason. Example: LiveKit never rejects a duplicate (it evicts); Janus
  never evicts (it rejects).
- **Replay:** every captured stream normalizes to the scenario ground truth. 49 canonical
  events across 5 streams. `node adapters/conformance.mjs` gives exit 0.
- **Mutation check:** mapping `CONNECTION_TIMEOUT` to `graceful` makes it fail (exit 1).
- **Live check** through port-forward, exit 0: health, idempotent `ensureRoom`,
  `listParticipants`, and credential minting on both deployments.
- **Adding a third stack** = one new directory. The runner discovers adapters.
- **Participant-facing half:** not built (DC-1).

## 4. Time: actual vs estimate

| Item | Estimate | Actual (UTC) |
|---|---|---|
| Step 0 lab up + verify | 0.5 h | 05:09–05:38, ~30 min (includes the prompt/EOF false start) |
| LiveKit deploy + verify | 1.5–2 h | 05:30–05:31, **~2 min** (prep done while the cluster built) |
| Janus deploy + verify | 2.5–3.5 h | 05:39–05:50, **~11 min**, of which 9 min was attempt 1 waiting out its rollout timeout |
| Vocabulary (docs + probes) | 2–3 h | 05:50–05:58 probes; the docs ran in parallel 05:21–05:33; write-up to ~06:00 |
| Adapters + conformance | 1.5–2 h | ~06:00–06:04 |
| Park + report | 0.5 h | 06:04 onward; the park took far longer than planned (§6) |
| **Total** | **8.5–11.5 h** | **About 1 h of work after approval**, plus the park wait |

The estimate was padded for risks that did not materialise: Janus packaging worked on the
second attempt, and without media nothing needed debugging on the network path. The
estimate is not evidence that the *study* will be quick; §5 says why.

## 5. Things suggesting the study will be harder than planned

1. **LiveKit's most important regime is invisible on the standard server surface.** A
   resume (transport restart within the session) produces no webhook, no state change, and
   nothing for others. Classifying it needs the server **debug log**, client
   instrumentation, or LiveKit's analytics stream. The debug log must be treated as a
   primary data source, and its format is not a stable API.
2. **Janus regimes are bounded by two server knobs as much as by the app.**
   - `reclaim_session_timeout` (0 means signalling recovery is impossible).
   - `session_timeout`: a zombie participant blocks its own feed id for up to 60 s, so a
     "rebuild" gets 436 unless the app changes id.

   These are study variables, not defaults. With DC-1 this widens: for Janus, regime =
   app policy × server config.
3. **"What other participants observe" depends on the observer's SDK**, not only on the
   stack. The Go-SDK observer never saw the duplicate-identity replacement that the browser
   SDK would (per source). The lk CLI also quantizes events to 1 s ticks. DC-1 extends to
   observers: observers need to be the same client type as participants.
4. **Timing resolution is uneven.**
   - LiveKit webhook `createdAt` is in whole seconds, so use sink receive time or the server
     log (ms).
   - Janus events are microsecond-stamped.
   - Cross-stack latency comparisons need the same `atSource`. The adapter records it.
5. **Janus correlation hazards.**
   - `leaving`/`unpublished` carry no session id.
   - WebSocket transport ids are **reused** across connections.
   - 436 and 458 produce **no** server-side event at all.
6. **Silent media loss in Janus may never surface.** With consent freshness and
   `hangup_on_failed` off (the defaults), a participant whose network dies while its WS
   stays up may produce no event (docs). "Never recovers" could then be unobservable
   server-side. Enabling consent freshness changes the stack under test, so that is a
   decision for you.
7. **Janus startup depends on snapshot.debian.org.** Every pod start, including every
   unpark, re-runs apt (~1 min). If snapshot.debian.org is slow or down, Janus does not
   start. The durable fix is an image built in-cluster (not over the Mac uplink) into ECR.
   That adds AWS resources, so it is your call.
8. **Co-location:** LiveKit landed on the same node as coturn. Once media flows, pin
   placement explicitly, or relay CPU will confound SFU timing.
9. **The lab's cost control is broken** (§6).

## 6. Final lab state and running cost

**`make park` is a silent no-op.**
- It exited 0 with `Apply complete! Resources: 0 added, 0 changed, 0 destroyed`, and the
  node group stayed at desired=2.
- Cause: the terraform-aws-modules EKS managed node group sets
  `lifecycle { ignore_changes = [scaling_config[0].desired_size] }`
  (`.terraform/modules/eks/modules/eks-managed-node-group/main.tf:563`). So
  `-var node_group_desired_size=0` never reaches AWS.
- **`make unpark` is equally a no-op.** The earlier "parked ~$0.13/hr" figure in my notes
  was probably never realised by this target.

**Parking was done directly:**
- `aws eks update-nodegroup-config … desiredSize=0` (exit 0; update
  `1d5549b0-c3a3-33f6-880f-9a6d874d92d7` Successful). Terraform ignores that field, so
  there is no drift.
- The drain was then held by PodDisruptionBudgets: coturn (minAvailable 1, 1 replica) and
  coredns, both with 0 allowed disruptions. Instances waited in `Terminating:Wait` from
  06:05:12 UTC.
- Outcome: **both node instances confirmed gone at 06:21:44 UTC**, about 16.5 min after
  the manual scale-to-zero (AWS CLI `update-nodegroup-config desiredSize=0`, 06:05 UTC).
  The drain was held by the coturn and coredns PDBs until EKS force-terminated past them.
- The lab is **PARKED**: node group desired=0, 0 nodes; the control plane and the coturn
  NLB are kept.
- The lab was fully up (nodes running) from 05:25 to 06:21 UTC.
- Snapshot: `logs/final-state.txt`. It was captured at 15:3x UTC in a follow-up session,
  because the tool-permission errors blocked it at 06:22.

**To unpark:**
```
aws eks update-nodegroup-config --cluster-name realtime-media-aws-lab --nodegroup-name media-d2d1bcd317a9f7e6ac1dd04994 --scaling-config minSize=0,maxSize=4,desiredSize=2
```
Run it with `AWS_PROFILE=medialab`. Not `make unpark`. After unpark:
- pods get **new IPs**;
- Janus re-runs apt;
- the NLB needs a few minutes of warm-up before STUN answers.

**Preserved:** the cluster, the NLB, Helm release `livekit`, both namespaces, ConfigMaps,
Secrets, and Deployments. The pods are Pending, not deleted.

**Running cost (list prices; Cost Explorer lags ~24 h, so not verified today):**
- **Parked:** EKS control plane $0.10/h + NLB $0.0225/h + 2 NLB public IPv4 $0.01/h ≈
  **$0.13/h ≈ $3.20/day**, plus small KMS/CloudWatch. In line with the ~$3.40/day you
  expected.
- **Up:** add 2× c7g.large ($0.145/h) + 60 GB gp3 ≈ **$0.28/h ≈ $6.90/day**.
- The lab was fully up 05:25–06:05+ UTC today.
- **No new billable resources were added by C4.**

## 7. Files

- **Plan and design constraints:** `PLAN.md`, containing DC-1 (the reconnect-policy
  asymmetry, with resolutions (a) and (b) left open) and DC-2 (the TURN-path future cost,
  three options).
- **Deploy:** `deploy/livekit/`, `deploy/janus/`.
  - Secrets live only in `*.local.yaml` (0600) and in-cluster Secrets.
  - Note: `logs/make-up.log` contains the Grafana admin password, printed by the lab's own
    `up.sh`.
- **Logs:** `logs/` (timeline, every attempt, deployed-state snapshot).
- **Probes:** `probes/` (scripts, marks, raw captures).
- **Vocabulary:** `vocabulary/`.
- **Adapters:** `adapters/`.

---

## 8. Follow-up session (2026-09-29, ~15:36 UTC onward)

### Park/unpark fix (lab repo)

**Diagnosis.** The `ignore_changes = [scaling_config[0].desired_size]` is **deliberate
upstream code** in terraform-aws-modules/eks v21.25.0. It is not a lab choice. The
module's `docs/faq.md` says it is "ignored to allow autoscaling via controllers such as
cluster autoscaler or Karpenter … Changing the desired count must be handled outside of
Terraform". So it is kept.

**Fix.** `make park` and `make unpark` now call `scripts/nodegroup.sh`, which:
1. sets the size through the EKS API, keeping min/max;
2. takes the unpark size from Terraform's `node_group_desired_size`;
3. waits for the EKS update;
4. then **verifies against EC2 and Kubernetes**: park needs 0 live instances and 0 nodes;
   unpark needs N nodes Ready. It exits non-zero otherwise.
5. Before a park, it names the PDBs that will hold the drain.

### Placement (C4 manifests, uncommitted)

- **Rule:** SFU ↔ coturn is REQUIRED anti-affinity. LiveKit ↔ Janus is PREFERRED.
- **Two nodes cannot separate three workloads.** With 2 nodes: coturn alone; LiveKit and
  Janus share a node.
- **Why that pairing:** coturn sits on the relay path of any relay-forced participant
  (DC-2), so it must not share with the SFU under test. The two SFUs are only harmful
  together if trials run on both stacks at once. If trials are sequential, the idle SFU
  costs ~nothing.
- **If concurrent trials are wanted:** a third node (max is 4) separates all three
  automatically under these rules. Cost: +$0.0725/h while up, $0 parked.
- **Also shared (not addressed here):** the monitoring stack (Prometheus, Grafana)
  lands wherever there is room.
