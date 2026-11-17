# What two WebRTC media servers report when a participant's session is disrupted and recovers

**Review packet: claim, evidence and limits.** Version 3, 2026-10-06, revised after external
review, one further investigation and one follow-up measurement (§4.3). Author: Jay Suresh
Nirmal.

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
server's interfaces say, and how does that compare with when the other participants'
received audio actually recovered?

**Systems.** Two open-source SFUs with different designs, self-hosted on AWS:
LiveKit server v1.13.7 and Janus 1.4.1 (VideoRoom plugin). One runs at a time.

**A trial.** Three participants in a room, each publishing audio: the subject S and two
observers, O1 and O2. After warm-up, S is cut off from the server at the network layer for
D seconds, then restored. Two isolation modes:
- **full:** all traffic between S and the server is dropped (signalling and media);
- **media-only:** media traffic is dropped, the signalling connection stays up.

**Client.** S runs a fixed recovery policy, identical on both stacks: detect within about
2 s, wait 5 s, restart the transport inside the existing session, retry every 5 s, rebuild
the session if the server refuses, give up after 120 s. On LiveKit the stock browser SDK
(livekit-client v2.22.3) performs the actions; on Janus a client written for the study does.
The policy is held constant; the server is what is varied.

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
3. **Receiver-defined audio recovery (the reference).** Defined precisely in the box below.

> **Measurement definitions**
>
> - **Capture point.** Each participant's audio carries an in-band clock. At each receiver,
>   the remote track's **decoded audio is fed into a Web Audio processing graph** and read
>   there by an AudioWorklet. It is **not** captured at an output device: the browsers are
>   headless Chromium with no sound hardware. Every statement below is therefore about the
>   age of the audio **delivered to the receiver's processing graph after decoding and
>   jitter buffering**. We make no claim about what a person would have heard through a
>   loudspeaker; device output latency is not included.
> - **Age.** Capture time at the receiver minus the sender time encoded in the audio.
>   Samples are produced about every 100 ms from analysis windows of 21–85 ms; the clock
>   wraps at 64 s.
> - **Stale.** No decodable sample for more than 300 ms, or age above 1 s.
> - **Fresh again.** Age within 250 ms of that receiver's pre-outage baseline, continuously
>   for 1 s. **The timestamp is the start of that validated one-second interval, not its
>   end**, so the validation window adds nothing to reported recovery times.
> - **Two endpoints.** "Fresh again" exists per observer. Where one number per trial is
>   needed, we use **both observers fresh**, which is the slower of the two and a different
>   endpoint from either alone. §3.2 reports each observer separately.
> - **Outage.** First stale at either observer to both observers fresh.

**How a notification is compared with the reference.** Each reporting layer is reduced to:
the time of its first report that something is wrong with S, and the time of its first
later report that S is back. From these:
- **onset delay:** first report minus first stale audio;
- **unreported share:** the fraction of the outage that had passed before the layer said
  anything (1.00 = it never did);
- **recovery offset:** "back" report minus both-observers-fresh. Negative means the layer's
  "back" came before the receivers' audio was fresh; positive means the layer still
  reported a problem after it was.

"Membership" below means the layer that says who is in the room: join/leave events and
participant state.

---

## 1. The claim, and what it depends on

> **In the tested LiveKit and Janus configurations, membership, connection-quality and
> server-reception notifications were not interchangeable with receiver-defined audio
> recovery: their use as recovery proxies produced substantial, condition-dependent timing
> errors.**

In support, each proxy against the reference:

- **Membership** (both stacks). The monitored membership layers reported nothing in all
  164 trials in which the session survived, during outages of 1.5–56.7 s. They reported
  in all 51 trials in which the session was rebuilt, after 59–87% of the outage had passed.
  The tested range was 2–90 s (full) and 2–45 s (media-only); nothing is claimed outside it.
- **Connection quality** (LiveKit, sent to clients only). The first quality notification
  came 5.1–14.4 s after the audio went stale, and after a restart it still reported a
  problem 3.3–27.2 s after the audio was fresh.
- **Server reception** (Janus media event). Using Janus reception resumption as a proxy for
  listener recovery underestimates the interruption by up to 13.7 s. The event itself is
  accurate: Janus documents it as whether Janus is receiving media on the PeerConnection,
  and it reported exactly that. The error is in treating it as a statement about the
  receivers. §4.3 shows where the difference comes from.

