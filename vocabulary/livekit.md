# LiveKit participant-lifecycle vocabulary (ground truth, gate one)

**Deployment:** livekit-server **v1.13.7** (image digest `sha256:6fd3b708…`), Helm chart
`livekit/livekit-server` 1.9.0, namespace `c4-livekit`. Single node, no Redis, pod
networking, embedded TURN off. Room defaults in force: `empty_timeout` 300 s,
`departure_timeout` 20 s.

**Probes (2026-09-29 05:50–05:54 UTC):**
- Signalling plus PeerConnection only, **no media published**, using the official `lk` CLI
  v2.18.8 (server-sdk-go / pion) as in-cluster pods.
- An `lk` observer sat in room `c4-probe` throughout.
- A RoomService `ListParticipants` poller ran at 1 s.

**Raw data:** `probes/raw/livekit-*`, `probes/marks-livekit.jsonl`. Examples:
`payloads/livekit-webhook-examples.json`.

**Status legend:**
- **OBSERVED:** seen on this deployment, latency measured.
- **DOCS-ONLY:** from `livekit-docs.md` (source at v1.13.7; protocol `a4f4b5c`;
  client-sdk-js v2.22.3). Not exercised because it needs media or a network fault, both
  out of scope for this phase.

## 1. What the server emits (webhooks)

| Webhook `event` | Fires when | `participant.disconnectReason` | Status |
|---|---|---|---|
| `room_started` | Room created (API or first join) | none | OBSERVED |
| `room_finished` | Room closed. Observed 600 s after creation for a room created with `empty_timeout=600` and never joined | none | OBSERVED |
| `participant_joined` | Participant becomes **ACTIVE** (ICE connected), not on WS join. Observed ~30 ms after `starting RTC session` | none; `state:"ACTIVE"` | OBSERVED |
| `participant_left` (graceful) | Client sent Leave | `CLIENT_INITIATED` | OBSERVED: **1.1 s** after SIGTERM to the lk process |
| `participant_left` (transport lost) | Server closed the participant after ICE disconnected→failed plus a 5 s cleanup | `CONNECTION_TIMEOUT` | OBSERVED: **20.8 s** after the process was SIGKILLed |
| `participant_left` (replaced) | Same identity joined again without `reconnect=1`. The old sid is removed **before** the new one joins | `DUPLICATE_IDENTITY` | OBSERVED: old sid left, new sid joined **22 ms** later |
| `participant_connection_aborted` | Participant closed without ever becoming connected | (per source) | DOCS-ONLY |
| `track_published` / `track_unpublished` | Track lifecycle | none | DOCS-ONLY (no media in probes) |
| (none) | **Resume** (same sid, ICE restart). Analytics event `PARTICIPANT_RESUMED` only; no webhook | none | DOCS-ONLY |

**Payload notes (observed):**
- `createdAt` is in **whole seconds**. Precise timing needs the receiver's clock or the
  server log.
- `participant.state` is `DISCONNECTED` on every `participant_left`.
- `room.numParticipants` still counts the leaver.
- The webhook carries a signed JWT in `Authorization` (the sink logs it).

## 2. Server-side state (RoomService `ListParticipants`)

**OBSERVED:** the state API shows **no intermediate state for a lost participant.**
- After its lk process was SIGKILLed at 05:52:22.5, `p2` stayed `ACTIVE` in every poll.
- It disappeared from the list at 05:52:44.69, the same second as the webhook.
- `JOINING`/`JOINED` were never seen at 1 s polling (join-to-ACTIVE is about 20 ms).
- Duplicate identity showed the same identity with a **new sid**, and no gap between them.

**Implication:** polling server state cannot reveal "reconnecting" or "transport lost". A
participant looks healthy until it is removed.

## 3. Server's own timeline for a lost participant (OBSERVED, server debug log, L2)

Times are relative to the SIGKILL of the `lk` process (container exit 137 at 05:52:23).

