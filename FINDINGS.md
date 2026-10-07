# C4 findings register

Results that stand as findings in their own right. Each entry has evidence, conditions,
and n. Not yet replicated unless stated.

## F1. LiveKit initiates recovery itself: "what the client does when asked" is part of the policy

**Observed** (spike 2026-09-29, T4, n=1): the subject's media was isolated at the network
layer while signalling stayed up. livekit-server v1.13.7, livekit-client 2.22.3 driven.

| t after media loss | Server action (raw frames / observer) |
|---|---|
| +15.5 s | Client PC `failed` (browser ICE) |
| **+16.45 s** | **Server sends `LeaveRequest{action=RESUME, reason=CONNECTION_TIMEOUT}` over the live signalling connection**, then closes the WebSocket |
| **~+21.4 s** | Server removes the participant: observers receive `ParticipantUpdate … DISCONNECTED(CONNECTION_TIMEOUT)` |

**Why it matters:**
- Recovery is not only client-initiated. The server makes the first move, and a
  client that obeys (the SDK default) would resume immediately.
- The recovery regime therefore depends on the client's response to a server request,
  not only on the client's own detection.
- Under DC-1 (Option A), **"obey server resume/reconnect requests" is a held-constant
  policy parameter** and must be stated in the method. Janus sends no equivalent request;
  it only emits `hangup`/`ice-failed` events.

**Evidence:** `spike/out/subject.json` (frames), `spike/out/decoded.txt`
(subject t=136.22, observer t=158.20), `SPIKE-REPORT.md`.

## F2. The server's refusal of a resume is visible only in raw frames: the observability gap is a finding

**Observed** (spike 2026-09-29, T2b, n=1): after a 25 s full isolation the server had removed
the subject. A driver-triggered resume (`reconnect=1&sid=…`) was answered during the
handshake with **`LeaveRequest{action=RECONNECT, reason=STATE_MISMATCH}`**.

**How each surface reported it:**

| Surface | What it showed |
|---|---|
| Raw signalling frames | **The refusal**: the `LeaveRequest` above, on the resume WebSocket |
| SDK `onLeave` callback | **Nothing.** A handshake-time leave does not reach it |
| SDK promise / events | `attemptReconnect` resolved **with no error**; only a console warning ("Received leave request while trying to (re)connect") |
| SDK `room.state` | Still `connected` after the server had removed the participant |
| Webhooks / state API (gate one) | No resume or refusal event exists |

**Why it matters:**
- The server's *decision* (permit or refuse a transport-level recovery) is not reported
  on any standard server surface, and the shipped SDK hides it too.
- Combined with gate one (a resume produces no webhook and no state change; a dead
  participant stays ACTIVE for ~21 s), this is the strongest evidence so far that
  **LiveKit's recovery regimes are not observable through its supported server or SDK
  APIs**. Classifying them requires protocol-level capture.
- This is a property of the system under study, not an inconvenience of the harness.

**Method consequence:** raw signalling frames are a first-class measurement channel on both
stacks, and the driver owns the connection state. SDK-reported state is recorded but not
trusted.

**Evidence:** `spike/out/decoded.txt` (subject t=103.70–103.71), `spike/out/subject.log`
(console warning), `SPIKE-REPORT.md`; gate one `vocabulary/livekit.md` §2–§3.

## F3. LiveKit: a fast same-identity rebuild is invisible to other participants as a departure

**Observed** (Stage B targeted tests, 2026-09-30/10-01; healthy-session rebuild, A5 "abandon and
rejoin under the same identity"; livekit-server v1.13.7, observers on driven livekit-client
2.22.3, raw frames decoded with @livekit/protocol 1.50.4). **6/6 trials** across runs 1–3.

| Surface | What it showed |
|---|---|
| Server webhooks | Old sid `participant_left` **`DUPLICATE_IDENTITY`** at ~+0.05 s; new sid `participant_joined` at ~+0.3 s |
| Observers' raw signalling (both O1 and O2) | **No `ParticipantUpdate` for the old sid at all.** Only `S/<new sid>: ACTIVE` at ~+0.38 s. No DISCONNECTED, no JOINING/JOINED step |
| Observers' media | S's audio absent or stale for **640–805 ms**, then fresh under the new sid |

**Why it matters:**
- The source-based vocabulary (`vocabulary/livekit-docs.md` §2.4) predicted that others
  receive the old sid as `DISCONNECTED(DUPLICATE_IDENTITY)`. On the running server they do
  not, when the replacement arrives quickly.
- To other participants, a rebuild under the same identity shows up only as a **change of
  sid**. "What other participants observe" therefore cannot be read from departure events
  alone. The rubric's O-labels (§5.4) must treat a sid change for the same identity as
  "left+returned".
- Also open: whether a slower replacement (old sid already gone) produces the DISCONNECTED
  update. The spike's CONNECTION_TIMEOUT case suggests yes.

**Evidence:** `trials-run2/livekit-healthy_rebuild-*`, `trials/livekit-healthy_rebuild-I-20261001T014709-1`
(`O1.json`/`O2.json` frames, `server-webhooks.log`), `logs/stageb/run2-report.txt`.

## F4. A successful in-session recovery is invisible on both stacks: the observability gap, fourth instance

**Observed** (Stage B shakedown, 2026-10-01, ladder v1, block-first abandonment). 30 trials
were classified R1 (transport restart within the session): LiveKit 12 (resume), Janus 18 (ICE
restart).