### Read this before the results: every number characterises a server *and our client policy*

This is the most important limit on the claim and it applies throughout.

1. **Our client restarted a working LiveKit connection after short outages.** After a 2 s
   or 5 s outage the observers' audio stayed more than 2 s old, so the policy's
   detect-and-wait rule fired and the client restarted a connection that had already
   returned (20/20 trials). Those cells measure LiveKit plus this policy. We have not
   established whether the restart shortened or lengthened the interruption.
2. **Where a session survives or is rebuilt depends on client timing.** One result
   reversed when a client defect was fixed (§6.1).
3. **The Janus reception-versus-playout gap is produced on the client and receiver side.**
   It appears when S's browser delivers a backlog of audio at resumption, which happened
   in every study trial at media-only 10, 30 and 45 s but in only half of a later
   follow-up cell. Why a backlog forms is not established (§4.3).

A different client policy would move the boundaries and change the sizes of the errors.
What the data supports is that the proxies and the reference diverge, by how much under
this policy, and through which mechanisms.

---

## 2. Three statements that must not be written

| Statement | Why it is wrong |
|---|---|
| "The server reports nothing." | Janus reports reception stopping and resuming on its standard event handler (55 of 55 trials of 5 s or longer). LiveKit sends a connection-quality notification to clients in every trial (150/150) and logs each resume by name (§7). Only the monitored membership layer is silent. |
| "The servers have the information and their interfaces cannot express it." | True for LiveKit's webhooks and API. False for Janus: its standard event stream alone is enough to classify every trial correctly (§5). |
| "Nothing reports a short outage while it is happening." | True only of the **2 s** LiveKit cells: in 10/10 the first notification (9.2–10.2 s) came after both observers were already fresh (6.1–8.2 s). It is false at **5 s**: in LiveKit full 5 s the notification came at 9.5–10.3 s inside outages lasting up to 14.5 s, before recovery in 3/5 trials; in media-only 5 s, in 4/5. On Janus the reception event fired during 6/10 of the 2 s outages and all of the 5 s ones. An earlier prediction that below some duration *no* layer would report at all was also wrong and is recorded as such. |

---

## 3. Results by cell: 215 trials, 34 cells

**215 trials are retained. 30 earlier trials were superseded after a client correction**
(four LiveKit media-only cells, re-run; §6.1). Within the two runs, no trial was invalid or
aborted, and none was dropped for any other reason. LiveKit 150, Janus 65. n = 5 per cell,
10 at **nine** LiveKit cells near the expected boundary (full 17, 18, 19, 21, 23 s;
media-only 21, 22, 26, 28 s).

### 3.1 Notifications against the both-observers endpoint

Columns:
- **Outage:** range across the cell's trials of first-stale to both-observers-fresh.
- **Membership reported:** trials in which webhooks (LiveKit) or plugin/session events
  (Janus) reported anything about S. In every cell the participant-state API and the frames
  sent to observers gave the same answer (when reported, the API within 1.0 s of the event
  and observer frames within 0.01 s).
- **at:** when the first membership report came, seconds after onset.
- **unreported share:** as defined in §0, for the membership layer.
- **Media/quality signal:** Janus's reception event on its standard surface; LiveKit's
  connection-quality update, which exists only in the protocol sent to clients.
- **recovery error:** the recovery offset of that signal (§0).

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

The membership result is about **survival versus rebuild**, not about regime: ride-outs
and restarts are both silent.

**Where reporting switches from silent to "left, then joined"**

| Stack, mode | Last silent cell | First reported cell | Server acts at |
|---|---|---|---|
| LiveKit, full | 18 s (10/10 silent); 17 s is 9/10 | 19 s (10/10) | removes S at 20.0–21.8 s |
| LiveKit, media-only | 30 s (longest tested; 50/50 silent from 21 s to 30 s, 70/70 from 2 s) | none | not reached |
| Janus, full | 55 s (5/5 silent) | 65 s (5/5) | session times out at 59.8–61.0 s |
| Janus, media-only | 45 s (longest tested) | none | not reached |

**Longest observed outage with nothing in the monitored membership layer:** 56.7 s on
Janus (full, 55 s cell) and 42.9 s on LiveKit (media-only, 28 s cell). These are maxima
within the tested range, not bounds.

### 3.2 Each observer separately

Time, in seconds after onset, at which each observer's audio from S was fresh again.
"Both" is the per-trial maximum of the two and is what §3.1 uses.

