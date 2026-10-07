# Spike report: driven livekit-client v2.22.3, plus DC-4 verification (2026-09-29)

**Verdict: PASS on all four criteria, n=1.** The driven SDK stays passive and acts only
when the driver tells it to. Option A is buildable on LiveKit without reimplementing the
protocol. Gaps and caveats are listed at the end, and they matter for the study client.

## Setup
- **LiveKit:** server v1.13.7 (pod `10.42.31.161`, SFU node `ip-10-42-24-68`).
- **Clients:** two pods in namespace `c4-clients` on the other node (`ip-10-42-11-245`,
  with coturn), required anti-affinity to both SFUs.
  - Image: `mcr.microsoft.com/playwright` v1.62.1-noble (by digest), headless Chromium.
  - SDK: livekit-client **2.22.3** from npm.
- **Participants:**
  - `subj` publishes a Web Audio tone and is isolated.
  - `obs` subscribes, is never isolated, and runs the same driven SDK.
- **Isolation (DC-5):** `iptables` DROP in the subject pod's own network namespace
  (`NET_ADMIN`), matching the SFU pod IP. Two modes:
  - `all`: signalling and media;
  - `media`: UDP plus ICE-TCP 31881; signalling TCP 31880 untouched.
- **Driver policy:**
  - `reconnectPolicy` returns 86,400,000 ms: never retry on its own, never give up;
  - `signalTimeoutS = 20`: deliberately different from the server's 15;
  - `obeyServerResume = obeyServerReconnect = false`;
  - `onLeave` is re-wrapped on every signal (re)setup;
  - the `online`/`offline` listeners are removed.
