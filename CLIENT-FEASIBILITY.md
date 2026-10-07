# Client-side feasibility: can one client policy drive both stacks? (2026-09-29)

No client code has been written. Sources were read at pinned versions:
- **livekit-client (client-sdk-js) v2.22.3**, the latest release; built against
  `@livekit/protocol` 1.50.4.
- **livekit-server v1.13.7**, the deployed version; protocol `a4f4b5c`.
- **janus-gateway v1.4.1**.
- Plus last session's probe data.

Line references are to those tags.

## Answer

**Yes, with a caveat that belongs to the study rather than blocking it.** One client policy
can drive both stacks.

- **LiveKit:** the SDK's automatic reconnection cannot be switched off cleanly, but it can be
  **neutralised and driven** through a small number of runtime hooks on the pinned SDK. A
  from-scratch LiveKit client is feasible but costly, and I recommend against it.
- **Janus:** has no client policy to fight. A thin raw-API client does everything.

**The caveat is not about the client.** The two servers offer **different recovery
primitives**:
- LiveKit's only in-session transport restart is *resume*: a signal reconnect plus an ICE
  restart, bundled as one unit.
- Janus separates an ICE restart (signalling intact) from a signalling re-attach (`claim`).
  `claim` is only possible if `reclaim_session_timeout > 0`.

A constant client policy therefore maps to the nearest primitive each server permits. That
difference **is** what Option A measures.

## Q1. Can the LiveKit SDK's reconnection be disabled?

**Partly. There is an official switch, but it does not do what we need.**

- `RoomOptions.reconnectPolicy` (`src/options.ts:70`, `src/room/ReconnectPolicy.ts`) is
  consulted once per detected disruption in `RTCEngine.handleDisconnect`
  (`src/room/RTCEngine.ts:1174`).
- Returning `null` means **give up**: it emits `Disconnected` and runs `close()`, tearing down
  the whole session (`:1184-1201`). So "disabled" means *the SDK kills the session at the
  first disruption it notices*. It does not mean *the SDK stands back while we drive*.
- It does not control **what kind** of reconnect happens. Resume versus full reconnect is
  decided internally by `fullReconnectOnNext`. That flag is set by:
  - a server `LeaveRequest{RECONNECT}` (`:774`);
  - connection-quality LOST for 10 s while publishing (`:1258`);
  - the reconcile watchdog (`:1285`);
  - negotiation failure (`:1826`);
  - `resumeConnection=DISABLED` in client configuration, or a PC in state NEW (`:1305-1311`).
- It is **bypassed** in two places:
  1. A server `LeaveRequest{RESUME|RECONNECT}` forces delay 0 regardless of the policy's
     delay (`:1203-1205`). Only `null` stops it.
  2. The browser `online` event calls `attemptReconnect` directly, without asking the policy
     (`:1990-2005`; listeners at `:2030-2031`).
- The SDK also has **its own detection timers**, and these are client behaviour the server can
  see:
  - signal ping timeout: the value comes from the server's JoinResponse (15 s). When it fires,
    the SDK closes the signal WebSocket (`src/api/SignalClient.ts:1130-1143`);
  - PC `failed`;
  - quality LOST for 10 s.

**What does work: a "driven SDK" on the pinned v2.22.3.** Everything needed is reachable at
runtime:
- `room.engine` is a public field (`Room.ts:172`).
- `engine.client` (the SignalClient) is public (`RTCEngine.ts:141`).
- `engine.fullReconnectOnNext` is public (`:147`).
- `attemptReconnect`, `resumeConnection`, and `restartConnection` are private only at the
  TypeScript level; they are callable at runtime.

The recipe:
1. `reconnectPolicy` returns a very large delay (not `null`), so the SDK never retries on its
   own and never closes.
2. Wrap `engine.client.onLeave`. Server RESUME/RECONNECT requests are **recorded**; obeying
   them becomes a policy parameter.
3. Don't use browser offline emulation for isolation, or remove the `online`/`offline`
   listeners.
4. Set the SDK's ping timeout from the policy, e.g. override `pingTimeoutDuration`, so "close
   signalling after N s without a reply" is a held-constant parameter mirrored on Janus.
5. The driver performs actions explicitly: set `engine.fullReconnectOnNext`, then call
   `engine.attemptReconnect(reason)`. This gives resume or full reconnect at the moments the
   policy chooses.