| Stack | Mode | D (s) | n | O1 fresh again (s) | O2 fresh again (s) | Both, i.e. the slower (s) | Largest O1–O2 difference (s) |
|---|---|---|---|---|---|---|---|
| Janus | full | 2 | 5 | 2.0–2.2 | 2.1–2.2 | 2.1–2.2 | 0.0 |
| Janus | full | 5 | 5 | 5.1–5.2 | 5.1–5.2 | 5.1–5.2 | 0.0 |
| Janus | full | 10 | 5 | 10.1–10.2 | 10.1–10.2 | 10.1–10.2 | 0.0 |
| Janus | full | 30 | 5 | 30.4–30.7 | 30.3–30.7 | 30.4–30.7 | 0.1 |
| Janus | full | 45 | 5 | 49.5–49.7 | 49.5–49.7 | 49.5–49.7 | 0.0 |
| Janus | full | 55 | 5 | 56.7–57.0 | 56.7–57.0 | 56.7–57.0 | 0.0 |
| Janus | full | 65 | 5 | 70.2–70.9 | 70.2–70.9 | 70.2–70.9 | 0.0 |
| Janus | full | 90 | 5 | 91.5–91.7 | 91.5–91.7 | 91.5–91.7 | 0.0 |
| Janus | media-only | 2 | 5 | 2.1 | 2.1 | 2.1 | 0.0 |
| Janus | media-only | 5 | 5 | 5.1–5.2 | 5.1–5.2 | 5.1–5.2 | 0.0 |
| Janus | media-only | 10 | 5 | 19.1–23.8 | 18.9–23.6 | 19.1–23.8 | 0.3 |
| Janus | media-only | 30 | 5 | 39.6–41.7 | 40.3–42.8 | 40.9–42.8 | 2.6 |
| Janus | media-only | 45 | 5 | 47.9–49.9 | 48.5–49.1 | 48.5–49.9 | 1.4 |
| LiveKit | full | 2 | 5 | 7.7–8.2 | 7.7–8.2 | 7.7–8.2 | 0.0 |
| LiveKit | full | 5 | 5 | 7.7–14.9 | 7.7–14.9 | 7.7–14.9 | 0.0 |
| LiveKit | full | 10 | 5 | 13.4–18.8 | 13.4–18.8 | 13.4–18.8 | 0.1 |
| LiveKit | full | 16 | 5 | 21.7–22.2 | 21.7–22.2 | 21.7–22.2 | 0.0 |
| LiveKit | full | 17 | 10 | 21.6–26.4 | 21.7–26.4 | 21.7–26.4 | 0.1 |
| LiveKit | full | 18 | 10 | 21.6–22.4 | 21.6–22.4 | 21.6–22.4 | 0.1 |
| LiveKit | full | 19 | 10 | 26.2–28.6 | 26.2–28.6 | 26.2–28.6 | 0.2 |
| LiveKit | full | 21 | 10 | 27.8–28.6 | 27.8–28.6 | 27.8–28.6 | 0.0 |
| LiveKit | full | 23 | 10 | 27.9–28.5 | 27.8–28.5 | 27.9–28.5 | 0.4 |
| LiveKit | full | 26 | 5 | 27.9–28.4 | 27.9–28.4 | 27.9–28.4 | 0.0 |
| LiveKit | full | 30 | 5 | 33.9–34.3 | 33.9–34.3 | 33.9–34.3 | 0.0 |
| LiveKit | media-only | 2 | 5 | 6.1–8.1 | 6.1–8.1 | 6.1–8.1 | 0.0 |
| LiveKit | media-only | 5 | 5 | 8.1–14.0 | 8.1–13.8 | 8.1–14.0 | 0.4 |
| LiveKit | media-only | 10 | 5 | 21.0–23.1 | 21.1–23.2 | 21.1–23.2 | 0.1 |
| LiveKit | media-only | 20 | 5 | 24.1–32.8 | 24.1–33.4 | 24.1–33.4 | 0.6 |
| LiveKit | media-only | 21 | 10 | 24.5–33.8 | 24.2–33.9 | 24.5–33.9 | 1.3 |
| LiveKit | media-only | 22 | 10 | 26.7–35.3 | 26.7–36.5 | 26.7–36.5 | 1.9 |
| LiveKit | media-only | 23 | 5 | 27.2–29.6 | 27.1–28.1 | 27.2–29.6 | 1.7 |
| LiveKit | media-only | 26 | 10 | 32.3–41.9 | 32.3–42.1 | 32.3–42.1 | 1.7 |
| LiveKit | media-only | 28 | 10 | 34.7–42.8 | 34.7–42.9 | 34.7–42.9 | 1.0 |
| LiveKit | media-only | 30 | 5 | 31.9–40.9 | 31.9–42.4 | 31.9–42.4 | 1.4 |