- **Raw frames:** captured by a `WebSocket` subclass in the page and decoded offline with
  `@livekit/protocol` **1.50.4** (the SDK's own version).
- **Files:** `spike/`, `spike/out/{subject,observer}.{json,log}`, `spike/out/decoded.txt`,
  `logs/spike/`.
- **Attempt 1** never ran: the subject pod stayed Pending on "Insufficient cpu". The client
  node had 1490m of 1930m CPU requested. Client requests were lowered 500m → 250m;
  attempt 2 ran.

## Results (subject time, s)

| Step | What happened | Criterion |
|---|---|---|
| T1: 10 s full isolation (8.49–18.57) | **No SDK reaction at all**: no policy consult, no engine call, no SDK events. Pings went unanswered; 3 queued pongs arrived at 24.08, 5.5 s after restore (TCP backoff). Same sid. Observer saw nothing. | **(a) PASS** |
| T1b: driver resume, healthy | WS#1 closed → WS#2 `reconnect=1` → **`ReconnectResponse`** → `SyncState` → ICE restart → `Reconnected`. **Same sid.** Observer saw nothing: resume is invisible to others. | **(b) PASS** (resume) |
| T2: 25 s full isolation (58.62–83.69) | Policy consulted 3×, each returning the passive delay:<br>• **PC failed** at +16.0 s (Chrome ICE);<br>• **ping timeout at 78.60 = exactly 20.00 s after the last pong** (ours, not the server's 15);<br>• the **reconcile watchdog** ("detected connection state mismatch, attempting full reconnect") at 86.61.<br>**No attempt, no close.** The server removed the participant: observer got `DISCONNECTED(CONNECTION_TIMEOUT)` at +21.9 s. WS#2 closed 1006 after restore. | **(d) PASS** |
| T2b: driver resume against the removed session | Server answered **`LeaveRequest{RECONNECT, STATE_MISMATCH}`** during the handshake. The attempt failed; the SDK set full-reconnect-next and consulted the policy, getting the passive delay. **No automatic full reconnect.** | (d) PASS; server refusal captured |
| T2c: driver full reconnect | `restartConnection` → fresh join → **new sid** `PA_dXvT…`. Track republished. Observer saw the new sid `ACTIVE`. | **(b) PASS** (full) |
| T4: 25 s **media-only** isolation (119.77–144.86), signalling up | PC failed at +15.5 s (policy → passive). **The server sent `LeaveRequest{RESUME, CONNECTION_TIMEOUT}` at +16.45 s over the live signal, then closed the WS.** Intercepted: `obeyed:false`. **The SDK did not resume.** Observer: `DISCONNECTED(CONNECTION_TIMEOUT)` at +21.4 s. | **(d) PASS**: the most important escape hatch is neutralised |
| T3: driver full reconnect | New sid `PA_TyQV…`. Observer: `JOINED` → `ACTIVE`. | (b) |
| End: driver leave | `close` attributed to the driver. Observer: `DISCONNECTED(CLIENT_INITIATED)`. | |

- **Violations** (reconnect or close entered without the driver): **0 subject, 0 observer.**
- **(c) PASS:** raw frames captured `ParticipantUpdate` (including `JOINED`/`ACTIVE`/
  `DISCONNECTED(reason)`), `ReconnectResponse`, and `LeaveRequest` RESUME and RECONNECT.

## What this also established about the LiveKit server

1. **The server initiates a regime.** When media dies but signalling is alive, it asks the
   client to **RESUME** at ~16.5 s, then closes signalling, then removes the participant at
   ~21 s. Whether the client obeys is a policy switch, and it must be a documented part of
   the held-constant policy.
2. **Resume is invisible to other participants**, confirmed at protocol level: no
   `ParticipantUpdate` at all.
3. **Server refusal is observable only at protocol level.** It arrives as a handshake-time
   `LeaveRequest{RECONNECT, STATE_MISMATCH}` and never reaches `onLeave`; the SDK turns it
   into a failed attempt and **swallows the error** (`attemptReconnect` resolved with no
   error).

## DC-4 verification (Janus `reclaim_session_timeout = 30`)

- **Server reports it:** `server_info` shows `"reclaim-session-timeout": 30`,
  `"session-timeout": 60`.
- **J4, claim 0.5 s after WS close:** **success.** The observer saw **nothing** (no
  `unpublished`/`leaving`). The event handler shows only a transport `connected`; there is
  no "claimed" event.
- **J5, WS closed, no claim:**
  - last request 22:43.767, WS closed 22:51.770;
  - session reaped with event **`timeout`** (not `destroyed`) at 23:14.134;
  - that is **30.37 s after the last request, 22.36 s after the WS close**;
  - observer: `unpublished` + `leaving`;
  - late claim → **458**.
- **Consequence:** the effective re-attach window after a network loss is **30 s minus the
  time since the client's last request.** The client keepalive interval is therefore part
  of the held-constant policy. I suggest ≤5 s, giving a 25–30 s window.

## Gaps and caveats (carry into the study client)

1. **n = 1.** One run. The timings (+16.0, +16.45, +20.00, +21.4–21.9 s) are single
   observations.
2. **The driver must own the connection state.**
   - After the server removed the subject, `room.state` still read `connected`, with signal
     state DISCONNECTED (T2_passive, T4_passive).
   - A failed driver resume returned no error.
   - The driver has to judge outcomes from raw frames and engine signals, not from
     `room.state` or promise results.
3. **Not exercised:**
   - a **full reconnect on a still-healthy session** (both full reconnects ran after the
     server had already removed the subject). Per source it sends a Leave first; untested
     here;
   - the **`rejoin` path after a delivered `DISCONNECT`**. The server's DISCONNECT was never
     delivered because it closed the signal first, so the pass-through-then-`room.connect()`
     branch did not run.
4. **Dependence on private internals** (`attemptReconnect`, `setupSignalClientCallbacks`,
   `pingTimeoutDuration`, `handleBrowserOnLine`): the approach is valid only for
   livekit-client **2.22.3**. Any upgrade requires re-running this spike.
5. SDK warning `failed to remove track … InvalidAccessError` on each full reconnect
   (cleanup against the closed PC). The republish still succeeded (`addTrack` →
   `trackPublished`). Harmless here; worth watching once media is measured.
6. **Capacity:** the non-SFU node already had 1490m/1930m CPU requested (coturn +
   monitoring) before any client. **Three participants plus coturn will not fit on one
   c7g.large next to the monitoring stack.** The study will need a third node, lighter
   client requests, or monitoring moved. This interacts with DC-3.
