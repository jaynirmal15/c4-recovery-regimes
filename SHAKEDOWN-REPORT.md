# Stage B shakedown report (2026-10-01)

Sequence run: block-first abandonment adopted → tests 1 and 2 re-run to confirm → isolation
smoke → gate → 48-trial shakedown. Lab parked at the end (verified). Nothing committed.

## Verdict

**The harness works. The shakedown ran clean and every trial is classifiable. It also found
three things that must be fixed or decided before the study, which is its purpose.**

| | Result |
|---|---|
| Tests 1 and 2 with block-first (run 5) | **15/15 pass**, gate exit 0 |
| Isolation smoke (both stacks, both modes, both arms) | 4/4 pass after two fixes (see "Caught before the shakedown") |
| Shakedown | **48/48 ran; 48/48 classifiable by the rubric; 0 aborts; 0 attribution violations; 0 observer detections; gate exit 0** |
| Isolation durations | exact: 10.0 s and 30.0 s (pod-timed) |
| Placement precondition | passed before every one of the 67 trials (15 + 4 + 48) |

**Not clean:**
1. **4 of 48 shakedown trials (all Janus) and 1 of 15 confirmation trials have an incomplete
   server-event capture.** Per spec §3.3 that invalidates them, and my runner did not detect
   it.
2. **Every Janus 30 s full isolation "never recovers" (6/6), by a 0.4 s margin.** The cause is
   a collision between the approved ladder timings and the Janus reclaim window, not Janus.
3. **One exit criterion is unmet:** the per-trial clock-offset probe between client and server
   nodes (spec §3.1.5) was never implemented.

## Block-first abandonment: confirmed (run 5)

| Test | Stack | Pass | Fresh media back at both observers |
|---|---|---|---|
| Healthy rebuild | LiveKit | 3/3 | +0.74 / +0.82 / +0.92 s |
| Healthy rebuild | Janus | 3/3 | +31.5 / +32.2 / +31.6 s |
| RemoveParticipant | LiveKit | 3/3 | +0.55 / +0.57 / +0.64 s |
| Same-identity intruder | LiveKit | 3/3 | +0.58 / +0.62 / +0.67 s |
| Moderator kick | Janus | 3/3 | +0.47 / +0.48 / +0.70 s |

**The goodbye no longer leaks.** On the Janus healthy rebuild, observers' first notice about S
moved from **+0.003 s** (run 4, `unpublished`) to **+30.6–30.8 s**, when the server reaps the
old session. Installing the port rules adds about 65 ms to an abandon.

**Scope as implemented:** media ports are blackholed; the signalling socket still closes with
a TCP FIN (crashed-process model; `STAGE-A-SPEC.md` §1.2).

## Shakedown results by cell (n = 3 each)

"Fresh from restore" = time from the end of isolation until both observers present fresh
media from S again (rubric §5.1). "Stale at observers" = total time observers presented stale
or no media from S.

| Stack | Mode | D | Arm I | Arm O | Fresh from restore (s) | Stale at observers (median) | Server surface | Observers |
|---|---|---|---|---|---|---|---|---|
| LiveKit | full | 10 s | R1 ×3 | R1 ×3 | 4.0–12.6 | 12.7–15.2 s | silent | nothing |
| LiveKit | full | 30 s | R2 ×3 | R2 ×3 | 3.9–4.6 | ~34 s | replaced | left + returned |
| LiveKit | media | 10 s | R1 ×3 | R1 ×3 | 5.3–13.1 | ~19.5 s | silent | nothing |
| LiveKit | media | 30 s | R2 ×3 | R2 ×3 | 0.4–1.6 | ~31 s | replaced | left + returned |
| Janus | full | 10 s | R1 ×3 | R1 ×3 | **0.0–0.3** | ~10 s | silent | nothing |
| Janus | full | 30 s | **R3 ×3** | **R3 ×3** | never | whole window (~152 s) | removed | left |
| Janus | media | 10 s | R1 ×3 | R1 ×3 | 0.1–13.5 (bimodal) | 9.7–18.4 s | silent | nothing |
| Janus | media | 30 s | R1 ×3 | R1 ×3 | 10.9–13.1 | ~38.5 s | silent | nothing |

R1 = transport restart within the session; R2 = rebuild (new session); R3 = never recovers.
Detection was 1.9–2.2 s after onset in all trials but one (0.3 s).
Full table: `logs/stageb/shakedown-cells.txt`; per trial: `logs/stageb/shakedown-report.txt`.

### What the cells show (shakedown-level, n = 3; not study conclusions)

1. **The stacks diverge at 30 s, in opposite directions by mode.**
   - LiveKit removes the participant at ~21 s and refuses the resume
     (`RECONNECT/STATE_MISMATCH`, raw frames only: F2). The rebuild then succeeds
     immediately, because LiveKit evicts the old session.
   - Janus keeps the session through a 30 s **media-only** isolation and accepts an ICE restart
     (R1, same session).
   - Janus fails to recover from a 30 s **full** isolation under this policy (see below).
2. **A transport restart is invisible on both stacks' standard server surfaces and to other
   participants.** Every R1 trial is `S-silent / O-nothing`. Only rebuilds and removals are
   visible. This generalises F2 beyond LiveKit.
