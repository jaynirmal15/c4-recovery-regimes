# C4 Stage A: fixed client policy, trial protocol, and regime rubric

Drafted 2026-09-29. **Status: APPROVED 2026-09-29, including all §7 items.** Nothing in Stage B is built until this is
approved. Every value below is either a recorded decision (with a DC or A reference) or is
listed in §7 as introduced here and awaiting confirmation.

Object of study (DC-1): which recoveries each **server** permits, and what it reports, when
the client behaves identically against both stacks.

---

## 1. Fixed client policy (identical on both stacks)

| ID | Parameter | Value | Source |
|---|---|---|---|
| P1 | Signalling keepalive | **5 s**. LiveKit: SDK ping, interval server-supplied (5 s in v1.13.7), recorded per trial. Janus: `keepalive` request every 5 s. | DC-6 |
| P2 | Signal-liveness timeout | **15 s** without any reply → signalling declared dead. LiveKit: SDK ping timeout pinned to 15 via hook. Janus: 15 s since last reply to any request. | A1 |
| P3 | Media-dead detection | **ICE `disconnected` or `failed` on any subject PeerConnection, OR presented media age from any observer > 2 s** (in-band clock). The driver owns this detection; SDK events are logged only. | A2 |
| P4 | Recovery ladder | See §1.1 and §1.1a (**ladder v2** since 2026-10-01) | A3; v2 decision |
| P5 | Obey server recovery requests | **Two arms.** **O (obey):** LiveKit `LeaveRequest{RESUME}` triggers an immediate transport restart; `{RECONNECT}` triggers an immediate rebuild. **I (ignore):** record the request, continue the ladder. | A4 |
| P6 | Rebuild semantics | **Abandon and rejoin under the same identity.** Never send leave or destroy on the old session. See §1.2 | A5 |
| P7 | Attempt timeouts | **Mirrored from livekit-client v2.22.3** (tag `v2.22.3`, commit `53dd8403`) into the Janus client, so that attempt durations are a policy constant, not a stack difference. See §1.5. | confirmed (§7.1) |
| P8 | Server-side config in force | LiveKit: v1.13.7 defaults (removal ≈ 20.8–21.9 s, hard-coded). Janus: `session_timeout` 60 s, **`reclaim_session_timeout` 30 s**. | DC-4 |
| P9 | Signalling probe before SDP (Janus) | **2 s.** Before a transport restart sends any SDP on the existing socket, the client sends a `keepalive` and waits for its ack. No ack within 2 s → the socket is treated as dead and the session is claimed on a new connection. See §1.1b for why, and why 2 s. LiveKit: not applicable, the SDK opens a new signalling connection for every resume. | 2026-10-01 decision |

### 1.1 Recovery ladder (P4)

The same state machine runs on both stacks. `t_d` = first detection (P2 or P3).

1. **Wait W = 5 s.** If signalling and media are both healthy for ≥ 1 s at any point, stop:
   no action is taken.
2. **Transport restart, same session**, first at `t_d + 5 s`. Repeat 5 s after each failed
   attempt finishes (one attempt in flight at a time). Stop escalating on success. Go to
   step 3:
   - **immediately on refusal** by the server; or
   - **by time, at or after `t_d + 30 s`, but only once a transport restart that STARTED
     AFTER connectivity returned has failed** (ladder v2, §1.1a). Until then, keep retrying
     the transport restart every 5 s.
   - LiveKit: **resume** (`reconnect=1`; a signal reconnect plus an ICE restart, bundled by
     the server).
     - Refusal = `LeaveRequest{RECONNECT}` in the handshake.
   - Janus, WS alive: **ICE restart**. Publisher: new offer with `iceRestart`, then
     `configure`. Subscriber handles: `configure {restart:true}`, then answer.
   - Janus, WS dead: new WS, then **`claim`**, then ICE restart as above.
     - Refusal = `claim` 458.
3. **Rebuild** (P6), first immediately at escalation. Repeat 5 s after each failed attempt.
   Janus 436 counts as a failed attempt.
4. **Give up at G = t_d + 60 s.** Stop all attempts, leave the subject as it is, and keep
   observing until the observation window ends.

### 1.1a Ladder v2: retry the transport restart after connectivity returns (decided 2026-10-01, Jay)

**This changes policy P4.** Ladder v1 escalated to rebuild at `t_d + 30 s` unconditionally.
Ladder v2 requires one transport restart *after connectivity has returned* before escalating
by time.

**Why.** Under v1, every Janus 30 s full isolation ended "never recovers" (6/6 in the
shakedown). That result was an artefact of a **0.42 s collision** between our give-up timer
and Janus's reclaim window. It is not a property of Janus (FINDINGS F5):
- Reporting it as a Janus property would be wrong.
- Reporting it as "what this policy does" would be true, but would say more about our ladder
  than about either server.
- A retry before escalation is also what a reasonable client does: the old session was still
  alive, and v1 abandoned it 1.8 s after the network came back without trying it.

