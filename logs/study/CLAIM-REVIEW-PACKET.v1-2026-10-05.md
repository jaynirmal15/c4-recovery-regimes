# What two WebRTC media servers report when a participant's session is disrupted and recovers

**Review packet: claim, evidence and limits.** Prepared 2026-10-05 for external review,
before any drafting. Author: Jay Suresh Nirmal.

**What we are asking the reviewer:** (a) is the claim in §1 supported by the data in §3–§5,
and (b) is it novel? On (b): **no literature search has been done for this packet.** Nothing
below should be read as a novelty claim.

---

## 0. Background a new reader needs

**Setting.** In a multi-party WebRTC call, each participant connects to a server (a
selective forwarding unit, SFU) that relays media. When a participant's network fails for a
while and comes back, the client recovers in one of a few ways. An operator, or an
application built on the SFU, learns about this only through what the server reports.

**Question.** When a participant's session is disrupted and then recovers, what do the
server's interfaces say, and how does that compare with what the other participants
actually experienced?

**Systems.** Two open-source SFUs with different designs, self-hosted on AWS:
LiveKit server v1.13.7 and Janus 1.4.1 (VideoRoom plugin). One runs at a time.

**A trial.** Three participants in a room, each publishing audio: the subject S and two
observers. After warm-up, S is cut off from the server at the network layer for D seconds,
then restored. Two isolation modes:
- **full:** all traffic between S and the server is dropped (signalling and media);
- **media-only:** media traffic is dropped, the signalling connection stays up.

**Client.** S runs a fixed recovery policy, identical on both stacks: detect within about
2 s, wait 5 s, restart the transport inside the existing session, retry every 5 s, rebuild
the session if the server refuses, give up after 120 s. On LiveKit the stock browser SDK
(livekit-client v2.22.3) performs the actions; on Janus a client written for the study does.
The policy is held constant; the server is what is studied.