The two observers agree closely in most trials (median difference 0.01 s). They differ by
more than 1 s in 17 of 215 trials, all in media-only cells of 20 s and above (largest
2.6 s). In those cells "both fresh" is later than the faster observer by up to that much,
and any per-listener statement should use this table.

---

## 4. Divergence: what each channel reported against receiver-defined recovery

### 4.1 LiveKit (150 trials: 109 restarts, 41 rebuilds)

| Layer | Restart (session survived) | Rebuild |
|---|---|---|
| **Standard surface:** webhooks | nothing, 109/109 | `track_unpublished` / `participant_left` at 20.0–21.8 s; 59–80% of the outage already over; "back" within 0.6 s of the reference |
| **Standard surface:** state API | S listed as active throughout, 109/109 | absent from 20.2–22.3 s; back within 0.9 s of the reference |
| **Raw protocol, to observers:** membership | nothing, 109/109 | "disconnected (connection timeout)" at 20.0–21.8 s, then a new session id |
| **Raw protocol, to observers:** quality | reported 109/109, 5.1–14.4 s after the audio went stale; stays below "excellent" 3.3–27.2 s **after** the audio is fresh | reported 41/41, 7.9–10.3 s after; clears with the rebuild |
| **Raw protocol, to S** | a "please resume" request at about 22 s in the 40 media-only trials of 22 s and above; otherwise nothing but the reply to S's own resume | "reconnect, state mismatch" refusal at 25–34 s |
| **Reference** | stale audio for 6.1–42.9 s, which is 1.9–16.1 s longer than the network outage itself | stale audio for 26.2–33.9 s |

**As a recovery proxy the quality notification is late at onset, mis-graded for short
outages, and late to clear.**
- For outages of 10 s and longer it says `LOST` (130/130).
- For 2 s and 5 s outages it says `GOOD` or `POOR` (14 and 6 of 20), never `LOST`.
- It reaches clients only. No webhook or API carries it.
- The 2 s and 5 s cells are restarts under our policy (§1), so their timings are not a
  property of LiveKit alone.

### 4.2 Janus (65 trials: 19 ride-outs, 36 restarts, 10 rebuilds)

| Layer | Ride-out / restart (session survived) | Rebuild |
|---|---|---|
| **Standard surface:** plugin and session events | nothing, 55/55 | "session timeout" at 59.8–61.0 s; 66–87% of the outage already over |
| **Standard surface:** state API | S listed as publishing throughout, 55/55 | absent from 59.9–61.9 s |
| **Standard surface:** reception event | "not receiving" 0.9–2.6 s after the audio went stale in 45/45 trials of 5 s and longer; 6/10 at 2 s | same, 1.2–2.8 s |
| **Raw protocol, to observers** | no membership message. A `publishers` announcement for S appears when S renegotiates (36/36 restarts) | "unpublished" at 59.8–61.0 s, then `publishers` |
| **Raw protocol, to S** | "not receiving" when signalling stayed up; nothing during full isolation | error 458 (no such session) on the claim attempt |
| **Reference** | stale audio for 1.5–56.7 s | stale audio for 69.7–91.7 s |

**Reception resumed versus receiver audio fresh, per observer:**

| Cell | Observer fresh minus "receiving" event (s) |
|---|---|
| Full isolation, session survived, 2–55 s | 0.02–0.17 |
| Media-only, 2 s and 5 s | 0.05–0.16 |
| **Media-only, 10 s** | **8.8–13.7** |
| **Media-only, 30 s** | **9.6–12.7** |
| Media-only, 45 s | 0.3–2.5 |

So a monitor that takes the reception event as recovery is right to within 0.2 s in most
cells and wrong by 9–14 s in two. The size of the error is set by how much of a sender
backlog the receiver keeps (§4.3), and it varies between trials of the same duration when
the backlog does.

### 4.3 Where that gap comes from