| t (s) | Server log |
|---|---|
| +0.0–1.1 | `finishing WS connection {closedByClient:true}`, `signal stream closed`, `signal source valid {valid:false}`, `RTC session finishing`. **The participant is not removed.** |
| +9.7 | `ice connection state change` → `disconnected` (SUBSCRIBER and PUBLISHER) |
| +15.7 | ICE → `failed`; `could not send message … SignalResponse_Leave` (stream closed); `closing signal connection {reason: TRANSPORT_FAILURE}` |
| +20.7 | `participant closing {reason: PEER_CONNECTION_DISCONNECTED, isExpectedToResume:false}` → state `DISCONNECTED` |
| +20.8 | Webhook `participant_left`, `disconnectReason: CONNECTION_TIMEOUT` |

This matches the source constants exactly (`iceDisconnectedTimeout` 10 s,
`iceFailedTimeout` 5 s, `disconnectCleanupDuration` 5 s). **The resume window after
total loss is about 20 s**, and it is hard-coded, not configurable. The internal close
reason (`PEER_CONNECTION_DISCONNECTED`) and the external one (`CONNECTION_TIMEOUT`) have
different names. Both are recorded in the adapter mapping.

The WebSocket close alone (at +0) removes nothing, because ICE had connected (this matches
the source: `SIGNAL_CLOSE` only if ICE never connected). **Inference (not tested):** if the
process had lost only its WS and kept ICE alive, it would have stayed in the room
indefinitely.

## 4. What other participants observe

**Observer used: `lk` CLI = server-sdk-go, not the browser SDK.**

| Scenario | Observer log | Latency vs webhook | Status |
|---|---|---|---|
| Join | `participant connected {participantID, participant}` | +0.8 / +2.3 / +1.5 s (p1/p2/p3) | OBSERVED |
| Graceful leave | `participant disconnected` | +1.2 s | OBSERVED |
| Transport lost (SIGKILL) | `participant disconnected`, with no earlier sign of trouble (no quality/reconnect event printed) | +2.2 s (i.e. 23 s after the kill) | OBSERVED |
| Duplicate identity | **Nothing.** No disconnect for the old sid, no connect for the new sid. Only a final `disconnected` for the new sid at cleanup | none | OBSERVED |

**Caveat:** every observer event was logged at `hh:mm:ss.621`. The lk CLI processes or
prints participant events on a 1 s tick, so this observer has **1 s resolution** and adds
0–1 s of lag. It is not a timing instrument.

**Duplicate identity is invisible here.** Per source, the browser SDK
(client-sdk-js) *does* receive a ParticipantUpdate with the old sid DISCONNECTED
(`DUPLICATE_IDENTITY`). The Go SDK used here evidently coalesces by identity. **What
"other participants observe" depends on which SDK the observers run.** This is the same
asymmetry as DC-1, applied to observers.

DOCS-ONLY for browser participants (client-sdk-js v2.22.3), from `livekit-docs.md` §4–5:
- `ParticipantConnected`, `ParticipantDisconnected(p, reason)`, and
  `ConnectionQualityChanged(lost)` on others.
- `SignalReconnecting` → `Reconnected` (resume) and `Reconnecting` → `Reconnected` (full
  reconnect) on the subject.
- A full reconnect emits a local `ParticipantDisconnected` for **every** remote.
- Retry policy: 10 attempts, delays 0, 0.3, 1.2, 2.7, 4.8, then 7 s ×5, plus jitter.

## 5. Candidate recovery regimes as LiveKit expresses them

| Regime (study vocabulary) | LiveKit signature | Server-visible? | Others-visible? |
|---|---|---|---|
| Session continues (transport untouched) | Nothing | No | No |
| Transport restart within session | Resume: `reconnect=1` → ReconnectResponse → ICE restart; **same sid** | Server log / analytics only; **no webhook** | No (at most a quality dip) |
| Full rebuild | New join; old sid → `participant_left` (`DUPLICATE_IDENTITY`, or `CONNECTION_TIMEOUT` if the old one had already died) → `participant_joined` with a **new sid** | Yes (webhooks) | SDK-dependent (§4) |
| Never recovers | `participant_left CONNECTION_TIMEOUT` ~20.8 s after loss, no subsequent join | Yes | Yes (~23 s with lk) |

**Measurement consequence:** "transport restart within session" leaves no trace in
webhooks or the state API. Classifying it needs the server debug log (`ICERestart`,
resume), a client-side hook, or the analytics stream. It is the most important regime,
and it is the one the standard server surface hides.