**"Connectivity returned"** is driver-owned evidence, identical on both stacks:
- if signalling was lost during the outage (no reply for > 7 s): the first signalling reply
  received after that gap;
- otherwise (media-only loss): the first decoded media sample received after the gap.

It is recorded per trial as `connectivity_returned`. If it never occurs, there is no
escalation by time: the driver keeps retrying the transport restart until give-up.

**Unchanged:** W = 5 s; retry spacing 5 s; refusal escalates immediately; give-up at
`t_d + 60 s`; rebuild mechanics (§1.2).

**Comparability.** All results before this change were produced under ladder v1: the 48-trial
shakedown of 2026-10-01, `shakedown/`, and its smokes.
- **Not comparable with v2:** every trial that reached the *time-based* escalation branch. In
  the shakedown that is the **Janus full-isolation 30 s cells** (6 trials, R3).
- **Behaviourally unaffected** (they never reached that branch):
  - all 10 s cells (recovered by the first transport restart);
  - the LiveKit 30 s cells (escalated by server *refusal*, `RECONNECT/STATE_MISMATCH`);
  - the Janus media-only 30 s cells (the transport restart succeeded).
- The shakedown is harness validation, not study data. **All study trials run under v2**, and
  no v1 result is to be pooled with v2 results.

**Arm O overrides.** A server RESUME request jumps straight to step 2; a server RECONNECT
jumps to step 3. The wait W is skipped in both cases. Janus sends no such requests, so both
arms behave identically on Janus (§4.2).

#### 1.1b Janus transport restart: what the client must do (added 2026-10-01)

Found in `confirm/janus-iso-all-30s-I-20261001T153435-1` and from the Janus 1.4.1 source.

**Claim semantics (`janus.c`, `claim`).** A claim only moves the session to the new
transport and closes the old one. All plugin handles survive, publisher and subscriber.