Two sources of evidence:
- **the 15 study trials** at media-only 10, 30 and 45 s (part of the 215), analysed from
  server packet counters and the in-band audio clock;
- **a follow-up cell of 10 trials** on 2026-10-06 at media-only 16 and 20 s, run to test the
  explanation at new backlog lengths. In these the browsers' WebRTC statistics were sampled
  every 250 ms at S and at both observers. They are **not** part of the 215.

What is demonstrated and what is hypothesis are kept apart.

#### Demonstrated

**D1. A sender-side backlog is delivered in one burst.** When Janus resumes receiving, its
received-packet counter for S rises within a second by far more than live audio. In the
follow-up trials S's own packets-sent counter shows the same thing from the other side: it
nearly stops (17–36 packets in 8.5–12.8 s) and then jumps by the backlog at resumption. The
backlog is therefore held in S's browser, before the point where sent packets are counted.

**D2. Janus forwards the burst in full.** The sent-packet counters on both observers'
subscriptions rise by the same amount in the same interval, in all 20 trials with a backlog.

**D3. The receivers get all of it and discard most of it.** In the follow-up trials each
observer's receive statistics show the whole burst arriving in a single 250 ms sample with
**zero packets lost**, and the **packets-discarded counter rising in that same sample by
exactly 400 (16 s cell) or 600 (20 s cell)**, in 10 of 10 observer measurements. The
discard is at the receiver's jitter buffer, in whole multiples of 200 packets (4.0 s of
20 ms audio).

**D4. What remains is the burst less that discard,** and it predicts each trial:

| Cell | Trials with a backlog | Burst (s of audio) | Discarded | Residual delay at observers (s) | Observed minus (burst mod 4.0 s) |
|---|---|---|---|---|---|
| 10 s | 5 of 5 | 2.77–3.15 | none | 2.72–3.13 | −0.05 to −0.02 |
| 16 s (follow-up) | 2 of 5 | 9.03, 9.12 | 400 packets, measured | 0.96–1.10 | −0.07 to −0.02 |
| 20 s (follow-up) | 3 of 5 | 12.88–12.98 | 600 packets, measured | 0.84–0.90 | −0.08 to −0.01 |
| 30 s | 5 of 5 | 22.79–23.05 | 20.0 s, from burst minus residual | 2.38–3.02 | −0.07 to −0.02 in 7 of 10; −0.39, −0.50, −0.63 in 3 |
| 45 s | 5 of 5 | 40.40–40.49 | 40.0 s, from burst minus residual | 0.21–0.41 | −0.13 to 0.00 in 9 of 10; −0.24 in 1 |

- The four larger misses coincide exactly with the only four observer-trials in which the
  receiver reported any loss (10–30 packets, 0.2–0.6 s). With that added back, all 30
  study measurements are within 0.13 s.
- The 10, 30 and 45 s cells alone could not fix the period: their discards (0, 20 and 40 s)
  fit 20, 10, 6.67, 5, 4 or 3.33 s equally. The 16 and 20 s cells rule out all but 4 s
  (5 s predicts residuals of 4.0 and 2.9 s; 10 s predicts 9.0 and 2.9 s; 20 s predicts 9.0
  and 12.9 s; 6.67 s predicts 2.4 and 6.2 s; 3.33 s predicts 2.4 and 2.9 s), and the
  discard counter shows the 200-packet step directly.
- The same relationship held on seven valid media-only trials from earlier runs, except one
  observer in one early-client trial, off by 1.5 s and unexplained.

**D5. The residual sets the gap between server reception and receiver recovery.** After the
burst the observers' audio age falls at 0.19–0.33 s per second; in the follow-up trials the
samples removed by accelerated playout total 0.8–1.1 s, matching the residual. Gap between
the reception event and each observer being fresh:

| Cell | Residual (s) | Observer fresh minus "receiving" event (s) |
|---|---|---|
| 10 s | 2.7–3.1 | 8.8–13.7 |
| 16 s, backlog trials | 1.0–1.1 | 3.2–5.8 |
| 20 s, backlog trials | 0.8–0.9 | 2.2–3.0 |
| 30 s | 2.4–3.0 | 9.6–12.7 |
| 45 s | 0.2–0.4 | 0.3–2.5 |
| any cell, trials without a backlog | 0 | 0.02–0.18 |

So the 45 s cell is small because 40.4 s leaves a remainder of 0.4 s, and the 10 s and 30 s
cells are alike because 3 s and 23 s leave the same remainder. It is not a property of the
outage duration.

