# Stage B: the four targeted tests (2026-09-30 / 10-01). Report for Jay; stopped before the 48-trial shakedown

**Bottom line (run 4, 2026-10-01 02:10–03:07 UTC; every test on ONE code version): all four
tests pass.**

| Test | Run 4 result |
|---|---|
| 1. Rebuild while the session is healthy | LiveKit **3/3**, Janus **3/3** |
| 2. Rejoin after a delivered disconnect | LiveKit `RemoveParticipant` **3/3**, LiveKit same-identity intruder **3/3**, Janus `kick` **3/3** |
| 3. Planted rogue reconnect | **caught on both stacks** (LiveKit 2 violations, Janus 1); both trials INVALID with the violation cited |
| 4. Deliberately wrong placement | **aborted on both stacks**; trial dirs 7 → 7 and 17 → 17 (no record); one abort-log line each |

- **Harness failures in run 4: 0.**
- **The only non-ok line** is the F3 `DIFF`: a server behaviour that contradicts the
  source-based expectation, 3/3 again.
- **Runs 1–3 are kept as the record of what the tests caught**: four client bugs and one
  analyzer gap, all fixed. See "Bugs found" below.
- **Still open, for your decision:** how "abandon" drops the old connection (see "Decision
  needed"). Run 4 used the spec **as approved**.

### Run 4, per trial (t = seconds after the trigger; pod clocks)

| Stack | Test | # | Rebuild accepted | Fresh media back at both observers | Notes |
|---|---|---|---|---|---|
| Janus | healthy rebuild | 1 | +31.09 s, after 6× 436 | **+31.46 s** | old session reaped by the server at +30.47 s |
| Janus | healthy rebuild | 2 | +26.00 s, after 5× 436 | **+26.38 s** | old session reaped at +25.79 s |
| Janus | healthy rebuild | 3 | +31.10 s, after 6× 436 | **+31.47 s** | old session reaped at +29.81 s |
| Janus | kick | 1–3 | +0.00 s (0.16 s) | **+0.43 / +0.40 / +0.66 s** | `kicked` delivered; straight to rebuild |
| LiveKit | healthy rebuild | 1–3 | +0.00 s (0.39–0.40 s) | **+0.97 / +0.66 / +0.88 s** | old sid evicted `DUPLICATE_IDENTITY`; observers see only the sid change (F3) |
| LiveKit | RemoveParticipant | 1–3 | +0.00 s (0.40 s) | **+0.83 / +0.91 / +0.85 s** | `PARTICIPANT_REMOVED` delivered; straight to rebuild |
| LiveKit | intruder | 1–3 | 0.41 s | **+0.86 / +0.94 / +0.93 s** | `DUPLICATE_IDENTITY` delivered; the intruder is evicted in turn at +0.05–0.06 s |

Observers presented stale or no media from S for essentially the whole interval up to "fresh
again": 0.4–1.0 s on the fast paths, **26–31 s on the Janus healthy rebuild**.

**The Janus healthy-rebuild time is set by server config plus policy, not by the rebuild
itself:**
- the old session blocks its own feed id (436) until the 30 s reclaim window, counted from
  its last keepalive (DC-4), expires;
- recovery then waits for the next 5 s retry.

The reap times (25.8–30.5 s) match DC-6's predicted 25–30 s effective window. Hence 26 s vs
31 s, depending on keepalive phase.

Report files: `logs/stageb/run4-report.txt` (final), `run1-report.txt`, `run2-report.txt`.
Trials: `trials/` (run 4), `trials-run1/`, `trials-run2/`, `trials-run3/`. Abort lines:
`logs/aborts.log` (run 4), `logs/aborts-run{1,2,3}.log`.

## The harness self-tests (the two that make the 48 trials worth anything)

### Test 3: planted rogue reconnect. PASS, 4/4

A recovery call is made deliberately from outside the driver (spec §6.3). It must be caught,
and the trial must be invalidated.

| Run | Stack | Violations recorded | Trial | Result |
|---|---|---|---|---|
| 1 | LiveKit | 2 (`attemptReconnect`, `resumeConnection`) | INVALID, violation cited | caught |
| 1 | Janus | 1 (`iceRestartAll`) | INVALID, violation cited | caught |
| 2 | LiveKit | 2 | INVALID, violation cited | caught |
| 2 | Janus | 1 | INVALID, violation cited | caught |

The checker also caught **a real unattributed call in my own harness**: the end-of-trial
`leave()` was not driver-attributed (run 0, debug trial in `trials-debug/`). It was fixed
before run 1. So the checker has caught a genuine problem, not only planted ones.

### Test 4: deliberately wrong placement. PASS, 4/4, plus an unplanned live demonstration

The idle SFU is left at 1 replica. The trial must **abort** before running, with the placement
reason, write **no trial record**, and write **one** line to the abort log.

| Run | Stack under test | Abort reasons | Trial dirs before → after | Abort-log lines |
|---|---|---|---|---|
| 1 | Janus | idle replicas=1; idle pod present; SFU node shared | 18 → 18 | 1 |
| 2 | Janus | same three | 7 → 7 | 1 |
| 2 | LiveKit | idle Janus replicas=1; idle pod present; SFU node shared | 17 → 17 | 1 |

**Unplanned demonstration (run 3).** Run 2 ended with LiveKit active, and run 3's script began
with Janus trials without switching stacks first (my script error). **All 8 Janus trials
aborted on the precondition** ("idle SFU deployment c4-livekit/livekit-livekit-server has
replicas=1"). That produced 8 abort lines and zero records: the guard working against a
real operator mistake, not a staged one.

## The behavioural tests

### Test 1: full rebuild while the session is still healthy (abandon, rejoin same identity)

| Run | Stack | Result | Notes |
|---|---|---|---|
| 1 | LiveKit | 3/4 pass, 1 invalid | the invalid one was the Mac-sleep incident (below); a replacement was run |
| 1 | Janus | **0/3: driver bug #1** | see "Bugs found" |
| 2 | LiveKit | **3/3 pass** | |
| 2 | Janus | **3/3 pass** | after the driver fix |
| 3 (final code) | LiveKit | 1/1 pass | the rest of run 3 was stopped (battery) |

**Representative outcomes:**
- **LiveKit:**
  - rebuild completes in 0.39–0.40 s;
  - server evicts the old sid with `DUPLICATE_IDENTITY` (+0.05 s);
  - observers present fresh S media again at +0.66–0.81 s, after 640–805 ms with stale or
    no media.
  - **Observers never receive a DISCONNECTED for the old sid**, only the new sid ACTIVE
    (FINDINGS F3, 6/6). This contradicts the source-based vocabulary, so the report marks it
    `DIFF`, not `FAIL`.
- **Janus:**
  - **436** on every retry at 0, 5.2, 10.4, 15.6, 20.8, and 26.0 s;
  - the old session reaped by the server at **+26.5 s**: the 30 s reclaim window counted
    from its last keepalive, ~3.5 s before the drop (DC-4 confirmed);
  - the next retry accepted at +31.2 s;
  - observers fresh again at **+31.6 s**.
  - The ~4.7 s between the reap and the accepted retry is the ladder's 5 s retry spacing
    (policy), not the server.

### Test 2: rejoin after the server's disconnect is actually delivered

| Run | Trigger | Delivered? | Driver → rebuild? | New session? | Recovered? |
|---|---|---|---|---|---|
| 1, 2 | LiveKit `RemoveParticipant` | yes, `PARTICIPANT_REMOVED` at t=0 | yes, at +0.002 s | yes, +0.40 s | **NO in all 6 (runs 1 and 2): bug #4** |
| 1 | LiveKit same-identity intruder | yes, `DUPLICATE_IDENTITY` | yes, +0.001 s | yes, +0.43–0.46 s; intruder evicted in turn | **INVALID: harness bug #2** |
| 2 | LiveKit same-identity intruder | yes | yes | yes; intruder evicted at +0.06 s | **3/3 PASS** |
| 1, 2 | Janus moderator `kick` | yes, `kicked` | yes | yes, +0.17 s | **NO in all 6 (runs 1 and 2): bug #3** |

So the delivered-disconnect **mechanics work on both stacks**: delivery, immediate rebuild,
new session. But two of the three triggers **did not restore media at the observers** until
bugs #3 and #4 were fixed. Those fixes have not yet been exercised on the final code.

## Bugs found by the targeted tests (all fixed; all would have corrupted shakedown data)

| # | Bug | Effect | Fix |
|---|---|---|---|
| 1 | Driver declared "healthy" during a rebuild refused with 436: leftover media from the abandoned pipelines plus a live keepalive on the new, unjoined session | Driver ran transport restarts on an unjoined Janus session, corrupting the publisher handle (424, then 490 "Error setting ICE locally"), and **never recovered** | Health requires `isJoined()`; after an action, only media received after it counts; an unjoined session goes straight to rebuild |
| 2 | Runner treated the intruder's failed join as fatal | Intruder trials invalid. The behaviour under test had worked: S's immediate rebuild evicts the intruder before its PC connects | The intruder's join outcome is recorded, not fatal; eviction is checked from its raw frames |
| 3 | Janus observers ignored `kicked`: they only dropped subscriptions on `leaving`/`unpublished` | Observers never resubscribed to the re-joined S, so no media | `kicked` is treated as gone |
| 4 | livekit-client's own cleanup on a delivered DISCONNECT **stops the published local track**; S republished the stopped track | Observers attached S's new track and decoded **zero** samples | A **fresh chirp track per (re)publish**, from the same generator, on both stacks |

## Incident: lab left up ~20.6 h

- **What:** the Mac went into low-battery sleep at 2026-09-30 02:51Z mid-campaign and woke at
  23:26Z on AC. The lab stayed up at 3 nodes the whole time: ~$7 at list prices (credits).
- **Cause (mine):** the runner was not under `caffeinate`, and parking depended on the session
  staying alive.
- **Since then:**
  - every job runs under `caffeinate -i -s` and parks itself via a shell `trap` on exit;
  - a battery guard parks the lab below 20% on battery power.
- **Remaining gap:** total power loss. Only an AWS-side scheduled scale-down would cover that,
  and it would be a standing change in your account, so I have not made it.

## Decision needed: the "drop" model leaks a goodbye

Spec §1.2 abandons by closing the old socket and **closing PeerConnections locally**. On Janus,
observers saw S **`unpublished` 3–4 ms after the drop** in every healthy-rebuild trial: the
local `pc.close()` sends a DTLS close_notify, so the server knows instantly that the media
ended. A crashed client sends nothing.

**Proposed fix: blackhole, then close.** Before closing the old generation, install iptables
DROP rules in the subject pod for the old PeerConnections' local ports, which the page knows
from `getStats`. The goodbye is then never delivered. This is a spec change, so it is your
call.

## Analyzer gap found in run 4 (fixed before this report)

For intruder trials the analyzer took "the intruder's join completing" as the trigger. That
never happens, because S evicts the intruder first. So freshness went unmeasured, and the
trials were classified by actions alone.

- The trigger is now the moment S receives the DISCONNECT.
- The analyzer **refuses to assign a regime when freshness was not measured**.
- The numbers above are from the corrected analysis.

## Status
- **Lab:** the job parks itself at the end of run 4; verification is recorded in
  `logs/stageb/`.
- **Nothing committed.**
- **Ready for the 48-trial shakedown on your go**, with one decision outstanding: the
  drop-model change. If you adopt it, the rebuild tests (1 and 2) should be re-run once with
  it before the shakedown, because it changes what the server sees at the moment of abandon.