The SDK has **no autonomous ICE restart** outside that path: `triggerIceRestart` is called only
from `resumeConnection` (`:1499`) and on a config update. So nothing else acts behind the
driver's back.

**Cost and risk.** The work is roughly 100–200 lines of hooks. It relies on private internals,
so it is **tied to exactly v2.22.3**. An upgrade means re-auditing the lines above. It must be
proven by a short spike before any study code is built on it (see "Next step").

## Q2. Bypassing the LiveKit SDK: is a minimal client realistic?

**Feasible, but it is "reimplementing significant protocol", and it weakens the study.**

The server (`pkg/rtc/signalling/signalhandler.go`) handles 20 `SignalRequest` types over a
protobuf WebSocket. A minimal client able to join, publish, subscribe, and resume must
implement:
- the join URL and parameters, including the `join_request` wrapped form and `protocol`
  version (`pkg/service/rtcservice.go:152-260`);
- **single- or dual-PC mode**, which the server selects;
- a subscriber PC answering server offers;
- `AddTrackRequest` before the publisher offer;
- trickle in both directions;
- ping/pong;
- data channels;
- for **resume**: `reconnect=1&sid=`, handling `ReconnectResponse`, an ICE restart on both PCs,
  and **`SyncState` reconciliation** of subscriptions, published tracks, and offer/answer and
  data-channel state.

Messages can come from the `@livekit/protocol` npm package, so no hand-encoding is needed. The
state machine, and especially `SyncState`, is where "the server assumes SDK behaviour": a
resume that does not reproduce what the SDK sends may be refused or half-restored in ways that
are **artefacts of our client**. Estimate: 600–1000 lines, plus debugging against a server
whose tolerances are undocumented.

**Weakness:** the study would then measure the server against a client nobody ships, and a
reviewer can reasonably ask whether a denied resume was the server or our `SyncState`. The
driven SDK keeps the SDK's own, production-tested protocol code and replaces only its
*decisions*.

## Q3. Janus: minimal client

**Straightforward.** Janus has no client-side policy. `janus.js` adds only a 25 s keepalive and
a manual `reconnect()`, and last session's source review found no automatic media recovery. A
raw WebSocket-API client plus the browser's `RTCPeerConnection` is about 300–400 lines. It
covers:
- session, handle, and keepalive (keepalive cadence is a policy parameter);
- publish: `join` as publisher, then `configure` with an offer;
- subscribe: `join` as subscriber, receive the offer, send the answer, `start`;
- **ICE restart in-session:**
  - publisher: a new offer with `iceRestart`, then `configure`;
  - subscriber: `configure {restart:true}`, receive the new offer, answer;
- **signalling re-attach:** `claim` on a new WebSocket. It works only if
  `reclaim_session_timeout > 0`; the deployment has 0, and the probe got 458;
- **rejoin:** a new session. The same feed id is refused with 436 until the old session dies
  (0 s after the WS closes, 60 s if the old session goes silent). Whether to reuse the id is a
  policy parameter.

I recommend a raw client over `janus.js`, so that both stacks are driven by the same small
driver, with no library logic on either side.

## The constant policy, and how it maps

A single driver state machine, parameterised once and run unchanged on both stacks:

| Policy element | LiveKit (driven SDK) | Janus (raw client) |
|---|---|---|
| Detect: signalling dead after N s without a reply | SDK ping timeout set to N | keepalive plus a reply timeout of N |
| Detect: media dead | driver-owned (ICE state plus in-band media age), not SDK events | same |
| Action: wait, no action | policy delay plus leave-interception | do nothing |
| Action: transport restart, same session | **resume** (signal reconnect **+** ICE restart, bundled by the server) | **ICE restart** (signalling intact); plus **claim** if the WS is dead, which needs reclaim>0 |
| Action: rebuild | full reconnect / fresh join (server evicts the old sid, `DUPLICATE_IDENTITY`) | new session; same feed id → 436 until the old one dies |
| Obey server "please resume/reconnect" | policy switch (on `onLeave`) | n/a: Janus sends no such request (only `hangup`/`ice-failed` events) |
| Give up | stop driving, `disconnect()` | `destroy` |