3. **"Packets resumed" would badly understate recovery.** After a 10 s isolation, S's own
   connection was healthy ~1.5 s after restore, while observers kept presenting stale audio
   from S for 4–13 s more (LiveKit, and some Janus media-only trials). Janus full-10 s
   trials were fresh within 0.3 s. That gap, and its bimodality on Janus, is the fresh-media
   effect from the 2026-09-28 feasibility work. It is the outcome measure doing its job.
4. **Arm O vs arm I made no difference to the regime in any cell.**
   - LiveKit's "please resume" request was seen in 6 trials (media-only 30 s, at ~22 s). By
     then the server was about to remove the participant, and the resume was refused either
     way.
   - Janus arms were identical, as expected: the arm-invariance control passes.

## The Janus 30 s full-isolation result: policy × config collision (decision needed)

Traced on `janus-iso-all-30s-I-…-2` (pod and server clocks):

| t after onset | Event |
|---|---|
| +1.9 s | driver detects |
| +7.1 → +30.6 s | first transport restart, blocked by the isolation, fails |
| +30.07 s | network restored |
| **+31.9 s** | detection + 30 s: **ladder escalates to rebuild**, abandons the old session |
| +32.0 → +57.9 s | rebuild refused **436** six times (old feed id still present) |
| **+61.93 s** | detection + 60 s: **driver gives up** |
| **+62.35 s** | server reaps the old session (30 s reclaim window from the abandon) |

- The feed id became free **0.42 s after** the driver gave up.
- This is structural. On Janus, a rebuild under the same feed id (A5) cannot be accepted
  earlier than escalation (≥ 30 s) + reclaim (30 s, DC-4), which is ≥ the 60 s give-up (A3).
- Note also: one more transport restart right after restore would very likely have worked,
  because the old session was still alive. The ladder escalated 1.8 s after restore instead.

**This "never recovers" is produced by the timings we chose, not by Janus.** Options, yours to
pick:
- **(a) Raise the give-up** (e.g. to 90 s), so a rebuild can complete.
- **(b) Retry the transport restart once after connectivity returns** before escalating.
- **(c) Keep the timings** and report it as what this policy does on this config: a legitimate
  Option A result, but the write-up must explain the arithmetic.
- **(d) Change an input:** a shorter reclaim window, or a new feed id on rebuild. The latter
  weakens "same identity".

## Caught before the shakedown (by the smoke trials)

| Problem | Effect | Fix |
|---|---|---|
| Isolation timed from the Mac through `kubectl exec` | a "10 s" isolation lasted **11.61 s**; a nominal 20 s would cross LiveKit's ~21 s threshold | the **pod** applies, holds, and restores on its own timer; the check is now ±0.25 s; observed 10.00 / 30.00 / 30.01 s |
| Server/observer labels counted the end-of-trial leave | an R1 trial was labelled "removed / left" | labels cover onset → teardown only |
| Gate checks failed on run 4 data (pre block-first) | none; this shows the new checks have teeth | none needed |

## Defects found by the shakedown (to fix before the study)

1. **Server-event capture loses data.** In 5 trials the event sink's log holds only teardown
   events.
   - Likely cause: container log rotation. The sink logs every POST verbosely, and Janus posts
     media stats every 5 s per connection.
   - Affected trials: `janus-iso-all-30s-I-…-18`, `janus-iso-all-30s-O-…-6`,
     `janus-iso-media-30s-I-…-12`, `janus-iso-media-30s-O-…-24`, and one run-5 trial.
   - Client evidence is complete in all of them, so the regimes stand. Their server-surface
     labels are not trustworthy; that is why one cell shows `S-silent/S-removed`.
   - Needed: a sink that persists events itself (file or queryable store), and a per-trial
     completeness check that invalidates the trial.
2. **No client↔server clock-offset probe** (spec §3.1.5).
   - Client pods share one node (verified per trial), so client-side timings are sound.
   - Server-side timestamps come from other nodes and are compared without a measured offset
     (expected to be small on EC2 time sync, but unmeasured).
   - Regime classification does not depend on it. Any latency that mixes client and server
     clocks does.
3. **The runner checks the server channel for presence, not completeness** (same root as 1).

## Operational notes
- The first job was stopped before its gate, by hard kill, to keep the lab up while I fixed
  the isolation timing. A replacement job ran smoke → gate → shakedown and parked itself.
- All jobs ran under `caffeinate`, with a self-park trap and a battery guard, on AC.
- **Lab:** PARKED. `make park` verified (1022 s). Independently: desired 0, ASG 0 instances,
  0 running EC2, 0 k8s nodes (`logs/stageb/parked-evidence.txt`).
- **Cost:** up 03:55–07:20 UTC, about 3.4 h × ~$0.35 ≈ $1.20. Parked at ~$3.20/day.

## Files
- **Reports:** `logs/stageb/run5-report.txt`, `smoke-report.txt`, `shakedown-report.txt`,
  `shakedown-cells.txt`.
- **Data:** `trials-run5/` (15), `shakedown-smoke/` (4), `shakedown/` (48),
  `shakedown-smoke-v1/` (pre-fix smokes).
- **Code:** `client/www/`, `client/pod/control.mjs`, `client/runner/{run,analyze,report,cells}.mjs`.