**D6. Neither the server nor the observers' connections are involved.** The server
receives and forwards the full burst identically at every duration, and no observer shows
an ICE or connection-state change or a renegotiation in any trial.

#### Hypothesis, not established

**H1. Why a backlog forms, and the role of the ICE restart.** What the records support:
- In all 20 trials with a backlog, its length equals the interval from S's first answered
  restart offer to resumption, within 0.04 s.
- **A backlog does not always form.** In the follow-up cell, 5 of 10 trials had none: S
  kept sending at the normal rate through the restart and those packets were lost.
- Looking back over the 31 valid media-only trials with the current client, a backlog
  started at the first offer in all 25 where S's publisher connection had already reported
  ICE "disconnected" when the offer was made, and in none of the 6 where it had not. In one
  of those 6 a backlog began at the second restart instead.
- Beginning a restart is not sufficient: in three earlier full-isolation trials the client
  began one locally with signalling dead, and there was no backlog.

This pattern was found after the fact, not predicted and tested. Temporal alignment is not
causation, and the records do not show which part of the negotiation matters or why.

**H2. Which component of S's browser holds the backlog.** It is upstream of the
packets-sent counter. The browser's reported send delay does not rise, so the statistics do
not identify it as pacer queueing; capture, encoder and other stages are not separable.

**H3. Why the receiver's buffer behaves this way.** That it discards in 200-packet steps is
measured (D3). That this is a fixed-capacity buffer emptied on overflow is the obvious
reading; the receiver's internal policy was not examined.

#### Cautions

- **Possible instrument effect.** With the statistics sampler running, ICE "disconnected"
  came after the offer in 5 of 10 trials, against 1 of 21 without it. We cannot rule out
  that sampling shifted that timing. It would affect how often a backlog forms, not what
  happens when one does.
- **Scope.** One receiver implementation (the Chromium build shipped with Playwright
  1.62.1), 20 ms audio packets, five backlog lengths. LiveKit has no equivalent packet
  counters in our records, so whether the same effect contributes to its 1.9–16.1 s of
  extra stale time was not examined.
- **Clock artifact.** Excluded for the period: the discard is measured by the receiver's
  own counter, independently of the audio clock.

### 4.4 The proxies err in different directions

- LiveKit's quality notification is late at onset and late to clear.
- Janus's reception event is prompt at onset and accurate about reception; as a proxy for
  receiver recovery it is early by up to 13.7 s when a sender backlog is delivered and the
  receiver keeps part of it.
- Neither stack has any notification tied to the age of the audio the other participants
  are receiving.

---

## 5. Can the raw protocol classify what the membership layer misses?

**Test.** Four rule-based classifiers, each restricted to one evidence source, assign a
regime to each trial. They see no client state and no media measurements. Results against
the client-recorded regime:

| Evidence source, used alone | LiveKit, membership-silent (109) | Janus, membership-silent (55) | LiveKit, all (150) | Janus, all (65) |
|---|---|---|---|---|
| 1. Frames the server sent to S | 109/109 | 55/55 | 150/150 | 65/65 |
| 2. Frames the server sent to observers | **0/109** | **55/55** | 41/150 | 65/65 |
| 3. Server's standard event surface | **0/109** | **55/55** | 41/150 | 65/65 |
| 4. Frames S sent to the server | 109/109 | 55/55 | 150/150 | 65/65 |

Source 4 is what the server was told, not something it said; it is listed for completeness.

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
1. Rows 1 and 4 are close to circular. Regimes are defined by the client's own actions,
   and those frames are the requests and the server's replies to them. The informative
   rows are 2 and 3.
2. Ride-outs are classified correctly only by the *absence* of recovery frames. The
   protocol cannot distinguish "rode out an outage" from "nothing happened".
3. There is no LiveKit ride-out trial and no failed-recovery trial on either stack.
4. The rules were written after seeing the data. On 35 trials from earlier runs that were
   not used to write them, the pattern is the same with no misclassification.
5. The Janus `publishers` announcement is a side effect of renegotiation. We did not check
   whether other reconfigurations also produce it.

---

## 6. Limitations that must be stated

The policy dependence in §1 is the first of these. The rest follow.