| View | Result |
|---|---|
| Server's standard surfaces (LiveKit webhooks + state API; Janus event handler join/leave events) | **Nothing**, in **28/28** trials with a complete server record |
| Other participants (observers' raw signalling) | **Nothing**: no membership change, **30/30** |
| What observers actually experienced | stale or no media from S for **10–38 s** (cell medians 9.7–38.5 s) |

**Excluded:** two of the 18 Janus R1 trials (`janus-iso-media-30s-I-…-12`,
`janus-iso-media-30s-O-…-24`) lost their server events to sink log rotation
(`SHAKEDOWN-REPORT.md`). Their server record is incomplete, so they are excluded from the
server-surface count (28, not 30). Their client and observer evidence is complete.

**This is the fourth independent instance of the same gap in this study:**
- **F1:** LiveKit itself initiates recovery ("please resume"), a decision that never appears
  on its server surfaces.
- **F2:** LiveKit's refusal of a resume is visible only in raw protocol frames; the SDK
  reports no error and still says "connected".
- **F3:** a fast same-identity rebuild on LiveKit gives other participants no departure
  event, only a changed session id.
- **F4:** on **both** stacks, a recovery that succeeds within the session is reported to
  nobody, while the rest of the call lives through tens of seconds of stale media.

**Why it matters.** Across two SFUs with different architectures, the recovery the system
performs and the disruption participants experience are both absent from the interfaces an
operator or an application would normally watch. **This observability gap may be the central
contribution of the study, more than the regime taxonomy itself.** The taxonomy is what makes
the gap measurable.

**Evidence:** `logs/stageb/shakedown-cells.txt`, `logs/stageb/shakedown-report.txt`,
`shakedown/` (per-trial `S.json`, `O1.json`, `O2.json`, server logs).

**Qualification (2026-10-02, from the divergence re-analysis; `logs/divergence-existing-agg.txt`).**
F4 as written is true of **membership and participant-state reporting** only. The first
analysis read join/leave events and membership frames and nothing else. Two other signals
exist and do report the outage, and F4 must not be quoted as "the server reports nothing":
- **Janus** emits core media events through the same event handler: `receiving=false` for
  S's publisher handle 1.0–2.8 s after observers' media first went stale, and
  `receiving=true` at recovery, in **30/30** transport-restart trials with a complete record.
- **LiveKit** sends observers a `connectionQuality` update marking S `LOST`, 5.1–10.4 s after
  onset, in **14/14** transport-restart trials. It is on the raw protocol only; no webhook
  carries it.
What stays true: no surface on either stack reports that a recovery happened or that the
session survived one, and membership reporting is silent for every transport restart
(44/44 across shakedown and confirmation runs). The gap is therefore **layered, not total**,
and the study measures it per layer (`STAGE-A-SPEC.md` §5.6).

## F5. Design rule: a rebuild-escalating policy cannot recover from a 30 s Janus outage unless its give-up exceeds the server's reclaim window

**Observed** (Stage B shakedown, 2026-10-01, ladder v1): all **6/6** Janus full-isolation 30 s
trials ended "never recovers". The cause is a timing collision between the client policy and
the server configuration, not an inability of Janus to recover.

**Traced timeline** (`shakedown/janus-iso-all-30s-I-20261001T060029-2`; t = seconds after
isolation onset; driver events from the subject's log, server events from Janus's event
handler):

| t | Event |
|---|---|
| +1.92 | driver detects the loss (`t_d`) |
| +7.12 | first transport restart begins (blocked by the isolation) |
| +30.07 | network restored |
| +30.58 | first transport restart ends, failed |
| **+31.92** | `t_d + 30 s`: ladder v1 **escalates to rebuild** and abandons the old session |
| +32.03 | new session created; rebuild join refused **436** (old feed id still present) |
| +37.1, +42.3, +47.5, +52.7, +57.9 | rebuild refused 436, five more times |
| **+61.93** | `t_d + 60 s`: driver **gives up** |
| **+62.35** | server reaps the old session (`session timeout`), 30 s after the abandon |

The feed id became free **0.42 s after the driver had given up**.

**The rule.**
- On Janus, a rebuild under the same feed id cannot be accepted until the abandoned session
  is reaped.
- With `reclaim_session_timeout = R`, that is up to R after the abandon.
- So a policy that escalates to rebuild at time E after detection cannot recover before
  **E + R**, and **never recovers if its give-up G ≤ E + R**. Here E = 30 s, R = 30 s,
  G = 60 s.
- The same policy recovers on LiveKit, because LiveKit evicts the old session on rejoin
  (`DUPLICATE_IDENTITY`) instead of refusing the newcomer.

**Why it matters.**
- "Never recovers" here measured our ladder against Janus's reclaim window, not Janus.
- Any client that escalates to rebuild on a fixed timer will hit the same wall on a server
  that refuses duplicate identities for a reclaim period. Its give-up must exceed that
  period, or it must retry the still-alive session before abandoning it.
- In this trial the old session was alive at +30.07 s, and one more transport restart would
  very likely have succeeded.

**Consequence for the study.** Ladder v2 (STAGE-A-SPEC §1.1a) retries the transport restart
after connectivity returns, before escalating. The six v1 trials are not comparable with v2
results and are not pooled with them.

**Evidence:** `shakedown/janus-iso-all-30s-*` (6 trials), `logs/stageb/shakedown-report.txt`,
`SHAKEDOWN-REPORT.md`.
