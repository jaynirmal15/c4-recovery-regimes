> **SUPERSEDED (2026-10-06). Do not draft from this file.** The source of truth is
> `CLAIM-REVIEW-PACKET.md` (version 3). This file predates three external reviews and still
> carries wording they corrected, including "9–14 s early" and "declares recovery" for the
> Janus media event, the unmeasured "4 s" buffer claim, and counts that were later fixed.
> It is kept only as a record of the state on 2026-10-02.

# C4 write-up materials (2026-10-02)

C4 is a **measurement paper**. No build (decided 2026-10-02): Janus already reports the
outage on its standard surface, and LiveKit's discarded analytics event plus its named log
line make the LiveKit gap a wiring job, not a design limitation. Nothing here is committed.

## 1. The claim the data supports

A participant's session can be disrupted for tens of seconds and recover, and the
**membership and participant-state surfaces of both SFUs report nothing**, as long as the
session id survives. What each stack does report, on which layer, how late, and how wrongly
is measured per layer against what the other participants actually experienced.

Not supported, and not to be written:
- "The server reports nothing." Janus reports media stop/resume on its event handler;
  LiveKit sends a quality signal to clients and logs resumes by name (§6, §7).
- "The servers know and the surfaces cannot express it." True for LiveKit's webhooks and
  API; false for Janus (§6).
- "Below some duration nothing reports the outage." False: LiveKit's quality signal fired in
  every trial. Correct form: **nothing reports a short outage while it is happening** (§4).

## 2. Citable dataset

**215 valid trials, 34 cells, arm O, ladder v2, give-up 120 s, 1 s state polling.**
`logs/study/divergence-final.json`; table `logs/study/table-final.md`.

| Source | Trials | Use |
|---|---|---|
| `study/` run 1 | 175 valid of 175 | 145 kept |
| `study/` run 1, LiveKit media-only 23, 26, 28, 30 s | 30 | **superseded** (dropped-request defect, §5 item 4); kept on disk, not cited |
| `study-r2/` run 2 | 70 valid of 70 | all kept: 4 new boundary cells, 4 re-run cells |

No aborts and no invalid trials in either run. Not study data: `shakedown/`, `confirm*/`,
`arms/`, `validate/` (earlier client versions; used for development and for §8's
out-of-sample check only).

Lab: LiveKit v1.13.7, Janus 1.4.1, three c7g.large nodes, one stack at a time. Three
participants; S is isolated at the network layer for D seconds (full: all traffic to the
SFU; media-only: media ports only), then restored.

## 3. Results by cell

Regime: R0 rides out, R1 transport restart in the same session, R2 rebuild (new session).
"Membership reported" = webhooks / plugin events; the state API and the frames sent to
observers agree with it in every cell. "Unreported share" = fraction of the outage that had
passed before the first membership report (1.00 = never reported). "Media/quality signal" =
Janus media event (standard surface) or LiveKit `connectionQuality` (raw protocol only).
Recovery error: negative = reported back before observers had fresh media.