The rows where the columns differ are **server-imposed** differences in permitted primitives.
They are findings, not client artefacts, as long as the driver's decisions and timings are
identical.

**Server config becomes an explicit variable.** Janus `reclaim_session_timeout` decides
whether "signalling re-attach" exists at all. The study must choose a value, or sweep it.
LiveKit's equivalent window (~20.8 s) is hard-coded.

## Addressed from the last session

### 1. The server does not report LiveKit's transport-restart regime. Does that collapse A and B?

**No, but it forces a precise definition of "what the server reports".**

- Client instrumentation is **measurement**; Option A constrains client **behaviour**. A
  driver that logs its own actions, plus the in-band media clock from the 2026-09-28
  fresh-media work, is identical on both stacks. So instrumentation does not reintroduce SDK
  differences.
- The key point is that **the server's decision is visible at the protocol level even where it
  is not in webhooks or the state API.**
  - A resume attempt gets either a `ReconnectResponse` (permitted, same sid) or a
    `LeaveRequest{RECONNECT, STATE_MISMATCH}` (refused).
  - The server's own `LeaveRequest{RESUME}` after a transport failure is the server
    *initiating* a regime.
- So record **raw signalling responses** as a first-class server-report channel, alongside
  webhooks, the Janus event handler, and the server debug log (ms timestamps, `ICERestart` /
  resume lines).
- **Design consequence:** the outcome measure is triangulated from three sources: server
  surfaces, raw protocol replies to the driver, and client media freshness.
  - "Server-visible regime" and "client-experienced regime" are reported **separately**.
  - For LiveKit resume they will legitimately disagree: invisible in webhooks and state, but
    visible in the protocol and the debug log. That disagreement is itself a result about
    server observability.
- Caveat: the LiveKit debug log is not a stable API; pin the server version (already done) and
  parse defensively.

### 2. Must the observer be held constant too?

**Yes.** What other participants observe is (what the server sends) filtered through (their
SDK). Last session's Go-SDK observer coalesced by identity and never surfaced the
`DUPLICATE_IDENTITY` replacement that the browser SDK's ParticipantUpdate handling would show.
To hold it constant:

- Observers run the **same client stack as the subject**: the pinned, driven livekit-client
  v2.22.3 in the same headless Chromium, and the same raw Janus client.
- Observers record at the **protocol level**, before any SDK interpretation:
  - LiveKit: wrap `window.WebSocket` in the page and decode every inbound frame with
    `@livekit/protocol` `SignalResponse`, logging each `ParticipantUpdate` entry (identity,
    sid, state, disconnect_reason) with a timestamp;
  - Janus: the raw JSON event stream, as the probe already does.
- "What others observe" is then defined as **what the server sends to others**, which is
  SDK-independent and comparable across stacks.
- SDK-level events (`ParticipantDisconnected`, and so on) can be logged as a secondary channel.
  That channel is where an Option B arm would naturally sit.

## Recommendation and next step

1. **Proceed with Option A** using a driven livekit-client v2.22.3 and a raw Janus client
   sharing one policy driver. It does **not** push us toward Option B.
2. **Before building the study client**, run a **spike** (small, about half a day; client
   code, so it needs your go-ahead). It must show that:
   - (a) with the neutralising hooks, the SDK stays passive through a 10 s isolation: no
     automatic resume or reconnect, no `close()`;
   - (b) the driver can trigger resume and full reconnect on demand;
   - (c) raw-frame logging captures `ParticipantUpdate`, `ReconnectResponse` and
     `LeaveRequest`;
   - (d) nothing else reconnects behind the driver's back.

   If (a) or (d) fails, the fallback is a minimal protocol client (Q2 cost) or Option B.
3. **Decide Janus `reclaim_session_timeout`**: 0 (current) vs a value such as 30 s vs a sweep.
   It determines whether the "signalling re-attach" row exists for Janus.
4. The isolation mechanism must **not** use browser offline emulation, because the SDK's
   `online` handler bypasses the policy. Isolate at the network layer instead.

**Effort once the spike passes (rough):**

| Component | Estimate |
|---|---|
| Shared policy driver plus instrumentation | 1–2 days |
| LiveKit driven client | about 1 day |
| Janus raw client | about 1 day |
| Observers (same stacks plus raw logging) | about 0.5 day |
