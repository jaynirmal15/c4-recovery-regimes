# Proposed next step (2026-09-29), awaiting approval. Nothing here is built.

## Recommendation: two stages, the first small

**Stage A: freeze the policy and the regime rubric** (a spec, ~0.5 day, needs your decisions).

**Stage B: build the study client and run a shakedown** (~3–4 days of work).

The study client is the right next build, as you expected. I would put a short spec in
front of it, for two reasons:

1. **The client must emit exactly the signals the regime classification needs.** "Which
   regime occurred" is decided from specific evidence: sid continuity, `ReconnectResponse`
   vs `LeaveRequest`, Janus `claim` result, media age, server events. If the rubric is
   written after the client, the client gets rebuilt.
2. **Several policy values are research decisions, not implementation details.** A reviewer
   will ask why each was chosen, as with DC-4 and DC-6. They should be fixed and written
   down before any trial produces data.

## Stage A: decisions needed from you (my proposed defaults in brackets)

| # | Decision | Proposed default | Why it matters |
|---|---|---|---|
| A1 | Signal-liveness timeout, both stacks | **15 s** (LiveKit server's own value; the spike used 20 only to prove control) | When the client declares signalling dead |
| A2 | Media-dead detection | **ICE `disconnected`/`failed` or media age > 2 s** (in-band clock, 2026-09-28 method) | Same trigger on both stacks, owned by the driver, not SDK events |
| A3 | Action ladder and timings | **wait W=5 s → transport restart in-session → if refused or failed, rebuild → give up at G=60 s** | The core of the constant policy |
| A4 | Obey server "resume/reconnect" requests (F1) | **Arm 1: ignore (driver decides); Arm 2: obey immediately.** Or pick one | F1 shows the server makes the first move; this switch changes LiveKit's regime |
| A5 | Rebuild semantics | **"Abandon and rejoin under the same identity"**: the old session is not closed first | Decides whether we measure LiveKit's `DUPLICATE_IDENTITY` eviction and Janus's 436 refusal (server behaviour), or a graceful handover (client behaviour) |
| A6 | Isolation modes and durations | **Full and media-only; 5, 10, 20, 30 s** (brackets both servers' ~21 s and 25–30 s windows) | The independent variable |
| A7 | Media | **Audio only** (Opus, in-band chirp clock) | Video adds a keyframe dependency that confounds recovery timing (2026-09-28) |
| A8 | Participants | **Subject + 2 observers**, all same client stack | Your three-party design; observers held constant (feasibility §2) |
| A9 | Trials per cell for the shakedown | **3**; the study n is decided after the shakedown shows variance | Keeps the shakedown cheap |

The rubric itself: a table mapping each observable pattern to {continues, transport restart,
rebuild, never recovers}. It is kept separately for the server-reported and the
client-experienced view (F2). I draft it; you approve it.

## Stage B: what the study client is, and what it needs

**Components:**

1. **Policy driver**, stack-agnostic. A state machine with the Stage A parameters.
   - It owns the connection state; SDK state is never trusted (F2, spike caveat 2).
   - It logs every decision with its trigger.
2. **Two stack clients behind one interface:** `join`, `publish`, `subscribe`, `keepalive`,
   `transportRestart`, `reattachSignalling`, `rebuild`, `leave`, plus raw-frame capture.
   - **LiveKit:** the spike's driven livekit-client 2.22.3, productionised: hooks, attribution,
     frame capture.
   - **Janus:** a new raw WebSocket-API client, with keepalive 5 s (DC-6), `claim` (DC-4
     window), ICE restart (publisher offer and subscriber `restart:true`).
3. **Observers:** same clients, never isolated, never acting. They log raw frames (what the
   server told them) and presented-media age.
4. **Isolation controller:** iptables in the subject pod (DC-5) with modes full, media-only,
   and signalling-only. Onsets and ends are bracketed with timestamps.
5. **Trial runner:**
   - per-trial fresh room;
   - scales the idle SFU to 0 and **checks actual placement before each trial**, since the
     preferred rule proved unreliable (DC-3a);
   - collects server evidence (webhooks, Janus events, LiveKit debug log) and client
     evidence;
   - writes one record per trial;
   - aborts a trial on any attribution violation.

**Both paths the spike did not exercise are built in and tested in the shakedown:**

1. **Full reconnect while the session is still healthy.**
   - LiveKit's `restartConnection` sends a Leave first when signalling is up. Under A5
     ("abandon") the driver must *not* send it, so the rebuild action bypasses that and joins
     fresh. The server should then evict the old sid (`DUPLICATE_IDENTITY`).
   - Janus under A5 reuses the feed id and gets 436 until the old session dies.
   - Both are tested explicitly, with a healthy-session control.
2. **Rejoin after the server's disconnect is actually delivered.**
   - LiveKit: DISCONNECT passes through and closes the engine. The driver must detect that
     from engine state, not `room.state`, then `room.connect()` again and re-install hooks
     on the **new** engine.
   - In the spike the server closed signalling before its DISCONNECT, so it was never
     delivered. Shakedown triggers that do deliver it: `RoomService.RemoveParticipant`, and
     a same-identity join from a second connection.
   - Janus equivalent: a delivered `timeout` event (seen in gate one J3) and a moderator
     `kick`.

**Shakedown (the Stage B exit gate, no study data):**
- 3 trials per cell for a reduced grid: both stacks × {full, media-only} × {10 s, 30 s}.
- Plus the two paths above, and attribution-violation checks.
- Pass: every trial is classifiable by the rubric, 0 violations, placement verified each
  trial, clocks within stated bounds.

**Needs:**
- lab time: about 2–3 h of 3-node uptime for the shakedown, ≈ $1;
- no new AWS resources;
- the pinned versions as now.

**Estimate:**

| Stage / component | Estimate |
|---|---|
| **Stage A** (spec + rubric) | ~0.5 day, plus your review |
| Driver | 1–1.5 days |
| Janus client | ~1 day |
| LiveKit client productionised | ~0.5 day |
| Observers and isolation | ~0.5 day |
| Runner and records | ~1 day |
| Shakedown | ~0.5 day |
| **Stage B total** | **~4.5 days** |

**Main risk:** A5 "abandon" on LiveKit requires bypassing the SDK's leave-before-rejoin in
`restartConnection`. That is one more private-internals hook, and it needs its own
attribution check.