| Stack | Mode | D (s) | n | Regime | Outage (s) | Membership reported | at (s) | unreported share | Media/quality signal | onset delay (s) | recovery error (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Janus | full | 2 | 5 | R0×5 | 1.5–2.2 | 0/5 | – | 1.00 | 3/5 | 1.0–1.7 | -0.1–-0.0 |
| Janus | full | 5 | 5 | R0×4 R1×1 | 4.6–5.1 | 0/5 | – | 1.00 | 5/5 | 1.4–2.2 | -0.1 |
| Janus | full | 10 | 5 | R1×5 | 9.7–10.2 | 0/5 | – | 1.00 | 5/5 | 0.9–1.9 | -0.1–-0.0 |
| Janus | full | 30 | 5 | R1×5 | 30.0–30.7 | 0/5 | – | 1.00 | 5/5 | 1.1–2.6 | -0.2–-0.0 |
| Janus | full | 45 | 5 | R1×5 | 49.0–49.7 | 0/5 | – | 1.00 | 5/5 | 1.3–1.9 | -0.1 |
| Janus | full | 55 | 5 | R1×5 | 56.3–56.7 | 0/5 | – | 1.00 | 5/5 | 1.2–1.8 | -0.1 |
| Janus | full | 65 | 5 | R2×5 | 69.7–70.9 | 5/5 | 59.8–60.8 | 0.85–0.87 | 5/5 | 1.3–2.8 | -0.8–-0.2 |
| Janus | full | 90 | 5 | R2×5 | 91.0–91.7 | 5/5 | 60.0–61.0 | 0.66 | 5/5 | 1.2–2.6 | -0.5–-0.2 |
| Janus | media-only | 2 | 5 | R0×5 | 1.5–2.1 | 0/5 | – | 1.00 | 3/5 | 1.1–1.6 | -0.1 |
| Janus | media-only | 5 | 5 | R0×5 | 4.6–5.2 | 0/5 | – | 1.00 | 5/5 | 1.1–2.1 | -0.2–-0.1 |
| Janus | media-only | 10 | 5 | R1×5 | 18.7–23.8 | 0/5 | – | 1.00 | 5/5 | 1.4–2.2 | -13.7–-9.0 |
| Janus | media-only | 30 | 5 | R1×5 | 40.9–42.8 | 0/5 | – | 1.00 | 5/5 | 1.0–2.6 | -12.7–-10.9 |
| Janus | media-only | 45 | 5 | R1×5 | 48.0–49.4 | 0/5 | – | 1.00 | 5/5 | 1.4–2.3 | -2.5–-0.9 |
| LiveKit | full | 2 | 5 | R1×5 | 7.3–7.9 | 0/5 | – | 1.00 | 5/5 | 9.2–9.9 | 16.3–27.2 |
| LiveKit | full | 5 | 5 | R1×5 | 7.6–14.5 | 0/5 | – | 1.00 | 5/5 | 9.1–9.8 | 10.3–16.9 |
| LiveKit | full | 10 | 5 | R1×5 | 12.9–18.3 | 0/5 | – | 1.00 | 5/5 | 8.6–9.5 | 10.3–16.5 |
| LiveKit | full | 16 | 5 | R1×5 | 21.1–22.2 | 0/5 | – | 1.00 | 5/5 | 9.5–10.1 | 12.8–17.4 |
| LiveKit | full | 17 | 10 | R1×9 R2×1 | 21.2–26.0 | 1/10 | 20.9 | 0.79 | 10/10 | 5.3–10.5 | -0.3–17.9 |
| LiveKit | full | 18 | 10 | R1×10 | 21.3–22.4 | 0/10 | – | 1.00 | 10/10 | 5.3–11.2 | 13.0–19.2 |
| LiveKit | full | 19 | 10 | R2×10 | 26.2–28.6 | 10/10 | 20.0–20.9 | 0.70–0.80 | 10/10 | 9.1–10.3 | -0.5–-0.1 |
| LiveKit | full | 21 | 10 | R2×10 | 27.4–28.5 | 10/10 | 20.4–21.8 | 0.72–0.78 | 10/10 | 7.9–10.3 | -0.5–-0.1 |
| LiveKit | full | 23 | 10 | R2×10 | 27.4–28.5 | 10/10 | 20.1–21.8 | 0.70–0.77 | 10/10 | 8.2–10.3 | -0.5–-0.1 |
| LiveKit | full | 26 | 5 | R2×5 | 27.6–28.4 | 5/5 | 20.1–20.8 | 0.72–0.74 | 5/5 | 9.4–10.2 | -0.5–-0.1 |
| LiveKit | full | 30 | 5 | R2×5 | 33.5–33.9 | 5/5 | 20.4–21.8 | 0.59–0.64 | 5/5 | 8.8–10.3 | -0.4–-0.1 |
| LiveKit | media-only | 2 | 5 | R1×5 | 6.1–8.0 | 0/5 | – | 1.00 | 5/5 | 9.0–10.1 | 12.1–22.1 |
| LiveKit | media-only | 5 | 5 | R1×5 | 8.1–14.0 | 0/5 | – | 1.00 | 5/5 | 8.8–14.4 | 6.7–21.3 |
| LiveKit | media-only | 10 | 5 | R1×5 | 20.6–22.8 | 0/5 | – | 1.00 | 5/5 | 9.1–10.2 | 6.9–8.9 |
| LiveKit | media-only | 20 | 5 | R1×5 | 23.9–33.4 | 0/5 | – | 1.00 | 5/5 | 8.6–10.1 | 6.0–14.7 |
| LiveKit | media-only | 21 | 10 | R1×10 | 23.9–33.9 | 0/10 | – | 1.00 | 10/10 | 5.6–10.2 | 6.6–14.1 |
| LiveKit | media-only | 22 | 10 | R1×10 | 26.2–36.5 | 0/10 | – | 1.00 | 10/10 | 5.1–10.5 | 7.3–17.5 |
| LiveKit | media-only | 23 | 5 | R1×5 | 26.8–29.6 | 0/5 | – | 1.00 | 5/5 | 9.7–10.4 | 10.2–13.3 |
| LiveKit | media-only | 26 | 10 | R1×10 | 31.9–42.1 | 0/10 | – | 1.00 | 10/10 | 5.1–10.6 | 3.3–11.8 |
| LiveKit | media-only | 28 | 10 | R1×10 | 34.2–42.9 | 0/10 | – | 1.00 | 10/10 | 8.4–12.6 | 5.5–13.1 |
| LiveKit | media-only | 30 | 5 | R1×5 | 31.4–42.4 | 0/5 | – | 1.00 | 5/5 | 8.9–10.3 | 7.4–18.2 |

## 4. Findings

1. **Membership reporting is categorical and tied to session identity.** Silent in 164/164
   trials where the session survived (LiveKit 109 R1; Janus 36 R1 + 19 R0); reported in
   51/51 rebuilds.
2. **Where it switches.**
   - LiveKit full isolation: between 18 s (R1 10/10) and 19 s (R2 10/10); 17 s is R1 9/10.
     The server removes S at 20.0–21.8 s. The boundary is joint: the SDK's single resume
     attempt does not complete in time even though the network returned at 19 s.
   - LiveKit media-only: **no switch up to 30 s** (R1 60/60, run 2). LiveKit asks the
     client to resume at about 22 s; a client that answers keeps its session.
   - Janus full isolation: between 55 s (R1 5/5) and 65 s (R2 5/5); the session times out at
     59.8–61.0 s.
   - Janus media-only: no switch up to 45 s.
3. **Stale time with nothing in the membership layer:** up to 56.7 s (Janus full 55 s) and
   42.9 s (LiveKit media-only 28 s).
4. **Rebuilds are reported, late.** 59–80% of the outage is over before LiveKit's first
   membership report; 66–87% on Janus. The "back" report is within about 1 s of the truth.
5. **Media and quality signals differ by stack.**
   - Janus media event: onset 0.9–2.8 s after media went stale in every cell of 5 s and
     above; 3/5 at 2 s. Recovery within 1 s for full isolation; **9–14 s early** for
     media-only 10 s and 30 s (it says "receiving" while observers still hear stale audio).
   - LiveKit quality signal: fired in 150/150, 5–14 s after onset, to clients only. In
     restarts it stays below "excellent" 3–27 s after media is fresh.
6. **Short outages.** Nothing reports a short outage while it is happening on LiveKit (2 s
   and 5 s: quality `GOOD`/`POOR`, 9–14 s after onset). Jay's prediction that nothing would
   report at all was wrong and is recorded as such (spec §4.5).
7. **A 2 s outage costs 5–8 s on LiveKit.** Observers' media stayed over 2 s old after the
   network returned, and the driver restarted a working connection (R1 20/20 at 2 s and
   5 s). Janus rode the same outages out (19/20). Whether the restart helped or hurt is not
   established.

Earlier findings F1–F5 are in `FINDINGS.md`; F4 carries its 2026-10-02 qualification.

## 5. Harness defects found and fixed: four instances of the harness producing the result

| # | Defect | What it would have been reported as | Fix |
|---|---|---|---|
| 1 | Give-up timer vs Janus reclaim window, 0.42 s apart (F5); later give-up 60 s = Janus session timeout | "Janus never recovers from 30 s" | ladder v2; give-up 120 s |
| 2 | Subscriber offer lost on claim; Janus then postpones restarts silently | "Janus does not recover inbound media" | re-subscribe on fresh handles (spec §1.1b) |
| 3 | SDP queued into a dead socket, applied about 26 s later | a second 5 s outage attributed to Janus | probe before SDP, P9 = 2 s |
| 4 | Server's resume request arriving mid-restart was dropped | **"LiveKit rebuilds media-only outages of 23 s and above"** (run 1, 30/30) | request held and honoured; run 2 shows R1 30/30 in those cells |

Item 4 reversed a result: the shakedown's and run 1's "LiveKit media-only 30 s is a
rebuild" was our ladder, not LiveKit. Worth a methods paragraph: each defect was found
because a result was traced to its timeline before being accepted.

## 6. Can the raw protocol classify what the membership layer misses?

`client/runner/classify-raw.mjs`, output `logs/study/rawclass-final.txt`, 215 trials.

| Evidence source, alone | LiveKit silent (109) | Janus silent (55) | LiveKit all (150) | Janus all (65) |
|---|---|---|---|---|
| Frames the server sent to S | 109/109 | 55/55 | 150/150 | 65/65 |
| Frames the server sent to observers | 0/109 | 55/55 | 41/150 | 65/65 |
| Server's standard event surface | 0/109 | 55/55 | 41/150 | 65/65 |

- LiveKit fields: `ReconnectResponse`, `JoinResponse`, `leave{action, reason}`.
- Janus fields: claim reply, `event{configured}` with an SDP answer, subscriber offers,
  error 458 and a create reply on rebuild; to observers `event{publishers}`.
- Limits: the server-to-S result is near-circular (labels come from the client's own
  actions); ride-outs are "correct" only by absence of frames; no LiveKit ride-out and no
  non-recovery trial exists; rules were written after seeing the data (35 other trials:
  same pattern, no misses); Janus `publishers` is a side effect of renegotiation.

## 7. What each stack already offers (source review, no experiment)

LiveKit v1.13.7 and main; Janus 1.4.1.

**LiveKit**
- Webhooks: 14 events, none for resume, ICE restart or reconnection
  (`protocol/webhook/consts.go:38-51`; emit sites `pkg/telemetry/events.go`). Config can
  only filter events out.
- API: `ListParticipants` / `GetParticipant`; `ParticipantInfo` has no connection or
  quality field and stays `ACTIVE` through an outage.
- Analytics: `PARTICIPANT_RESUMED` is built on every resume (`roommanager.go:389`,
  `telemetry/events.go:178`) and discarded in the open-source build
  (`analyticsservice.go:66-70, 88-91`). The hosted product was not checked.
- Metrics: aggregate only.
- Log: `resuming RTC session`, info level, with participant and reconnect reason. Present
  in 37/40 run 1 restart trials; the other three had truncated log captures.

**Janus**
- Event handler: nine types; session events are `created`, `destroyed`, `timeout`; no
  named recovery event; a `claim` emits no event (`janus_websockets.c:984` is empty).
  We ran with `events = "all"`.
- Media events (`receiving`), JSEP and ICE-state events are on the standard surface and
  suffice to tell that media stopped, resumed, and how.
- Admin API: `handle_info` (ICE state, `ice-restart` flag), by polling only.

Verdict: on Janus an operator can already tell; on LiveKit they can only from logs, and
then only that a resume happened, not when the outage began or whether media recovered.
Neither stack reports what the other participants experienced.

## 8. Limitations to state

- Audio only, three participants, one region, one browser engine (Chromium via Playwright),
  one client policy (Option A: policy held constant, server studied).
- Regime boundaries are joint client-server properties; with a different retry policy they
  move (§5 item 4 is the demonstration).
- n = 5 per cell (10 at eight LiveKit cells). No cell split except LiveKit full 17 s (9:1).
- "Fresh" is the in-band audio clock within 250 ms of baseline for 1 s; LiveKit recovery
  times include buffered-audio catch-up.
- LiveKit server logs were captured per trial without a completeness check.
- Janus full 2–5 s and LiveKit 2–5 s differ in regime (R0 vs R1), so their short-outage
  numbers are not like for like.
- No non-recovery (R3) trial in the study; LiveKit has no ride-out trial.

## 9. Files

- Spec and decisions: `STAGE-A-SPEC.md` (§1.1a–b ladder and client rules, §4.3 arms,
  §4.4 matrix, §4.5 runs, §5.6 triple encoding), `PLAN.md`, `FINDINGS.md`.
- Data: `study/`, `study-r2/` (per trial: `result.json`, `S.json`, `O1.json`, `O2.json`,
  `server-events.jsonl`, `state-poll.json`, server log).
- Analysis: `client/runner/divergence.mjs`, `divergence-table.mjs`, `classify-raw.mjs`.
- Outputs: `logs/study/table-final.md`, `divergence-final.json`, `rawclass-final.txt`,
  `table-all.txt` (run 1), `table-r2.txt` (run 2).
- Park evidence: `logs/study/parked-evidence-session{1,2,3}.txt`.