**Regimes** (how S recovered, from the client's own record):
- **R0, rides out:** the client took no recovery action;
- **R1, transport restart:** connectivity re-established inside the same session;
- **R2, rebuild:** the old session is abandoned and a new one joined under the same identity.

**Three channels, recorded for every trial:**
1. **Server standard surface:** what an operator sees. LiveKit: webhooks and the
   participant-state API (polled every 1 s). Janus: the event handler stream (all event
   types enabled) and the participant-list API (polled every 1 s).
2. **Raw protocol:** the signalling frames the server sent, captured before any SDK
   interprets them, at S and at both observers.
3. **Observer experience (the reference):** each participant's audio carries an in-band
   clock, so every receiver measures the age of the media it is actually playing. "Stale"
   means old or absent media from S at an observer; "fresh again" means back within
   250 ms of the pre-outage baseline for 1 s, at both observers. The **outage** is the
   interval from first stale to fresh again.

**How a report is compared with the reference.** Each reporting layer is reduced to: the
time of its first report that something is wrong with S, and the time of its first later
report that S is back. From these:
- **onset delay:** first report minus first stale media;
- **unreported share:** the fraction of the outage that had passed before the layer said
  anything (1.00 = it never did);
- **recovery error:** "back" report minus fresh-again. Negative means the layer said
  "back" while observers still had stale media; positive means it still said "degraded"
  after media was fresh.

"Membership" below means the layer that says who is in the room: join/leave events and
participant state.

---

## 1. The claim, as the data supports it

> On both SFUs, a participant's media can be stale to everyone else for tens of seconds
> (up to 57 s in our trials) while every membership and participant-state interface
> reports nothing, provided the participant's session identity survives the recovery.
> Membership reporting is categorical: silent in all 164 trials where the session
> survived, present in all 51 where it was rebuilt. What the stacks report beyond
> membership differs in kind and errs in opposite directions: LiveKit's only signal goes to
> clients, arrives 5–14 s late and understates short outages, while Janus's media event is
> prompt but declares recovery 9–14 s before other participants have fresh media after a
> media-only outage.

The contribution is the measurement: a per-layer, quantified comparison of what each
interface reported against what other participants experienced, across outage duration,
isolation type and two server designs. It is not a claim that the information is
unavailable (§2, §7).

---

## 2. Three statements that must not be written

| Statement | Why it is wrong |
|---|---|
| "The server reports nothing." | Janus reports media stopping and resuming on its standard event handler (55 of 55 trials of 5 s or longer). LiveKit sends a connection-quality signal to clients in every trial (150/150) and logs each resume by name (§7). Only the membership layer is silent. |
| "The servers have the information and their interfaces cannot express it." | True for LiveKit's webhooks and API. False for Janus: its standard event stream alone is enough to classify every trial correctly (§5). |
| "Below some duration, nothing reports the outage in any layer." | False. LiveKit's quality signal fired in every 2 s and 5 s trial (20/20). It arrived 9–14 s after onset, by which time a 2 s outage had ended. The correct statement is: **nothing reports a short outage while it is happening** on LiveKit. This was a prediction made before the run; it was wrong and is recorded as such. |

---

## 3. Results by cell: 215 trials, 34 cells

All 215 trials are valid; none was excluded. LiveKit 150, Janus 65. n = 5 per cell, 10 at
eight LiveKit cells near the expected boundary.

Columns:
- **Outage:** range across the cell's trials of first-stale to fresh-again at observers.
- **Membership reported:** trials in which webhooks (LiveKit) or plugin/session events
  (Janus) reported anything about S. In every cell the participant-state API and the frames
  sent to observers gave the same answer (when reported, the API within 1.0 s of the event
  and observer frames within 0.01 s).
- **at:** when the first membership report came, seconds after onset.
- **unreported share:** as defined in §0, for the membership layer.
- **Media/quality signal:** Janus's media event on its standard surface; LiveKit's
  connection-quality update, which exists only in the protocol sent to clients.

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

**Summary of membership reporting**

| | Session survived (R0, R1) | Session rebuilt (R2) |
|---|---|---|
| LiveKit | silent 109/109 | reported 41/41 |
| Janus | silent 55/55 | reported 10/10 |

**Where reporting switches from silent to "left, then joined"**

| Stack, mode | Last silent cell | First reported cell | Server acts at |
|---|---|---|---|
| LiveKit, full | 18 s (10/10 silent); 17 s is 9/10 | 19 s (10/10) | removes S at 20.0–21.8 s |
| LiveKit, media-only | 30 s (longest tested; 60/60 silent from 21 s to 30 s) | none | not reached |
| Janus, full | 55 s (5/5 silent) | 65 s (5/5) | session times out at 59.8–61.0 s |
| Janus, media-only | 45 s (longest tested) | none | not reached |

**Longest outage with nothing in the membership layer:** 56.7 s on Janus (full, 55 s cell)
and 42.9 s on LiveKit (media-only, 28 s cell).

---

## 4. Divergence: what each channel reported against what observers experienced

### LiveKit (150 trials: 109 restarts, 41 rebuilds)

| Layer | Restart (session survived) | Rebuild |
|---|---|---|
| **Standard surface:** webhooks | nothing, 109/109 | `track_unpublished` / `participant_left` at 20.0–21.8 s; 59–80% of the outage already over; "back" within 0.6 s of the truth |
| **Standard surface:** state API | S listed as active throughout, 109/109 | absent from 20.2–22.3 s; back within 0.9 s of the truth |
| **Raw protocol, to observers:** membership | nothing, 109/109 | "disconnected (connection timeout)" at 20.0–21.8 s, then a new session id |
| **Raw protocol, to observers:** quality | reported 109/109, 5.1–14.4 s after media went stale; stays below "excellent" 3.3–27.2 s **after** media is fresh | reported 41/41, 7.9–10.3 s after; clears with the rebuild |
| **Raw protocol, to S** | a "please resume" request at about 22 s in the 40 media-only trials of 22 s and above; otherwise nothing but the reply to S's own resume | "reconnect, state mismatch" refusal at 25–34 s |
| **Observers experienced** | stale media for 6.1–42.9 s, which is 1.9–16.1 s longer than the network outage itself | stale media for 26.2–33.9 s |

**The quality signal's failure is lateness and wrong severity.**
- For outages of 10 s and longer it says `LOST` (130/130).
- For 2 s and 5 s outages it says `GOOD` or `POOR` (14 and 6 of 20), never `LOST`, and
  arrives 8.8–14.4 s after onset. Observers had fresh media again at 6.1–14.9 s, so for
  a 2 s outage the only report arrives after the event is over.
- It reaches clients only. No webhook or API carries it.

### Janus (65 trials: 19 ride-outs, 36 restarts, 10 rebuilds)

| Layer | Ride-out / restart (session survived) | Rebuild |
|---|---|---|
| **Standard surface:** plugin and session events | nothing, 55/55 | "session timeout" at 59.8–61.0 s; 66–87% of the outage already over |
| **Standard surface:** state API | S listed as publishing throughout, 55/55 | absent from 59.9–61.9 s |
| **Standard surface:** media event | "not receiving" 0.9–2.6 s after media went stale in 45/45 trials of 5 s and longer; 6/10 at 2 s | same, 1.2–2.8 s |
| **Raw protocol, to observers** | no membership message. A `publishers` announcement for S appears when S renegotiates (36/36 restarts) | "unpublished" at 59.8–61.0 s, then `publishers` |
| **Raw protocol, to S** | "not receiving" when signalling stayed up; nothing during full isolation | error 458 (no such session) on the claim attempt |
| **Observers experienced** | stale media for 1.5–56.7 s | stale media for 69.7–91.7 s |

**The media event's failure is premature recovery, in one mode.**

| Cell | Media event says "receiving" relative to observers having fresh media |
|---|---|
| Full isolation, 2–55 s | within 0.2 s |
| Media-only, 2 s and 5 s | within 0.2 s |
| **Media-only, 10 s** | **9.0–13.7 s early** |
| **Media-only, 30 s** | **10.9–12.7 s early** |
| Media-only, 45 s | 0.9–2.5 s early |

The server is receiving S's packets again, but observers are still playing stale audio.
We have not explained why the 45 s cell differs from the 10 s and 30 s cells.

### The two stacks err in opposite directions

- LiveKit under-reports onset (late, and too mild for short outages) and over-reports
  duration (still "degraded" after recovery).
- Janus reports onset promptly and under-reports duration after media-only outages
  (declares recovery early).
- Neither stack has any report of what the other participants are actually hearing.

---

## 5. Can the raw protocol classify what the membership layer misses?

**Test.** Four rule-based classifiers, each restricted to one evidence source, assign a
regime to each trial. They see no client state and no media measurements. Results against
the client-recorded regime:

| Evidence source, used alone | LiveKit, membership-silent (109) | Janus, membership-silent (55) | LiveKit, all (150) | Janus, all (65) |
|---|---|---|---|---|
| Frames the server sent to S | 109/109 | 55/55 | 150/150 | 65/65 |
| Frames the server sent to observers | **0/109** | **55/55** | 41/150 | 65/65 |
| Server's standard event surface | **0/109** | **55/55** | 41/150 | 65/65 |

**Reading.**
- **LiveKit:** the server tells S exactly what happened (`ReconnectResponse` for a
  restart; a `leave` with reason, then `JoinResponse`, for a rebuild). Its webhooks and
  the frames it sends to observers cannot distinguish a restart from nothing having
  happened. So "the information exists and is not exposed" **holds for LiveKit**.
- **Janus:** observers receive a `publishers` announcement when S renegotiates, and the
  standard event stream carries the session's SDP and ICE-state events. Either is enough
  to classify every trial. So the same statement **does not hold for Janus**. What holds
  on both is narrower: no interface *names* a recovery.

**Limits of this test, which the reviewer should weigh:**
1. The first row is close to circular. Regimes are defined by the client's own actions,
   and those frames are the server's replies to them. The informative rows are the second
   and third.
2. Ride-outs are classified correctly only by the *absence* of recovery frames. The
   protocol cannot distinguish "rode out an outage" from "nothing happened".
3. There is no LiveKit ride-out trial and no failed-recovery trial on either stack.
4. The rules were written after seeing the data. On 35 trials from earlier runs that were
   not used to write them, the pattern is the same with no misclassification.
5. The Janus `publishers` announcement is a side effect of renegotiation. We did not check
   whether other reconfigurations also produce it.

---

## 6. Limitations that must be stated

### 6.1 Regime boundaries are joint client–server properties, not server properties

The durations at which a stack switches from restart to rebuild (§3) depend on the
client's timing as well as the server's.

**Demonstration: a result that reversed.** In the first run, every LiveKit media-only
outage of 23 s or longer ended in a rebuild (30/30), with membership reporting "left, then
joined" at 27 s. Traced to its timeline, the cause was our client:
- at about 22 s LiveKit asks the client to resume;
- our client was in the middle of a restart attempt, could not start another, and did not
  act on the request once that attempt ended;
- it then waited its 5 s retry interval, and LiveKit removed the participant in the
  meantime.

With the client fixed to honour the held request, the same cells were re-run: **restart
30/30, membership silent**, and no rebuild in any media-only cell up to 30 s. The first
run's 30 trials in those cells are superseded and not in the 215.

The full-isolation boundary on LiveKit (18–19 s) is joint in the same way: the server
removes S at about 20 s, and the SDK's single resume attempt does not complete in time
even though the network returned at 19 s. A client with different retry timing would move
it.

### 6.2 Four times the test client produced the result

Each was found by tracing an unexpected result to its timeline before accepting it.

| # | Defect in our client or policy | What it would have been reported as | Fix |
|---|---|---|---|
| 1 | Give-up timer collided with a Janus server timer (first by 0.42 s; later the 60 s give-up equalled Janus's 60 s session timeout) | "Janus never recovers from a 30 s outage" | retry the restart once after connectivity returns; give-up raised to 120 s |
| 2 | After reclaiming a Janus session on a new connection, an offer lost with the old connection left the server silently deferring every later restart | "Janus does not restore inbound media" | re-subscribe on fresh handles after a reclaim |
| 3 | A request sent into a dead connection was delivered about 26 s later and applied | a second 5 s outage attributed to Janus | probe the connection before sending a new offer |
| 4 | LiveKit's resume request, arriving mid-restart, was dropped | "LiveKit rebuilds media-only outages of 23 s and above" | hold and honour the request; **result reversed** (§6.1) |

Defects 1–3 were fixed before the 215 trials. Defect 4 was found in the first run and
fixed for the second. A fifth of this kind may remain.

### 6.3 What the study did not measure

- **Scope:** audio only; three participants; one region; one browser engine (Chromium);
  one client policy; two SFUs at one version each.
- **Sample size:** n = 5 per cell (10 at eight). Only one cell split between regimes
  (LiveKit full 17 s, 9:1), so no transition proportion is estimated.
- **Regimes not observed:** no failed recovery on either stack; no ride-out on LiveKit.
  LiveKit's 2 s and 5 s trials are restarts (20/20) because observers' media stayed more
  than 2 s old after the network returned and the client restarted a working connection.
  Janus rode the same outages out (19/20). The short-outage numbers are therefore not like
  for like, and we have not established whether that restart shortened or lengthened the
  LiveKit outage.
- **Longer outages:** media-only was tested to 30 s (LiveKit) and 45 s (Janus); neither
  reached a boundary.
- **Definition of fresh:** an in-band audio clock within 250 ms of baseline for 1 s.
  Recovery times include the receiver playing out buffered audio.
- **Server logs:** LiveKit's logs were captured per trial without a completeness check
  (§7).
- **Hosted products:** only the self-hosted open-source servers were examined.
- **Prior work:** not surveyed for this packet.

---

## 7. What the software already provides: source review

A source and documentation review (no experiment) of LiveKit v1.13.7 and its main branch,
and Janus 1.4.1, asked: configured optimally, could an operator already learn that a
participant was disrupted and recovered?

**Janus: largely yes.**
- The event handler has nine event types and we had all enabled. None is a named recovery
  or reconnection event; reclaiming a session emits no event at all.
- But media events ("receiving" false, then true), SDP events and ICE-state events for the
  session are on the standard surface. Together they show that media stopped, that it
  resumed, and by what mechanism. This is the same surface that classified 65/65 in §5.
- Its measured weakness is §4's: after media-only outages it declares recovery early.

**LiveKit: no, by any machine-readable interface; partly, by logs.**
- Webhooks: 14 event types, none for resume, ICE restart or reconnection. Configuration
  can only filter events out.
- Server API: participant state has no connection or quality field, and shows "active"
  throughout an outage.
- Metrics: aggregate only, nothing per participant.
- **The server builds the event and discards it.** On every resume it constructs a
  `PARTICIPANT_RESUMED` analytics event carrying the reconnect reason. In the open-source
  build the analytics sender is never connected, so the event is dropped; no configuration
  enables it.
- **The server log names it.** At the default level it logs "resuming RTC session" with
  the participant and reason. The line is present in 37 of the 40 first-run restart
  trials; the other three had truncated log captures.

**Consequence for the claim.** The gap is narrower than "nobody reports this":
- Janus already reports the disruption on its standard surface.
- LiveKit knows a resume occurred, records it internally, and does not deliver it to any
  interface an application can consume.
- On neither stack does any interface report when the other participants' media became
  stale or fresh again. That is the part no existing surface covers, and it is what this
  study measures.

For that reason no reporting mechanism was built or evaluated; this is a measurement
study.

---

## Appendix: provenance

- **Trials:** two runs on 2026-10-02. Run 1: 175 trials, of which 145 are used and 30
  superseded (§6.1). Run 2: 70 trials (four new LiveKit boundary cells, four re-run
  cells). No trial in either run was invalid or aborted.
- **Validity checks applied to every trial at run time:** placement of server and clients
  on separate nodes; isolation applied and removed, duration within 0.25 s; complete
  server-event capture (sequence-numbered store); client–server clock offset measured, with
  uncertainty under 10 ms (observed under 1 ms); state polling without gaps; no recovery
  action taken outside the scripted policy; no observer's own connection failing.
- **Not used as study data:** earlier shakedown, confirmation and validation runs, which
  used earlier versions of the client.
