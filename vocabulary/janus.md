# Janus (VideoRoom) participant-lifecycle vocabulary (ground truth, gate one)

**Deployment:**
- Janus **1.4.1**, Debian build `1.4.1+ds-4+b2` (arm64), from `snapshot.debian.org`
  `20260928T000000Z` in stock `debian:sid-slim@sha256:ec3fa4e0…`, namespace `c4-janus`.
- Server-reported timers (`vocabulary/janus-server-info.json`): `session-timeout` 60,
  `reclaim-session-timeout` 0, `candidates-timeout` 45, `ice-consent-freshness` false,
  `hangup-on-failed` false, `ice-nomination` aggressive.
- Event handler: `janus.eventhandler.sampleevh`, `events="all"`, `grouping=false`, POSTing
  to the in-namespace sink.
- VideoRoom room 1234 (config-defined, `notify_joining=true`).

**Probe (2026-09-29 05:55:30–05:57:09 UTC):** `probes/janus-probe.mjs` in a Node 24 pod.
- Raw JSON over the WebSocket API, signalling only, **no PeerConnection, no media**.
- A signalling-only observer (feed id 9001) sat in the room and kept its session alive.

**Raw data:** `probes/raw/janus-probe.jsonl` (every client message), `probes/raw/janus-events.jsonl`
(event-handler stream). Examples: `payloads/janus-evh-examples.json`,
`payloads/janus-client-examples.json`.

**Status legend:**
- **OBSERVED:** seen on this deployment.
- **DOCS-ONLY:** from `janus-docs.md` (source at v1.4.1). Not exercised because it needs a
  PeerConnection or media, out of scope for this phase.

## 1. What the server emits (event handler, sampleevh)

Envelope: `{emitter, type, [subtype], timestamp (µs, wall clock), [session_id], [handle_id], event}`.

| type | `event` | Fires when | Status |
|---|---|---|---|
| 128 transport | `{transport:"janus.transport.websockets", id, data:{event:"connected", ip}}` | WS connected | OBSERVED |
| 128 transport | `{…, data:{event:"disconnected"}}` | WS closed | OBSERVED |
| 1 session | `{name:"created", transport:{transport,id}}` | `create` | OBSERVED |
| 1 session | `{name:"destroyed"}` | `destroy` request, **or the WS closed** (reclaim=0) | OBSERVED (both paths) |
| 1 session | `{name:"timeout"}` | No request for `session_timeout` | OBSERVED: **60.045 s** after last request |
| 2 handle | `{name:"attached"/"detached", plugin}` | attach, detach, or any session teardown | OBSERVED |
| 64 plugin | `data:{event:"joined", room, id, private_id, display}` | Participant joined the room | OBSERVED |
| 64 plugin | `data:{event:"leaving", room, id, display}` | leave, detach, or session teardown | OBSERVED |
| 64 plugin | `data:{event:"unpublished", room, id, display}` | Session torn down (WS close or timeout), **even for a participant that never published** | OBSERVED |
| 256 core | `{status:"started"}`, then `{status:"update", info:{sessions, handles, …}}` every 15 s | Server status | OBSERVED |
| 128 transport | `{transport:"janus.transport.http", data:{event:"request", admin_api}}` | Every HTTP / Admin API request | OBSERVED |
| 16 webrtc | ICE states, `selected-pair`, DTLS states, `connection:"webrtcup"` / `connection:"hangup", reason` | PeerConnection lifecycle | DOCS-ONLY |
| 32 media | `receiving:true/false`, `slow_link`, periodic stats | Media flow | DOCS-ONLY |
| 64 plugin | `published`, `configured`, `subscribing`, `subscribed`, `kicked`, … | Publishing/subscribing | DOCS-ONLY |

**Observed ordering (same millisecond, event-handler timestamps):**

| Cause | Order |
|---|---|
| Graceful (`leave`, then `detach`, then `destroy`) | plugin `leaving` → (at detach) handle `detached` → (at destroy) session `destroyed` → (at WS close) transport `disconnected` |
| WS closed, no leave | transport `disconnected` → session `destroyed` → plugin `unpublished` → plugin `leaving` → handle `detached` (all within the same millisecond) |
| Silent session | session `timeout` → plugin `unpublished` → plugin `leaving` → handle `detached`. **The WS stays open**; no transport event |