### 6.1 Survival-versus-rebuild boundaries are joint client–server properties

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
fixed for the second. A fifth of this kind may remain. The sender backlog in §4.3 is not a
defect of this kind, but it arises in the browsers, not in Janus, and is flagged as such.

### 6.3 What the study did not measure

- **Scope:** audio only; three participants; one region; one browser engine (Chromium);
  one client policy; two SFUs at one version each.
- **Sample size:** n = 5 per cell (10 at nine).
- **Split cells.** One cell split between survival and rebuild: LiveKit full 17 s (9
  restarts, 1 rebuild). One cell split between regimes without affecting survival: Janus
  full 5 s (4 ride-outs, 1 restart). No transition proportion is estimated from either.
- **Regimes not observed:** no failed recovery on either stack; no ride-out on LiveKit
  (see §1, item 1). Janus rode the same short outages out (19/20), so the two stacks'
  short-outage numbers are not like for like.
- **Longer outages:** media-only was tested to 30 s (LiveKit) and 45 s (Janus); neither
  reached a boundary.
- **What "fresh" covers:** audio at the receiver's processing graph (§0). Not loudspeaker
  output, and not perceptual quality. Recovery times include the receiver draining
  buffered audio; §4.3 measures how large that can be.
- **Receiver and sender internals:** the 215 study trials recorded no browser statistics.
  The 10 follow-up trials did (§4.3); they are a separate, smaller sample at two durations
  on Janus only.
- **Server logs:** LiveKit's logs were captured per trial without a completeness check
  (§7).
- **Hosted products:** only the self-hosted open-source servers were examined.
- **Prior work:** not surveyed for this packet.

---

## 7. What the software already provides: source review

A source and documentation review (no experiment) of LiveKit v1.13.7 and its main branch,
and Janus 1.4.1, asked: configured optimally, could an operator already learn that a
participant was disrupted and recovered?

**Janus: largely yes, at the server.**
- The event handler has nine event types and we had all enabled. None is a named recovery
  or reconnection event; reclaiming a session emits no event at all.
- But reception events ("receiving" false, then true), SDP events and ICE-state events for
  the session are on the standard surface. Together they show that the server stopped
  receiving, that it resumed, and by what mechanism. This is the same surface that
  classified 65/65 in §5.
- It says nothing about the receivers, which is the difference §4.2–§4.3 measure.

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
- Janus already reports the disruption, as seen by the server, on its standard surface.
- LiveKit knows a resume occurred, records it internally, and does not deliver it to any
  interface an application can consume.
- On neither stack is any notification tied to when the other participants' received
  audio became stale or fresh again. That is the part no existing surface covers, and it
  is what this study measures.

For that reason no reporting mechanism was built or evaluated; this is a measurement
study.

---

## Appendix: provenance

- **Trials:** two runs on 2026-10-02. Run 1: 175 trials, of which 145 are retained and 30
  superseded (§6.1). Run 2: 70 trials (four new LiveKit boundary cells, four re-run
  cells). No trial in either run was invalid or aborted.
- **Validity checks applied to every trial at run time:** placement of server and clients
  on separate nodes; isolation applied and removed, duration within 0.25 s; complete
  server-event capture (sequence-numbered store); client–server clock offset measured, with
  uncertainty under 10 ms (observed under 1 ms); state polling without gaps; no recovery
  action taken outside the scripted policy; no observer's own connection failing.
- **Not used as study data:** earlier shakedown, confirmation and validation runs, which
  used earlier versions of the client.
- **Changes from version 1 of this packet:** claim narrowed (§1); policy dependence moved
  to §1; measurement definitions added (§0); per-observer table added (§3.2); §4.3 added;
  five count and wording errors corrected (nine n = 10 cells; 50 media-only trials at
  21–30 s; four classifier rows shown; both split cells named; retained/superseded
  wording); short-outage statement restricted to the 2 s cells (§2).
- **Changes from version 2:** §4.3 rewritten. The buffer period is now measured (4.0 s,
  200 packets) from a follow-up cell of 10 trials with browser statistics; "a whole
  multiple of 4.0 s" in version 2 was not supported by the data it cited. The statement
  that a backlog exists only when a restart is begun during the outage is withdrawn; the
  role of the restart is a hypothesis. Demonstrated findings and hypotheses are separated.
- **Follow-up cell:** `backlog-cell/`, 2026-10-06, Janus media-only 16 s and 20 s, n = 5
  each, all valid. Same client as the 215 plus a read-only statistics sampler.