**Subscriber negotiation state can be stranded (`janus_videoroom.c`).** A subscriber
`configure restart:true` makes Janus send a new offer and clear `answered`. While
`answered` is clear, every later restart for that handle is **postponed with no reply**
(only the core's `ack`). If the offer is lost, the handle is deadlocked. It is lost when:
- it was sent on the old socket and the client then claims on a new one (the claim closes
  the old socket with the offer still queued in it); or
- it arrives after the client's own request timeout and the client drops it.

**Client rules (changes P4's implementation; the ladder itself is unchanged):**
1. A subscriber offer is answered whenever it arrives, with or without a waiting request.
2. After a claim, each subscription is re-established on a **fresh handle** in the same
   session: detach, attach, `join` as subscriber. `configure restart:true` is not used.
3. On a live socket, if Janus acks a subscriber restart and sends no offer, rule 2 applies.
4. **Deliberate change (confirmed 2026-10-01): the publisher and all subscribers restart in
   parallel.** They were serial. The connections are independent, so there is no reason to
   order them, and a real client would not. Serial restarts stacked the 15 s request
   timeouts: one failed restart with two subscriptions took 45 s, which alone consumed most
   of the give-up budget.
5. A transport restart succeeds only if the publisher **and every subscription that
   existed before it** are connected again.

6. **Probe before SDP (P9, decided 2026-10-01).** A transport restart first sends a
   `keepalive` on the existing socket and waits up to **2 s** for the ack. No ack → the
   socket is treated as dead, closed, and the session is claimed on a new connection.

**Why rule 6.** In 2 of 3 trials (`confirm2/janus-iso-all-30s-I-…174804-1`, `…175358-1`) the
client had queued SDP at +7 s into a socket that was blackholed. TCP delivered it about 26 s
after restore (about +56 s), after the session had been claimed on a new socket, and Janus
applied it: the stale publisher offer restarted ICE with out-of-date credentials, the
publisher connection dropped at about +62 s, and observers had about 5 s of stale media
until a third restart. That outage would have been recorded as Janus behaviour when the
client caused it. It is the third time in this study that the harness produced the result
(after the ladder collision, F5, and the subscriber-offer deadlock above). Reacting to the
stale answer would act after the damage; leaving it would publish an artifact as a finding.

**Why 2 s.**
- A healthy ack takes a few milliseconds here (client and SFU in one AZ).
- The only benign reason for a slow ack is packet loss, recovered by TCP retransmission at
  about 0.2, 0.6 and 1.4 s after the first send (Linux minimum RTO 200 ms, doubling). 2 s
  therefore tolerates three consecutive losses on a live path. 1 s would tolerate only two,
  so ordinary loss could be misread as a dead socket.
- 5 s would not tolerate a meaningfully larger class of live sockets (the next
  retransmission is at 3.0 s, then 6.2 s) and delays every recovery from a real outage by
  3 s more.
- The errors are asymmetric. A false "dead" costs one claim on a new connection, same
  session, which succeeds at once if the path is up. A false "alive" queues SDP into a dead
  socket, which is the defect. So the timeout should lean short.
- It equals P3's 2 s media-dead threshold, so the client uses one notion of "too long".

**What the probe does not cover.** Keepalives already queued on the old socket are still
delivered late; they carry no SDP and are harmless. A socket that dies between the ack and
the SDP send is not covered.

**Consequence for the cells.** With P9, every full-isolation transport restart goes through
the claim path (new connection, re-subscribe), **including the full 10 s cells**, which used
to recover on the old socket when TCP retransmitted. Those cells now measure the claim path,
and their recovery time includes the new connection's SYN retry schedule (1, 3, 7 s after
the first attempt). Janus full-isolation results from before this change (shakedown, and
both 2026-10-01 confirmation runs) are not comparable in timing. Media-only cells keep the
signalling socket, pass the probe, and stay on the live-socket path. The new baseline is in
`confirm3/`.

R1 is still "same session id". Subscriber handle ids may change inside an R1 recovery.

**Timing dependency: TCP backoff on the old socket.** During a full isolation both ends of
the signalling TCP connection back off their retransmissions exponentially. After restore,
each direction resumes only at its own next retransmission. In the trial above the
client→server direction resumed at +31.0 s, and the server→client direction not until about
+57.5 s (restore was at +30.08 s). In the two other trials it resumed at +30.7 and +30.9 s.
So with D = 30 s the old socket returns either within about 1 s of restore or roughly 27 s
later, depending on the phase of the server's retransmission timer. Consequences:
- "connectivity returned" (ladder v2), when judged on the old socket, can lag the restore
  by tens of seconds;
- rule 4 removes the dependency in practice: the first restart fails at detection + 5 s +
  15 s, the next one finds the socket silent for > 15 s and claims on a **new** connection,
  which has no backoff history.
- Comparability: rule 4 shortens a failed restart, so Janus full-isolation 30 s trials run
  before this change (shakedown and the 2026-10-01 confirmation) are not comparable in
  timing. Cells where signalling stays up (media-only) or returns quickly (10 s) are
  unaffected in regime.

### 1.2 Rebuild mechanics (P6, A5: abandon)

**Deliberate choice: abandon by DROPPING the connection** (confirmed 2026-09-29). The
alternative is to leave the old socket open and silent. Dropping it is the correct model of a
crashed or rebooted client, which is the event the study is about: its connections vanish, and
it says goodbye to nobody. Leaving the socket open and silent would model a hung client
instead. On Janus it would also stretch the old session's life from the reclaim window (DC-4)
to the 60 s `session_timeout`, a different server path. A reviewer will ask why; this is the
answer.

**Block-first abandonment (adopted 2026-10-01, Jay).** The targeted tests showed that closing
a PeerConnection locally leaks a goodbye: `pc.close()` sends a DTLS close_notify, and Janus
told observers S was `unpublished` 3–4 ms after the drop. A crashed client sends nothing.

So the old generation's media is **blackholed before it is closed**:
1. Read the old PeerConnections' local candidate ports (`getStats`).
2. Install `iptables` DROP rules for those UDP ports, both directions, in the subject pod.
3. Only then close the old PeerConnections. Their goodbye is dropped.
4. Remove the port rules ~1.5 s later, so a later connection can never inherit a blocked port.

**Scope: media ports only.** The signalling socket still closes with a normal TCP FIN. This
is the **crashed-process** model: the OS closes a dead process's TCP sockets, while its
media just stops. Blackholing signalling as well (a power-loss model) would move Janus from
the 25–30 s reclaim window to the 60 s `session_timeout`, a different server path that
collides with the 60 s give-up. It is deliberately not done.

The old session is abandoned, never closed gracefully:
- stop its keepalives;
- blackhole its PeerConnections' media ports (above);
- close its signalling socket (TCP FIN) **without** a leave or destroy message;
- close its PeerConnections locally; nothing they send reaches the server.

Then join again with the **same identity**.

- **LiveKit:** a fresh join with the same identity. The server is expected to evict the old
  sid (`DUPLICATE_IDENTITY`) if it is still present.
  - **Implementation note:** the SDK's `restartConnection` sends a Leave first when
    signalling is up. The rebuild bypasses it with a fresh join on a new engine. That is one
    more private-internals hook, attributed and checked like the others.
- **Janus:** a new session and handle, joining with the **same feed id**. It is expected to
  get **436** until the old session dies. The old session dies when its reclaim window
  expires (≤ 30 s from its last request, per DC-4) or when its session times out.
- A **healthy-session rebuild** (full reconnect while the session is fine) is a
  shakedown test in its own right (§5.2).

### 1.3 Delivered server termination

- A server DISCONNECT that is actually **delivered** is terminal for that session. This
  covers LiveKit `LeaveRequest{DISCONNECT}` and Janus `timeout`, `kicked`, or `destroyed`
  delivered on a live socket.
- The driver records it and goes **directly to rebuild (step 3)**, in both arms.
- LiveKit: the engine closes on DISCONNECT, so the rebuild must detect that from engine
  state (not `room.state`), create a new engine, and re-install every hook.

### 1.4 Observers

- Observers run the same client stack and the same P1/P2 values, and publish and subscribe
  like the subject.
- They are never isolated, and their ladder is disabled: they never act.
- **Any observer detection (P2 or P3) invalidates the trial** (§3.3).

---

### 1.5 Mirrored LiveKit client timings (P7), with source

These values are hard-coded in the LiveKit SDK. Unless the Janus client applies the same
values, they would appear as a server difference while actually being client behaviour. They
are deliberately mirrored.

| Parameter | Value | LiveKit source (livekit/client-sdk-js @ v2.22.3, `53dd8403`) | Janus client applies it to |
|---|---|---|---|
| Signalling connect timeout | 15,000 ms | `src/room/defaults.ts:52` (`websocketTimeout: 15_000`) | the WebSocket open for a new session, and for `claim` |
| PeerConnection connect timeout | 15,000 ms | `src/room/defaults.ts:51` (`peerConnectionTimeout: 15_000`); used in `waitForPCReconnected`, `src/room/RTCEngine.ts:1537-1548` | waiting for ICE `connected` after an ICE restart or republish |
| Minimum settle after a transport restart | 2,000 ms | `src/room/RTCEngine.ts:111` (`const minReconnectWait = 2 * 1000`); awaited unconditionally at `src/room/RTCEngine.ts:1542` inside `waitForPCReconnected` | a transport restart is declared complete no earlier than 2 s after it starts, even if ICE reconnects sooner |

Any SDK upgrade invalidates this table and the driven-SDK hooks. Re-audit both.

## 2. Media and participants

- **Audio only**, Opus (A7).
- **Deliberate choice: every participant publishes an audio clock** (confirmed 2026-09-29).
  This makes freshness measurable in **both directions**: the subject's media as the
  observers see it, and the observers' media as the subject sees it. **The observer's view is
  a primary result, not a secondary check.** What the rest of the call experiences while one
  participant recovers is half of the question.
- **Every participant publishes** an in-band chirp clock (the 2026-09-28 method) and
  subscribes to all others. This gives presented-media age for the subject's media at each
  observer, and for each observer's media at the subject.
- **Three participants (A8):** subject S (isolated), observers O1 and O2.
- All three are browser clients: headless Chromium, Playwright 1.62.1.
  - LiveKit: livekit-client **2.22.3** (driven).
  - Janus: raw WebSocket-API client plus `RTCPeerConnection`.

---

## 3. Trial protocol

### 3.1 Hard preconditions: any failure aborts the trial, and it is **not recorded**

Checked immediately before the trial, from the live cluster:

1. **Placement (DC-3a):**
   - the coturn node has no SFU and no client pod;
   - the SFU under test is on a node with **no client pod and no other SFU**;
   - the idle SFU deployment is at **0 replicas with 0 pods**;
   - all three client pods are on the third node;
   - every node in use is Ready.
2. **Pinned versions:** server image digests, SDK version, Playwright version.
3. **Server config:** Janus `server_info` shows reclaim 30 / session 60. LiveKit version is
   1.13.7.
4. **Clean state:** a fresh room name, no leftover participants (API check), no iptables DROP
   rules in the subject pod.
5. **Clock:** all client pods on one node (one clock). Server-log timestamps are related via
   a per-trial offset probe, recorded in `result.json` (`clock`). Built 2026-10-01:
   - **Event sink:** NTP-style probe from the subject pod to the sink's `/time`, best of 9 by
     round trip. Offset = sink clock − client clock; uncertainty = half the round trip.
   - **SFU:** computed from evidence the trial already produces, so the SFU needs no extra
     endpoint. LiveKit: the signalling pong (`pongResp.lastPingTimestamp`, `.timestamp`;
     1 ms resolution). Janus: the client's `create`/`attach` round trips matched to the
     event handler's own `created`/`attached` timestamps for the same ids.
   - **Dependency (Janus):** the Janus measurement needs the event handler's `created` /
     `attached` events, which arrive through the sink. A starved or incomplete sink therefore
     also loses the Janus clock measurement: on Janus the completeness check (§3.3) and the
     clock check are **not independent**, and one sink failure produces both invalidation
     reasons. This is correct behaviour. LiveKit's measurement comes from the signalling
     socket and does not depend on the sink.
   - **Bound: uncertainty ≤ 10 ms on each.** A missing measurement, or one above the bound,
     **invalidates the trial** (§3.3). The offset itself is not bounded; it is recorded and
     applied when a server timestamp is placed on the client timeline.
6. **Server-event channel:** the event sink for the stack under test answers `/head`.

An aborted trial produces no trial record and no data. The runner writes one line to an
**abort log**: timestamp, which precondition failed, and the observed placement. This is
operational only, so aborts are visible and countable (see §7, item 6).

### 3.2 Sequence

1. O1 and O2 join, then S joins. All publish and subscribe.
2. **Warm-up 15 s.** Record the baseline media age for each direction.
3. **Isolation onset**, timestamped as a before/after bracket.
4. **Hold** for duration D.
5. **Restore**, timestamped as a bracket.
6. **Observe** until the regime is classifiable and stable for 30 s, **capped at onset + 150 s**.
   Detection is at most ~16 s after onset, so give-up G ≤ onset + ~76 s; the cap leaves
   ≥ 70 s after G and ≥ 120 s after the latest restore (D = 30 s).
7. All leave; collect evidence.

### 3.3 Trial invalidation (recorded, marked invalid, excluded from analysis)

Distinct from aborts. These occur after the trial started:
- an attribution violation (an SDK reconnect or close not made by the driver);
- observer detection;
- an isolation rule failed to apply or remove (verified by `iptables -S` before and after);
- a runner error;
- evidence missing from a required channel;
- **the server-event channel is incomplete** (added 2026-10-01). The sink stores events
  itself, with a per-process boot id and a contiguous sequence number. The runner checks, at
  the end of the trial and not in later analysis:
  - the sink's boot id is unchanged across the trial;
  - the events fetched are exactly the sequence range between the trial's start and end;
  - the runner's own start and end markers are both in that range;
  - the range holds all three participants' join events for this trial's room.
  Self-test: `C4_STARVE_SINK=1` deletes the sink pod mid-trial; the trial must be marked
  invalid by this check;
- the clock-offset probe is missing or above its bound (§3.1.5).

---

## 4. Independent variables and grids

### 4.1 Isolation (A6)

- **Modes:**
  - **Full:** all traffic between S and the SFU pod IP.
  - **Media-only:** signalling untouched.
    - LiveKit: UDP plus ICE-TCP 31881.
    - Janus: UDP 32000–32199 (Janus has `ice_tcp` off).
- **Durations:** 5, 10, 20, 30 s.
  - 20 s straddles LiveKit's ~21 s removal.
  - 30 s straddles Janus's 25–30 s effective reclaim window.

### 4.2 Grids

- **Study grid:** 2 stacks × 2 arms (O, I) × 2 modes × 4 durations = **32 cells**.
  - Janus has no server recovery requests, so the O and I arms are **behaviourally
    identical** on Janus.
  - Janus is still run in both arms. The pair serves as an **arm-invariance control**: any
    O/I difference on Janus indicates a harness artefact.
  - Study n per cell is decided after the shakedown shows the variance (A9).
- **Shakedown grid (A9):** 2 stacks × 2 arms × 2 modes × {10 s, 30 s} = 16 cells × **3** =
  48 trials, plus §5.2.

---

### 4.3 Arms: O is kept, I is dropped (2026-10-02)

**Decision:** study trials run **arm O (obey server recovery requests)** only. Arm I is dropped.

**Evidence that the arms are identical:**
- Shakedown (ladder v1, 48 trials): same regime in both arms in every cell.
- Arm check on the current client (ladder v2, claim-path re-subscribe, P9; `arms/`, 24
  trials, 23 valid): every LiveKit cell twice per arm, every Janus cell once per arm.
  Regime, the driver's action sequence, and every layer's report kind are the same in both
  arms in every cell; timings differ only within run-to-run spread
  (`logs/arms/divergence.txt`).
- The only server request seen is LiveKit's `leave/RESUME` at 21.7–22.3 s in media-only 30 s
  trials, in both arms (4/4). It arrives while a transport restart that started at about
  21.5 s is already in flight, so obeying it changes nothing.
- Janus sends no recovery requests, so its arms cannot differ (arm-invariance control).
- One Janus trial (`janus-iso-media-10s-O`) was invalid (an observer detected a failure of
  its own connection) and is excluded; the pair is covered by the shakedown and by the
  other Janus cells.

**Why O is the one kept:** it is what a stock client does, so no result can be attributed to
our having disabled the server's own recovery hint. **Limit of the evidence:** identity was
shown at 10 s and 30 s only. If a study duration produces a server request while no restart
is in flight, arm O will act on it; that is recorded per trial (`serverRequests`).

### 4.4 Study matrix (approved 2026-10-02, Jay)

Arm O only (§4.3). n = valid trials per cell; an invalid trial is replaced, at most three
extra attempts per cell. Order is randomized within a stack and recorded
(`study/order-<stack>.jsonl`). One session per stack. Runner: `run.mjs study <stack>`.

| Stack, mode | Durations (s) | n |
|---|---|---|
| LiveKit, full | 2, 5, 10, 16, **19, 21, 23**, 26, 30 | 5; **10** at 19, 21, 23 |
| LiveKit, media-only | 2, 5, 10, 20, 23, **26, 28**, 30 | 5; **10** at 26, 28 |
| Janus, full | 2, 5, 10, 30, 45, 55, 65, 90 | 5 |
| Janus, media-only | 2, 5, 10, 30, 45 | 5 |

30 cells, 175 valid trials (LiveKit 110, Janus 65).

**What each group is for:**
- **2 and 5 s:** outages the client rides out without acting. Does any layer report a short
  outage at all? If none does below some duration, that is stated as such, not as a
  percentage.
- **10 s:** the transport-restart anchor.
- **LiveKit full 16–26 s:** brackets the removal at about 20–22 s, where membership reporting
  switches from silent to "left, then joined". n = 10 at 19, 21, 23 so the proportion is
  estimated where the finding lives.
- **LiveKit media-only 20–28 s:** brackets the resume request (about 22 s) and the removal
  (about 27 s). n = 10 at 26, 28.
- **30 s:** upper anchor on LiveKit; restart anchor on Janus.
- **Janus 45 s:** the longest outage inside the session timeout.
- **Janus full 55, 65, 90 s:** bracket Janus's 60 s session timeout, its expected reporting
  boundary. Reachable only with the 120 s give-up (below).

**Give-up raised from 60 s to 120 s (A3 changed, 2026-10-02).** The 60 s give-up equalled
Janus's 60 s `session_timeout`, so any outage longer than about 50 s ended "never recovers"
by our policy and Janus's reporting boundary was unreachable by construction: the ladder
collision (F5) a third time. Effects on earlier results:
- Trials that recovered before 60 s are unaffected: nothing in the ladder before give-up
  changed. That is every valid trial in the confirmation and arm-check runs, and all
  shakedown cells except the next item.
- The shakedown's Janus full 30 s "never recovers" trials (6/6) gave up at 60 s; they were
  already superseded by ladder v2 (§1.1a).
- §3.2's observation cap becomes onset + max(160, D + 80) s.

**Participant-state polling (layer `A_state`, §5.6).** An observer pod polls
`ListParticipants` (LiveKit) or `listparticipants` (Janus) every 1 s from before warm-up to
just before teardown. Fewer than 20 samples, or a gap above 3 s, invalidates the trial.

### 4.5 Study run 1 outcome, and run 2 (2026-10-02)

**Run 1** (`study/`): 175/175 valid. Tables: `logs/study/table-all.txt`.

**A prediction that was wrong, recorded as such.** Before the run, the expectation was that
below some duration nothing would report the outage in any layer. That is false on LiveKit:
its `connectionQuality` signal for S fired in **110/110** trials, including every 2 s and 5 s
trial. It arrives 8–14 s after onset, so after a short outage has already ended, and at 2 s
and 5 s it says `GOOD` or `POOR`, not `LOST`. **The accurate statement, and the one for the
write-up: nothing reports a short outage while it is happening.** On Janus the media event
caught 3/5 of the 2 s outages per mode while they were happening, and every outage of 5 s
and above.

**Defect found in run 1: a deferred server request was dropped (arm O).** In LiveKit
media-only trials the server's `leave/RESUME` arrives at about 22.1 s, while a transport
restart is in flight. The driver could not start a second action, and did not act on the
request once the first ended. At D = 23 s the network was back at 23.1 s; the driver then
waited its 5 s retry spacing and retried at 28.6 s, 1.5 s after LiveKit had removed S
(27.1 s). The rebuild would have been attributed to LiveKit's boundary when our ladder
caused it: the fourth instance of the harness producing the result (F5; the subscriber-offer
deadlock and the stale-SDP outage, §1.1b; and this).

**Fix (changes P5's implementation, not the arms):** a request that arrives during an action
is held, and honoured as soon as that action ends without success, without the retry
spacing. If the action succeeded, the request is logged as moot.

**Run 2** (`study-r2/`, fixed driver, arm O):
- **Re-run:** LiveKit media-only 23 s (n = 5), 26 s and 28 s (n = 10), 30 s (n = 5). The
  run 1 trials of these four cells are **superseded** for regime and timing; they are kept.
  30 s is included because the same dropped request occurred in it.
- **New boundary cells:** LiveKit full 17 and 18 s; media-only 21 and 22 s; n = 10 each. Run 1
  bracketed the switch only to 16–19 s (full) and 20–23 s (media-only).
- Unaffected: all full-isolation cells and media-only cells of 20 s and below (no server
  request occurred in them), and all Janus cells (Janus sends none).

**Run 2 outcome (2026-10-02, 70/70 valid; `logs/study/table-r2.txt`).**
- **LiveKit media-only 23, 26, 28, 30 s: transport restart 30/30, membership silent.** Run 1's
  rebuilds in these cells (30/30) were produced by the dropped request. With the request
  honoured (at about 23.6 s), LiveKit keeps the session. There is no media-only boundary on
  LiveKit up to 30 s.
- **LiveKit media-only 21, 22 s:** restart 20/20.
- **LiveKit full 17 s:** restart 9/10, rebuild 1/10. **18 s:** restart 10/10. With run 1's
  19 s (rebuild 10/10), the switch lies between 18 and 19 s.
- The citable dataset is run 1 minus its four superseded cells, plus run 2: 215 trials
  (`logs/study/divergence-final.json`, `WRITEUP-MATERIALS.md`).

**No build (decided 2026-10-02, Jay).** C4 is a measurement paper; see
`WRITEUP-MATERIALS.md` §7 for the surface review behind that decision.

## 5. Regime rubric

### 5.1 Definitions

- **Session identity (SI):** LiveKit participant `sid`; Janus `session_id` (and feed id).
- **Recovered at t_r:**
  1. **Fresh media from S at both observers:** presented age ≤ that observer's baseline
     + 250 ms, sustained 1 s. This is "fresh", not merely "packets resumed" (2026-09-28).
  2. **Fresh media at S from at least one observer:** same test.
  3. **S's signalling is live:** a reply within P2.

  `t_r` is the **first** instant all three hold and then continue to hold for 1 s.
- **Stale media presented:** any interval after restore where an observer presents S's media
  older than 1 s. Recorded with its duration, as a secondary outcome.

### 5.2 Client-experienced regime (primary classification; decided by driver evidence)

| Regime | Rule (evaluated at the end of the observation window) |
|---|---|
| **R0: Continues** | Recovered; **no ladder action** was taken; SI unchanged. |
| **R1: Transport restart** | Recovered; the **last successful action** was a transport restart (LiveKit resume accepted; Janus ICE restart, with or without `claim` success); SI unchanged. |
| **R2: Rebuild** | Recovered with a **new SI**, after a rebuild action (driver ladder or arm-O server RECONNECT). |
| **R3: Never recovers** | Not recovered by the end of the observation window. |

**Sub-labels, recorded, not separate regimes:**
- R1 trigger: driver ladder vs **server request** (arm O). R1 via `claim` vs ICE restart only
  (Janus).
- R2 path:
  - old SI **evicted** (`DUPLICATE_IDENTITY`);
  - old SI **already removed** (`CONNECTION_TIMEOUT`, Janus `timeout`/`destroyed`);
  - old SI **refused the newcomer** (Janus 436 count, and time until accepted).
- Refusals seen before the final outcome (LiveKit `RECONNECT/STATE_MISMATCH`, Janus 458), with
  times.
- **Flap:** recovered, then detection again within the window. Classified by the final
  state, flagged.

### 5.3 Server-reported view (secondary classification; F2)

From standard server surfaces only: LiveKit webhooks plus the RoomService state API; Janus
event handler.

| Label | Rule |
|---|---|
| **S-silent** | No removal, leave, or rejoin event for S |
| **S-removed** | Removal of S's SI reported, with no rejoin |
| **S-replaced** | Removal of the old SI plus arrival of a new SI for S's identity |
| **S-reattached** | Janus only: transport disconnected then connected with the session surviving (no `claim` event exists; inferred) |

**Reported alongside the client-experienced regime.** The cross-table (R × S-label) is a
primary result. For example, R1 on LiveKit is expected to be **S-silent**, per F2.

**Raw signalling frames are a separate channel.** They are not a "standard server surface":
- LiveKit: `ReconnectResponse`, `LeaveRequest`, `ParticipantUpdate`.
- Janus: the JSON replies.

They are used to establish the client-experienced regime and are reported as the
protocol-level view.

### 5.4 Other-participant view (from O1/O2 raw frames)

| Label | Rule |
|---|---|
| **O-nothing** | No membership change for S |
| **O-left** | S reported gone, with no return |
| **O-left+returned** | S reported gone, then a new S |

LiveKit: `DISCONNECTED` then a new sid. Janus: `leaving` then `joining`.

Also recorded: whether the reason was delivered, and whether O1 and O2 agree (disagreement is
an invalidation check).

### 5.5 Timing outcomes per trial

For each outcome the reference point is fixed:

| Metric | Measured from |
|---|---|
| `t_d` (detection) | onset |
| each ladder action and its result | onset |
| `t_r` (recovered) | **restore** (primary latency) and onset |
| server removal time | onset, per surface |
| observer-seen leave and return | onset |
| total stale-media time | none (a duration) |
| number of refused attempts | none (a count) |

---

### 5.6 The three-channel triple and its divergence (decided 2026-10-02, Jay)

**The study's claim is the observability one.** The regimes (§5.2) are its vehicle: for every
recovery event the trial records one defined value per channel, including an explicit
"reported nothing", and the divergence between channels is computed, not described.
Implemented in `client/runner/divergence.mjs`.

**Channel 3, observer experience, is the reference.** `truth.down` = S's media first stale
at an observer; `truth.up` = fresh again at both (§5.1); outage = `up − down`.

**Channels 1 and 2 are split into layers,** because a stack can be silent in one and not in
another:

| Layer | Channel | LiveKit | Janus |
|---|---|---|---|
| `A_membership` | 1: server standard surface | webhooks for identity S (`participant_*`, `track_*`) | event handler: VideoRoom plugin events for S's feed, session events |
| `A_media` | 1 | none exists | event handler: core media events (`receiving`) for S's publisher handle |
| `A_state` | 1 | `ListParticipants`, polled | `listparticipants`, polled |
| `B_obs_membership` | 2: raw protocol, to observers | participant `update` for S | `leaving` / `unpublished` / `kicked` / `publishers` for S's feed |
| `B_obs_quality` | 2, to observers | `connectionQuality` for S's sid | none exists |
| `B_subject` | 2, to S itself | `leave`, `reconnect`, `join` | `media`, `timeout` |

`A_state` is captured from 2026-10-02 (§4.4); no earlier trial has it.

**Encoding of each layer, per trial** (times in seconds after onset; the trial's own
end-of-trial leave is excluded):
- `kind`: what the first report was (`nothing` if none; "none exists" if the stack has no
  such signal).
- `down`: time of the first report that something is wrong with S.
- `up`: time of the first report after `down` that S is back.

**Divergence, computed per layer against channel 3:**
- `onsetDelay = down − truth.down`.
- `blindS` = stale time at observers before the layer had said anything
  (= the whole outage if `kind` is `nothing`); `blindFrac = blindS / outage`.
- `upError = up − truth.up`. Negative: reported back while observers still had stale media.
  Positive: still reported as degraded after media was fresh.

**"Underreported", operationally. A layer underreports a trial if any of these holds:**
1. **Silence:** `kind = nothing` although `truth.down` exists.
2. **Late:** `onsetDelay` > 2 s (P3, the client's own media-dead threshold).
3. **Wrong state:** the layer's state contradicts the reference, i.e. it says "back" while
   media is stale (`upError` < −1 s), says "degraded" after media is fresh (`upError` > +1 s),
   or reports a departure for a session that in fact continued.
4. **Wrong kind:** something is reported, but not the event that happened: for example a
   quality change when a recovery took place, or no recovery event at all (true of every
   layer for R1, on both stacks).

## 6. Shakedown additions (§4.2 grid plus these)

1. **Healthy-session rebuild** (the spike did not exercise it). With no isolation, the driver
   rebuilds at t = 20 s. 3 trials per stack. Expected:
   - LiveKit: `DUPLICATE_IDENTITY` eviction, new sid;
   - Janus: 436 until the old session's reclaim expires (≤ 30 s), then accepted.
2. **Rejoin after a delivered DISCONNECT** (not exercised). 3 trials per trigger:
   - LiveKit via `RoomService.RemoveParticipant`;
   - LiveKit via a same-identity join from a second connection;
   - Janus via a moderator `kick`.

   Expected: the terminal event is delivered, the driver goes straight to rebuild, and a new
   engine or session gets its hooks re-installed.
3. **Attribution self-test:** one trial per stack with a deliberately planted non-driver
   reconnect call. It must be caught and invalidate the trial. This proves the check works.
4. **Precondition self-test:** one run with the idle SFU left at 1 replica on the clients'
   node. It must **abort** with the placement reason and produce no trial record.

**Shakedown exit criteria:**
- every valid trial is classifiable by §5;
- 0 unexplained invalidations;
- both self-tests behave as specified;
- per-trial precondition checks pass or abort cleanly;
- clock offsets are within stated bounds.

---

## 7. Introduced in this spec: ALL EIGHT CONFIRMED by Jay, 2026-09-29

These fill gaps between the approved decisions. Each is a proposal.

1. **P7:** attempt timeouts mirror the SDK's (15 s WS, 15 s PC, **2 s settle**) on Janus, so
   LiveKit's hard-coded 2 s resume floor is not a stack difference.
2. **Ladder timings within A3:** retry spacing 5 s; escalate to rebuild at `t_d + 30 s`;
   one attempt in flight at a time.
3. **Abandon mechanics (§1.2):** close the old socket at TCP level without leave or destroy,
   and close PCs locally. The alternative is to keep the old socket open and silent, which
   delays Janus's reclaim expiry to the 60 s session timeout. I chose "close" because it
   matches what a crashed or rebooted client does.
4. **Delivered DISCONNECT goes straight to rebuild** in both arms (§1.3).
5. **Every participant publishes a chirp clock** (§2), so freshness is measured in both
   directions.
6. **Abort log:** aborted trials produce no trial record and no data, as you specified. The
   runner still writes one operational line per abort (reason and placement), so the number
   of aborts is visible. Say if you want no trace at all.
7. **Recovery thresholds (§5.1):** baseline + 250 ms, sustained 1 s. Stale threshold 1 s.
   Observation cap: onset + 150 s.
8. **Janus arms O/I** are run anyway, as an arm-invariance control (§4.2). That doubles the
   Janus trials. The alternative is to run Janus once and compare it with both LiveKit arms.
