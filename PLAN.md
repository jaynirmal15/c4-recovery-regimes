# C4 gate one: deploy LiveKit and Janus on the EKS lab (plan, awaiting approval)

Written 2026-09-29 ~05:15 UTC. Nothing below has been deployed yet.

## Step 0: lab state (done or in progress)

- The lab was down. The 2026-09-29 04:23–04:39 UTC `make down` had finished (exit 0), and
  terraform state was empty. No terraform process was running.
- `make up`, attempt 1, 05:09 UTC: **exit 2, nothing created.** `up.sh` runs
  `terraform apply` interactively unless `ASSUME_YES=1`, and the background shell had
  no stdin (`error asking for approval: EOF`). The plan was 53 to add, the same count as
  the teardown. Log: `logs/make-up-attempt1-prompt-eof.log`.
- `make up`, attempt 2, 05:11 UTC with `ASSUME_YES=1` (the script's own switch): running.
  Log: `logs/make-up.log`. Verification after it finishes: nodes Ready, coturn 1/1, NLB
  active with healthy targets, and a STUN probe.

## What I found that shapes the plan

1. **Nodes are arm64** (`c7g.large`, Graviton). Every image must have an arm64 build.
2. **The only ports internet clients can reach are coturn's**: 3478 plus relay ports
   49160–49179, through the NLB. The node security group opens 30000–32767 TCP/UDP to the
   **VPC CIDR only**. Pods get real VPC IPs (VPC CNI), so a pod listening on a port in
   30000–32767 is reachable from anywhere inside the VPC, with no security-group or
   Terraform change.
3. **coturn refuses to relay to private addresses** (`denied-peer-ip=10.0.0.0-10.255.255.255`
   and so on). A client forced through the lab coturn therefore cannot reach an SFU that
   advertises a VPC-private address. That is a design decision for the study phase, not for
   this one (see Risks, item 4).
4. The Mac uplink corrupts uploads (~1–2%/MB, see the drainwatch notes). That rules out
   pushing custom images to ECR from here, and makes the Mac a poor place for media clients.

## Deployment approach

Each stack gets its own namespace (`c4-livekit`, `c4-janus`), its own Services, and its own
event sink. The two stacks never reference each other. Pod anti-affinity puts them on
different nodes, so one SFU's CPU never competes with the other's. All media and signalling
ports sit in 30000–32767, so they are VPC-reachable under the existing rule.

**No Terraform change, no new NLB, no security-group change, no new AWS resource.** Park
cost stays at today's ~$3.40/day. All C4 files live in `~/Jay_NIW/c4-recovery-regimes/`,
which is not a git repo. The lab repo is not modified.

### LiveKit

- **How:** the official Helm chart `livekit/livekit-server` (chart v1.5.x) with image
  `livekit/livekit-server` v1.13.7 (multi-arch, arm64 verified), both pinned. Single node,
  so no Redis (Redis is only needed for multi-node routing).
- **Config:** `hostNetwork: false`. Signal/HTTP on 31880/tcp, `rtc.tcp_port` 31881,
  `rtc.udp_port` 31882 (single-port UDP mux), and `use_external_ip: false`, so it advertises
  its pod IP. Embedded TURN is off. The API key/secret is generated into a Secret and
  written only to a git-ignored local file (never printed).
- **Observability for the event map:**
  - Webhooks go to an in-namespace sink pod (`mendhak/http-https-echo`, multi-arch), which
    logs every payload with a timestamp.
  - Room/participant state comes from the RoomService API (`ListParticipants` exposes
    participant state JOINING/JOINED/ACTIVE/DISCONNECTED).
  - Server logs as well.
- **Reached (now):** `kubectl port-forward` for the HTTP/Twirp API and the WebSocket
  (TCP only; enough for API and signalling probes). **Later:** by clients inside the VPC
  at `<pod-ip>:31880/31881/31882`.

### Janus (VideoRoom)

- **How:** there is no official Janus image or Helm chart.
  - **Primary:** Debian's own build, package `janus 1.4.1+ds-4` (upstream is v1.4.2).
    It runs in the stock `debian:sid-slim` image pinned by digest, with apt pointed at a
    fixed `snapshot.debian.org` timestamp and an exact version pin, so a restart
    reinstalls the same bits. The package ships VideoRoom, the WebSockets transport, and
    the HTTP/WebSocket event handlers (arm64 file list checked).
  - Trade-off: about 1 minute of apt at pod start, and a dependency on Debian's
    mirrors. No custom image and no ECR push.
  - **Fallback:** community image `sucwangsr/janus-webrtc-gateway-docker:1.4.1-muti`
    (multi-arch), pinned by digest. It is third-party provenance, so second choice.
- **Config** (ConfigMaps for `janus.jcfg`, `janus.transport.websockets.jcfg`,
  `janus.plugin.videoroom.jcfg`, `janus.eventhandler.sampleevh.jcfg`):
  - WebSocket API on 31188, HTTP API on 31088.
  - Admin API on 31788, pod-local only, never in a Service.
  - `rtp_port_range` 32000–32199 on the pod IP; no `nat_1_1_mapping` for now.
  - `session_timeout` left at its default (60 s) and recorded, because it defines Janus's
    reconnect window.
- **Observability:**
  - The sample event handler POSTs all core, plugin, and transport events (session
    create/destroy/timeout, handle attach/detach, `webrtcup`, `hangup` with reason,
    `media`, `slowlink`, VideoRoom `joined`/`publishers`/`leaving`/`unpublished`) to the
    namespace's own sink.
  - The Admin API (`list_sessions`, `handle_info`) and the VideoRoom `listparticipants`
    request.
- **Reached:** as for LiveKit: port-forward now, VPC pod IP later.

## Client side (eventually; not built in this phase)

- **LiveKit:** headless Chromium via Playwright, running the `livekit-client` JS SDK
  (the same Web Audio / pattern source as the existing harness). Tokens are minted with
  `livekit-server-sdk` for Node. The alternative is Go/Python SDK bots, but those use
  pion/libwebrtc-native, not the browser engine, so they would measure a different client.
- **Janus:** headless Chromium with `janus.js` (Meetecho's library) against the WebSocket
  API.
- **Where:** in AWS, not on the Mac. Either as pods in a third namespace (`c4-clients`), or
  on an EC2 runner in the VPC. The uplink corruption would contaminate media loss, and
  in-VPC clients need no new ingress rules.
- **Isolating one participant:** easiest per-pod, e.g. a NET_ADMIN sidecar applying
  `tc`/iptables on that pod only. That is a design question for you.

## Adapter scaffolding (so a third stack is one new directory)

`c4-recovery-regimes/adapters/`:

- `canonical-events.json`: the stack-neutral vocabulary. Examples:
  - `participant.joined`
  - `participant.left.graceful`
  - `participant.left.timeout`
  - `participant.transport.disconnected`
  - `participant.transport.reconnecting`
  - `participant.transport.resumed` (same session)
  - `participant.rejoined` (new session, same identity)
  - `track.published` / `track.unpublished`
  - `media.flowing` / `media.stalled`
  - `room.created` / `room.ended`
- `interface.md` plus `base.mjs`: the contract every adapter implements. This covers:
  - `describe()`
  - `health()`
  - `ensureRoom()`
  - `mintJoinCredential()`
  - `listParticipants()`
  - `readServerEvents(since)`
  - `normalize(nativeEvent) -> canonical[]`
- `<stack>/adapter.mjs` plus `<stack>/mapping.json` (native event to canonical event,
  with observer: server / other-participant / self, and the source: doc URL or observed
  payload).
- `conformance.mjs`: checks that every adapter implements the interface and that its
  mapping covers every canonical event or marks it explicitly `unsupported`, with a reason.

Only the server-facing half is implemented now. The participant-facing half (what other
participants' SDKs emit) is documented in the mapping but not wired, because it needs the
client design.

## The event-vocabulary work

Per stack, from two sources recorded separately:

- **(a) Documentation:** URL and version for each event.
- **(b) Observed:** actual payloads captured from the running deployment.

**Asking approval for (b):** capturing real payloads needs something to join and leave.
I propose **signalling-level probes only, one participant at a time, no media, no
browser**:

- **LiveKit:** the official `lk` CLI run as a pod in `c4-livekit` (image `livekit/livekit-cli`),
  doing `lk room join` without publishing, then disconnecting. Also a join that is
  killed without a clean leave, to observe the timeout path.
- **Janus:** a ~50-line Node WebSocket script that runs create session → attach
  videoroom → join as publisher → leave → destroy. Also a variant that stops keepalives
  (observes the `timeout` event) and one that reconnects with `claim` (observes session
  re-attach).

That is not a headless participant and not a multi-party call. If you would rather I
capture documentation only, say so. In that case the "observed" column stays empty, and
the vocabulary is flagged as docs-only.

## Estimate

| Item | Estimate |
|---|---|
| Step 0: lab up and verified | 0.5 h (in progress) |
| LiveKit deploy + sink + verify | 1.5–2 h |
| Janus deploy (Debian build) + event handler + sink + verify | 2.5–3.5 h |
| Event vocabulary, both stacks (docs + probes) | 2–3 h |
| Adapter scaffolding + conformance check | 1.5–2 h |
| `make park`, verify, final report | 0.5 h |
| **Total** | **8.5–11.5 h**. Fits the 10–12 h window with little slack. If time runs short, the scaffolding gets cut first, not verification. |

## What is likely to take longer than expected

1. **Janus packaging.** No official image; arm64 narrows the choices further. If the
   Debian-in-pod approach fails twice (apt at start, snapshot mirror, missing libs), rule 1
   applies: stop, record the evidence, and try the fallback only if that counts as a
   different approach. My reading is that it does not, so I would record the blocker and
   move on. Tell me if you want the fallback tried.
2. **The recovery regime is partly a client decision, asymmetrically.**
   - LiveKit's SDK has built-in reconnect policy: "resume" (ICE restart on the same
     session) versus "full reconnect" (rejoin). The regime you observe depends on the SDK
     version.
   - Janus has no client policy at all. `janus.js` leaves reconnect, ICE restart,
     session `claim`, and rejoin to the application.
   - So for Janus, "which regime happens" is something **we** write. The study's question
     ("what determines which?") has a different meaning per stack. This is the biggest
     design risk I see, and it needs your call before clients are built.
3. **Server-side timers decide the regimes and differ by stack.** LiveKit's
   departure/reconnect timeouts sit against Janus's `session_timeout` (60 s default) and
   ICE/DTLS consent. A 10 s isolation may land in different regimes simply because of
   defaults. I will record every such timer per stack.
4. **TURN path.** A participant forced through the lab coturn cannot reach a VPC-private
   SFU (coturn's `denied-peer-ip` 10/8). The later options are:
   - (a) allow the lab VPC CIDR as a peer in coturn;
   - (b) SFUs advertise node public IPs (needs `hostNetwork` plus SG rules, i.e. a
     Terraform change);
   - (c) per-stack NLBs (+~$0.8/day each while parked; UDP through NLB has the two
     drainwatch findings: zonal blackhole, 5-tuple pinning).

   Not needed for this phase; flagged now because it changes infrastructure.
5. **Parking changes node identity.** `make park` scales nodes to 0. Helm releases,
   ConfigMaps, and Secrets survive, but pods go Pending and come back with **new pod IPs**
   after `make unpark`. Anything that pins an SFU address must re-discover it after
   unpark. The adapters will read it from the API rather than from config.
6. **Node headroom.** Two `c7g.large` nodes already carry kube-prometheus-stack and coturn.
   LiveKit and Janus are light when idle; I will record requests versus allocatable per
   node.

## Rules I will follow while you are away

- Two failed deployment attempts on a stack: stop on it, switch, record the evidence.
- Finish or stuck: run `make park`, verify nodes are 0, and report the real exit code.
  Never `make down`.
- Commit nothing. Every command's real exit code is logged in `logs/`.
- Output files: `c4-recovery-regimes/REPORT.md`, `vocabulary/livekit.md`,
  `vocabulary/janus.md`, `adapters/`, `deploy/`, `logs/`.

---

## Approval and decisions (Jay, 2026-09-29 ~05:20 UTC)

Plan approved. Step 2 is deployment plus event-vocabulary mapping only: no headless
participants, no three-party call.

- **D1. Event-capture probes: approved.** `lk` CLI inside the cluster for LiveKit; a
  ~50-line WebSocket script for Janus. Aim: ground truth for what events contain and
  when they fire, not just what documentation calls them.
- **D2. Janus fallback: not approved.** If the Debian approach fails twice, record the
  blocker with evidence and stop. Do not try the community multi-arch image; that choice
  is Jay's to make knowingly.

## Design constraints

### DC-1. DECIDED 2026-09-29 (Jay): Option (a), hold client reconnect policy constant

**Decision.** Primary arm: hold the client reconnect policy constant across both stacks and
measure what each **server** permits. We are studying the server, not comparing two SDKs.

**Reasoning.** The object of study is which recoveries the server allows and what it
reports. That is isolated only if the client behaves identically against both stacks. If
the client differs, a difference in outcome cannot be attributed to the server.

**Option (b)** (measure each stack as shipped) is kept as a possible **secondary arm**, if
time allows. It is not the primary.

Feasibility of holding the policy constant is assessed in `CLIENT-FEASIBILITY.md` before
any client code is written.

*Original framing, kept for the record:*

LiveKit ships its reconnection logic in the client SDK (resume = ICE restart on the same
session versus full reconnect = rejoin). Janus leaves reconnection to the application
(ICE restart via `configure` with `restart: true`, session `claim` on a new transport,
or a fresh join are all app code). For Janus, therefore, the regime is whatever we write.
"What determines the regime" is not one question across both stacks: it is **SDK policy**
for LiveKit and **application policy** for Janus.

Candidate resolutions, deliberately NOT resolved now:

- **(a) Hold client policy constant across both stacks** and measure what each *server*
  permits: the same reconnect state machine, implemented on both, with the stack as the
  only variable. More defensible as research.
- **(b) Measure each stack as shipped** (LiveKit SDK defaults; Janus with `janus.js` plus
  the reference application's behaviour) and report them as different objects.

### DC-2. Known future cost: TURN path to the SFUs

The lab coturn refuses to relay to private addresses (`denied-peer-ip` covers 10/8, among
others). A participant forced through it cannot reach an SFU that advertises only a
VPC-private address. Not needed in this phase; will be needed as soon as a relay-forced
participant exists. Options:

1. **coturn allowed peers:** add `allowed-peer-ip` for the lab VPC CIDR (a config change
   to the lab coturn, affecting everything that uses it).
2. **Public node IPs plus security-group rules:** SFUs on `hostNetwork` advertising node
   public IPs; a Terraform change to node SG ingress. Node IPs change on park/unpark.
3. **A load balancer per stack:** about +$0.8/day each, parked or not. UDP through an NLB
   carries the two drainwatch findings (zonal blackhole with cross-zone off; UDP 5-tuple
   pinned to a dead target). Listener cap: 50 per NLB.

### DC-3. Node placement: trials run one stack at a time (recorded 2026-09-29, Jay). SUPERSEDED for node count by DC-3a; the one-stack-at-a-time rule still stands (see DC-3a)

The lab has two nodes. Placement rules (deploy/livekit/values.yaml,
deploy/janus/deployment.yaml):
- Each SFU has REQUIRED anti-affinity to coturn.
- LiveKit and Janus have PREFERRED anti-affinity to each other.

On two nodes this gives **coturn alone on one node, and LiveKit and Janus sharing the
other**. Verified after a fresh unpark on 2026-09-29.

**Constraint:** because the SFUs share a node, **trials must run one stack at a time.** An
idle SFU costs next to nothing, but two SFUs carrying media together would confound each
other's timing.

**If concurrent stacks are ever needed:** that requires a **third node**
(`node_group_desired_size=3`; max is 4). The same rules then separate all three workloads
with no manifest change. Cost: about +$0.0725/h while up, $0 while parked.

### DC-4. Janus `reclaim_session_timeout = 30` s (decided 2026-09-29, Jay; no sweep for now)

**Setting:** `reclaim_session_timeout` changes from 0 (the Janus default, used in gate one) to
**30 s**, as a deliberate configuration decision.

**Rationale:**
- With 0, Janus destroys a session the instant its WebSocket closes. **Signalling re-attach
  (`claim`) is then impossible**: gate-one probe J4 got 458 "No such session".
- Under Option A (DC-1) the constant client policy includes "re-attach signalling to the same
  session". At 0, that action would be measured as structurally unavailable on Janus, while
  LiveKit offers the equivalent (resume, ~20.8 s window).
- 30 s gives Janus a comparable window of the same order as LiveKit's hard-coded ~20.8 s. So
  the study measures what the server does *when re-attach is permitted*, rather than a default
  that forbids it.
- It is a **fixed value, not a sweep**. It must be reported as a configured parameter wherever
  Janus results appear.

**Consequence to measure, not assume.** Per source (janus.c), the reclaim window is counted
from the session's **last request**, not from the WebSocket close. A session whose last
keepalive was 20 s before the WS dropped may have only about 10 s left. Verify on the running
server.

### DC-5. Isolation is network-level (decided 2026-09-29, Jay)

Participant isolation is applied at the **network layer**, on the isolated participant only,
never through browser offline emulation. Reason: livekit-client's `online` handler calls
`attemptReconnect` directly and bypasses the reconnect policy
(`CLIENT-FEASIBILITY.md` Q1), so browser-level emulation would reintroduce SDK behaviour.

Mechanism for the spike: `iptables` DROP rules in the isolated participant's own pod network
namespace (container with `NET_ADMIN`), matching the SFU pod IP. Clients connect to the SFU
**pod IP** directly, not the ClusterIP Service: kube-proxy DNATs Service traffic outside the
pod namespace, so a pod-level rule on the ClusterIP would not also cover media.

### Spike (approved 2026-09-29, Jay)

Prove the driven livekit-client v2.22.3 before building on it. Pass criteria:

- **(a) Stays passive** through a 10 s network isolation: no automatic resume or reconnect,
  and no `close()`.
- **(b) Driver can trigger** resume and full reconnect on demand.
- **(c) Raw-frame logging** captures `ParticipantUpdate`, `ReconnectResponse`, and
  `LeaveRequest`.
- **(d) Nothing reconnects behind the driver's back**, including through a longer isolation
  that exercises the ping timeout, the server leave request, and server-side WS close.

Also verify the DC-4 Janus setting on the running server.

### DC-3a. Three nodes (decided 2026-09-29, Jay)

**Decision:** the lab runs **three** nodes (`node_group_desired_size` default 2 → 3 in the
lab repo's `terraform/variables.tf`). Three participants plus coturn plus monitoring do not
fit on two: the spike's second client could not schedule at 500m CPU. The study runs many
trials, and scheduling fragility costs more than the extra node (+$0.0725/h while up,
$0 while parked).

**Placement rule:**

| Node | Holds |
|---|---|
| 1 | coturn, alone (no SFU, no client) |
| 2 | the SFU under test |
| 3 | the clients (subject and observers) |

**Can both SFUs run at the same time on three nodes? No, not without breaking the rule.**
- coturn and the two SFUs, each required apart from coturn and preferring each other's
  absence, occupy all three nodes: A = coturn, B = LiveKit, C = Janus.
- Clients must then share with an SFU, because the other two nodes each hold one. A client
  rule of "away from coturn and away from both SFUs" is unschedulable. **Verified
  2026-09-29 18:10 UTC**: three stand-in client pods with that rule stayed Pending, "0/3 nodes
  are available: 3 node(s) didn't match pod anti-affinity rules" (`logs/dc3a/placement-test.txt`).
- Therefore **trials still run one stack at a time**, and the idle SFU is **scaled to 0
  replicas** for the duration of the other stack's trials. That frees node 3 for clients
  alone.
- Running both stacks concurrently would need a **fourth** node (the node group max is 4):
  coturn, LiveKit, Janus, clients.

**Rules as implemented:**
- SFU ↔ coturn: required anti-affinity (existing).
- LiveKit ↔ Janus: preferred (existing).
- Clients: required away from coturn **and** from the SFU under test.

Monitoring (Prometheus/Grafana) is not pinned; it lands where it fits. "coturn alone" means
no SFU and no client.

**Verification (2026-09-29, 3-node cluster, `logs/dc3a/`):**
- `make unpark` read target 3 from Terraform and verified 3/3 Ready in 48 s (exit 0).
  `terraform plan` showed "No changes" after the default change.
- With coturn on A, LiveKit on B, and Janus on C:
  - the strict client rule was unschedulable (above);
  - the trial rule for a LiveKit trial put all three clients on C, next to the idle Janus;
  - after scaling Janus to 0, node C held only the three clients plus per-node system
    agents (aws-node, kube-proxy, node-exporter, pod-identity-agent).
- **The PREFERRED LiveKit↔Janus rule is not reliable.** Right after the unpark both SFUs
  landed on the **same** node (B) and the third node stayed empty. The rule is a scheduling
  hint and lost when everything scheduled at once.
  - This does not break the design: with the idle SFU scaled to 0 and clients required
    away from coturn and the SFU under test, placement is correct wherever the SFUs start.
  - The trial runner must not assume where the SFUs are. It scales the idle SFU to 0 and
    **checks actual placement before each trial**, failing the trial if the rule is
    violated.

### DC-6. Client keepalive interval = 5 s (decided 2026-09-29, Jay)

(Given as "DC-5" in the decision message; numbered DC-6 here because DC-5 is the
network-level isolation decision.)

**Setting:** every client's signalling keepalive is **5 s**, on both stacks.
- Janus: `keepalive` request every 5 s.
- LiveKit: the SDK's signal ping interval is server-supplied (5 s in v1.13.7), and it is
  recorded per trial.

This is a deliberate, held-constant policy parameter.

**Rationale:**
- Janus counts the reclaim window from the session's **last request**, not from the
  disconnect. DC-4 verification: reaped 30.4 s after the last request, 22.4 s after the WS
  close.
- So the keepalive interval directly sets the **effective post-disconnect reclaim window**.
  At 5 s it is **25–30 s**.
- LiveKit removes a lost participant at **~21 s**: 20.8 s in gate one, 21.4–21.9 s in the
  spike. That is close enough to compare.
- A reviewer will ask why the effective windows differ between stacks. The answer must be
  this stated policy decision, not an accident of defaults. Report both effective windows
  alongside every cross-stack comparison.

### Findings register

Results that are findings in their own right, not implementation notes, are recorded in
`FINDINGS.md` (F1, F2 from the 2026-09-29 spike).

### Stage A (approved 2026-09-29, Jay)

Decisions:
- **A4:** one arm each way. **O** obeys server resume/reconnect requests; **I** ignores
  them.
- **A5:** rebuild = **abandon and rejoin under the same identity**.
- **A6:** as proposed. Full and media-only isolation; 5, 10, 20, 30 s.
- **Placement verification is a hard precondition per trial.** On failure the trial is
  **aborted and not recorded**.

The spec implementing these, including the fixed policy, trial protocol, and regime rubric,
is `STAGE-A-SPEC.md`. **It is awaiting Jay's review of its §7 items before Stage B.**