**Correlation hazards (observed):**
- Plugin `leaving`/`unpublished` events carry **no `session_id` or `handle_id`**. They
  correlate to a participant only by `room` + feed `id`.
- The WebSocket transport `id` is **reused across different connections** (`…6619` served
  p1, p2, p3b and the claim connection). It identifies a connection only at a given instant,
  not over time. This corrects the docs note that it "lets WS closes be joined to sessions".
- A **rejected join (436) and a failed `claim` (458) produce no event-handler event.** Only
  the client sees them.

## 2. What the participant itself sees (client-side API messages)

| Situation | Message | Status |
|---|---|---|
| Joined | `event` `videoroom:"joined"`, with `publishers[]` and `attendees[]` (attendees because `notify_joining`) | OBSERVED |
| Own `leave` | `event` `leaving:"ok"` | OBSERVED |
| Own `detach` | `success`, then `detached` | OBSERVED |
| Session timed out | `{"janus":"timeout"}` on the still-open WS. **Nothing closes the WS server-side** (janus.js would close it itself, per docs) | OBSERVED |
| Rejoin with a feed id still present | `event` `{"error_code":436, "error":"User ID 1003 already exists"}`. **The old participant is not evicted** | OBSERVED |
| `claim` after the WS closed (reclaim=0) | `{"janus":"error","error":{"code":458,"reason":"No such session <id>"}}` | OBSERVED |
| PC events: `webrtcup`, `media`, `slowlink`, `hangup{reason}`, `ice-failed` | DOCS-ONLY |

## 3. What other participants see (VideoRoom events to a joined observer)

| Scenario | Observer receives | Latency | Status |
|---|---|---|---|
| Join (room `notify_joining=true`) | `event` `joining:{id, display}` | ≤1 ms | OBSERVED |
| Graceful `leave` | `event` `leaving:<id>` **only**. No `unpublished` (source reading confirmed; docs are wrong) | 1 ms | OBSERVED |
| WS closed without leave | `event` `unpublished:<id>`, then `leaving:<id>` | **0 ms** (same ms as the close) | OBSERVED |
| Silent session | `unpublished:<id>`, then `leaving:<id>` | **60.05 s** after the last request | OBSERVED |
| Same feed id attempts to rejoin while the old one is alive | **Nothing.** The observer is not told of the failed attempt | none | OBSERVED |
| Same feed id rejoins after the old one is gone | `joining:{id, display}` (the new display name) | ≤1 ms | OBSERVED |
| Publisher PC hangup (ICE failed or DTLS) | `unpublished:<id>` **without** `leaving`; participant stays with `publisher:false` | none | DOCS-ONLY |
| A `publishers` list when someone starts publishing | none | none | DOCS-ONLY |

`listparticipants` returns `publisher` as a **JSON boolean** (observed `false`). The docs
show it as a string.

## 4. Candidate recovery regimes as Janus expresses them

| Regime | Janus signature | Server-visible? | Others-visible? |
|---|---|---|---|
| Session continues | Nothing (media events only) | media events (DOCS-ONLY) | No |
| Transport (PC) restart within session | App sends `configure` + offer with new ICE credentials (publisher) or `configure {restart:true}` (subscriber). Same session, handle, and feed id | jsep + webrtc events (DOCS-ONLY) | No, unless the streams change |
| Signalling restart within session | `claim` on a new WS. **Impossible with `reclaim_session_timeout=0`** (observed 458). Needs reclaim>0, which is a server config choice | n/a in this config | n/a |
| Full rebuild | New session and handle, rejoin. **The same feed id is refused (436) until the old session dies**: immediately on WS close, 60 s if the old WS stays up silently | yes | `leaving` (+`unpublished`) then `joining` |
| Never recovers | Session destroyed (WS close: instant; silence: 60 s); **or, per docs, a publisher whose network silently vanishes while its WS stays up may linger with no event** (no consent freshness, no hangup_on_failed) | depends | depends |

**Measurement consequence.** Janus exposes rich, microsecond-stamped server events, but
**which regime happens is decided by the application**: whether it ICE-restarts, claims,
or rejoins; its keepalive cadence; and whether it reuses the feed id. Two server knobs
decide what is even possible:
- `reclaim_session_timeout` (0 means claim is impossible);
- `session_timeout` (the ceiling on how long a zombie participant blocks its feed id).

Both are set explicitly in `deploy/janus/configmap.yaml` and must be treated as
independent variables, not defaults.
