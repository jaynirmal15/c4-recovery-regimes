# LiveKit participant-lifecycle vocabulary

> **SOURCE: documentation/source code only — not yet verified against the running deployment.**

| Item | Value |
|---|---|
| Date | 2026-09-29 |
| Server | livekit-server **v1.13.7** (Helm chart livekit/livekit-server 1.9.0) |
| Protocol | github.com/livekit/protocol **a4f4b5c0c23f167d0c07de1e1d7652125882e73c** (pseudo-version `v1.51.1-0.20260905133529-a4f4b5c0c23f`, the version pinned in v1.13.7's `go.mod`) |
| Client SDK | client-sdk-js **v2.22.3** (latest release, published 2026-09-07; `protocolVersion = 17`) |
| CLI | lk v2.18.8. Not analysed: it drives sessions through server-sdk-go, not client-sdk-js |

URL prefixes used below:
- `LK` = https://github.com/livekit/livekit/blob/v1.13.7/
- `PROTO` = https://github.com/livekit/protocol/blob/a4f4b5c0c23f167d0c07de1e1d7652125882e73c/
- `JS` = https://github.com/livekit/client-sdk-js/blob/v2.22.3/

Claims come from source unless marked **[docs]**. Anything marked **Inference** is my reading and is not stated in code or docs.

---

## 1. Server webhooks

Constants are in `PROTO/webhook/consts.go#L37-L51`. The message is `WebhookEvent` in `PROTO/protobufs/livekit_webhook.proto#L27-L62`.

| `event` | Fired from (LK) | When | Payload fields set |
|---|---|---|---|
| `room_started` | `pkg/telemetry/events.go#L45-L58` | Room created | `room` |
| `room_finished` | `pkg/telemetry/events.go#L60-L78` | Room closed | `room`, `room_end_reason` (RoomEndReason, see below) |
| `participant_joined` | `pkg/telemetry/events.go#L110-L127` (`ParticipantActive`) | **When the participant becomes ACTIVE (ICE/PC connected), not on WS join.** Code comment: "a participant is considered "joined" only when they become "active"". Suppressed when `isMigration` | `room`, `participant` (ParticipantInfo) |
| `participant_left` | `pkg/telemetry/events.go#L196-L240` (`ParticipantLeft`) | Participant session closed, and its stats worker had reached connected (`worker.IsConnected()`) | `room`, `participant` (includes `state=DISCONNECTED` and `disconnect_reason`) |
| `participant_connection_aborted` | same function, `#L225-L229` | Same trigger, but the participant **never became connected** (its worker was never `SetConnected`) | `room`, `participant` |
| `track_published` | `pkg/telemetry/events.go#L263-L297` | Track published | `room`, `participant` (**only `sid` and `identity`**), `track` |
| `track_unpublished` | `pkg/telemetry/events.go#~L405-L420` | Track unpublished (including on participant close) | `room`, `participant`, `track` |
| `egress_started/updated/ended` | `pkg/telemetry/events.go#L495-L515` | Egress | `egress_info` |
| `ingress_started/ended` | `pkg/telemetry/events.go#L530-L560` | Ingress | `ingress_info` |
| `agent_job_started/ended` | consts only | Agents | `job` |

Common fields on every event: `id` (uuid) and `created_at` (seconds).

**No webhook exists for resume, reconnect, or transport loss.** A resume only produces an *analytics* event, `PARTICIPANT_RESUMED`, with `ReconnectReason` in `ClientMeta` (`LK/pkg/telemetry/events.go#L137-L170`). The webhook stream never contains it. A full reconnect with the same identity looks like `participant_left` (reason `DUPLICATE_IDENTITY`, see §2.4) followed by `participant_joined` with a **new `sid`**.

### 1.1 ParticipantInfo lifecycle fields
Defined in `PROTO/protobufs/livekit_models.proto#L135-L207`.

| Field | Notes |
|---|---|
| `sid` | Per-session ID. It changes on a full reconnect and is kept on a resume. |
| `identity` | Stable user key. The room map is keyed by identity (`LK/pkg/rtc/room.go#L492`). |
| `state` | `JOINING=0` (WS connected, no offer yet), `JOINED=1` (server received the offer), `ACTIVE=2` (ICE connected), `DISCONNECTED=3` (proto comment says "WS disconnected"; in source this state is set on participant **close**) |
| `joined_at` (s), `joined_at_ms` | Join timestamp |
| `is_publisher` | Has an active publisher PC |
| `kind`, `kind_details` | STANDARD, INGRESS, EGRESS, SIP, AGENT, CONNECTOR, BRIDGE |
| `disconnect_reason` (field 16) | Filled from `CloseReason().ToDisconnectReason()` (`LK/pkg/rtc/participant.go#L963`) |
| `client_protocol`, `capabilities` | Client feature detection |

### 1.2 DisconnectReason, full enum
From `PROTO/protobufs/livekit_models.proto#L702-L736`. The mapping from the server-internal `ParticipantCloseReason` is in `LK/pkg/rtc/types/interfaces.go#L190-L228`.

| # | Name | Proto meaning | Internal close reasons that map here (v1.13.7) |
|---|---|---|---|
| 0 | UNKNOWN_REASON | none | Everything else |
| 1 | CLIENT_INITIATED | Client initiated the disconnect | ClientRequestLeave, SimulateLeaveRequest |
| 2 | DUPLICATE_IDENTITY | Another participant with the same identity joined | DuplicateIdentity, Stale |
| 3 | SERVER_SHUTDOWN | Server instance shutting down | RoomManagerStop, SimulateNodeFailure, SimulateServerLeave |
| 4 | PARTICIPANT_REMOVED | RoomService.RemoveParticipant was called | ServiceRequestRemoveParticipant |
| 5 | ROOM_DELETED | RoomService.DeleteRoom was called | ServiceRequestDeleteRoom |
| 6 | STATE_MISMATCH | Client tried to resume a session the server does not know | NegotiateFailed, PublicationError, SubscriptionError, DataChannelError, MigrateCodecMismatch, MoveFailed; also sent directly on a failed resume (§3.2) |
| 7 | JOIN_FAILURE | Client could not connect fully | VerifyFailed, JoinFailed, **JoinTimeout**, MessageBusFailed |
| 8 | MIGRATION | Cloud-only migration | MigrationRequested/Complete, SimulateMigration |
| 9 | SIGNAL_CLOSE | Signal websocket closed unexpectedly | SignalSourceClose. Only used when the WS closes **before ICE ever connected** (§2.3) |
| 10 | ROOM_CLOSED | All Standard and Ingress participants left | RoomClosed |
| 11–13 | USER_UNAVAILABLE / USER_REJECTED / SIP_TRUNK_FAILURE | SIP | none |
| 14 | CONNECTION_TIMEOUT | Server timed out a participant session | **PeerConnectionDisconnected**. This is the transport-loss reason (§2.3) |
| 15 | MEDIA_FAILURE | Media stream failure or timeout | None found in v1.13.7 `ToDisconnectReason` |
| 16 | AGENT_ERROR | Agent error | AgentError |

`IsIntentionalDisconnect` treats 1, 2, 3, 4, 5, 8, and 10 as intentional; everything else counts as a failure (`LK/pkg/rtc/types/interfaces.go#L232-L246`).

`RoomEndReason` for `room_finished`, from `PROTO/.../livekit_models.proto#L739-L752`: `ROOM_END_UNKNOWN`, `ROOM_END_API_DELETE`, `ROOM_END_IDLE_TIMEOUT` (empty or departure timeout), `ROOM_END_SERVER_SHUTDOWN`, `ROOM_END_SUPERSEDED`, `ROOM_END_OPEN_FAILED`.

---

## 2. Server timers and config that decide the regime (v1.13.7 defaults)

### 2.1 Config keys (YAML)
Sources: `LK/pkg/config/config.go#L236-L250` (struct) and `#L576-L577` (defaults).

| Key | Default | Meaning |
|---|---|---|
| `room.empty_timeout` | **300 s** | Close the room if nobody ever joined within this time since creation (`LK/pkg/rtc/room.go#L774-L805`) |
| `room.departure_timeout` | **20 s** | Close the room this long after the **last participant left**, once it has had participants. Comment: "need to give time in case participant is reconnecting" (`room.go#L791-L795`) |
| `rtc.reconnect_on_publication_error` / `_subscription_error` / `_data_channel_error` | nil (unset) | Force a full reconnect on these errors (`config.go#L160-L167`) |
| `rtc.allow_tcp_fallback`, `tcp_fallback_rtt_threshold`, `allow_udp_unstable_fallback` | nil / 0 / false | Candidate-type fallback after an ICE failure. Skipped when signalling is not recent or not valid (`LK/pkg/rtc/transportmanager.go#L782-L806`) |

Repo cross-reference, taken from `deploy/livekit/values.yaml` and not from the running pod: no `room:` overrides are set, so the defaults of 300 s and 20 s apply.

### 2.2 Hard-coded constants (not configurable)

| Constant | Value | Source (LK) | Effect |
|---|---|---|---|
| `PingIntervalSeconds` / `PingTimeoutSeconds` | **5 / 15** | `pkg/rtc/participant.go#L88-L89`; sent in JoinResponse `ping_interval` / `ping_timeout` (`pkg/rtc/room.go#L1064-L1065`) | Client sends a Ping every 5 s and declares signal loss after 15 s with no Pong (§4.3) |
| WS control ping | every 10 s, 2 s write deadline | `pkg/service/wsprotocol.go#L37-L39, #L222-L237` | Keeps the connection alive only. **No read deadline or pong check** on the signal WS, so the server learns of WS loss only from TCP close or error. That is an inference from the absence of `SetReadDeadline` in the signal path. |
| `iceDisconnectedTimeout` | **10 s** | `pkg/rtc/transport.go#L81` | pion ICE: time without connectivity before `disconnected` |
| `iceFailedTimeout` | **5 s** | `transport.go#L82` | `disconnected` → `failed` |
| `iceFailedTimeoutTotal` | 15 s | `transport.go#L83` | Also used as `subscriptionTimeout` (`pkg/rtc/subscriptionmanager.go#L42-L45`) |
| `iceKeepaliveInterval` | 2 s | `transport.go#L84` | pion keepalive |
| `negotiationFailedTimeout` | 15 s | `transport.go#L77` | Offer/answer stall → negotiation failed → full reconnect |
| `dtlsHandshakeTimeout` | 1 min | `transport.go#L79` | none |
| `min/maxConnectTimeoutAfterICE` | 10 s / 20 s | `transport.go#L88-L89` | ICE connected but PC not fully established → failure |
| `disconnectCleanupDuration` | **5 s** | `pkg/rtc/participant.go#L77` | Grace period after a transport failure before the participant is closed (§2.3) |
| `migrationWaitDuration` | 3 s | `participant.go#L78` | Migration only |
| Join verify timeout | **1 min** | `pkg/rtc/room.go#L499-L503` | Participant not verified → removed with JoinTimeout → `JOIN_FAILURE` |
| Token refresh | 5 min | `pkg/service/roommanager.go#L62` | none |
| Connection-quality update interval | 5 s | `pkg/sfu/connectionquality/connectionstats.go#L34` | LOST is score ≤ 20 (`scorer.go#L52`) |

### 2.3 What the server does on each kind of loss (source walk-through)

- **Signal WS closes, ICE still connected.** `rtcSessionWorker` sees `nil` from `requestSource` and calls `HandleSignalSourceClose` (`LK/pkg/service/roommanager.go#L777-L785`). That function marks the signal invalid and **closes the participant only if ICE has never connected**, giving `SIGNAL_CLOSE` (`LK/pkg/rtc/participant.go#L1039-L1044`). Otherwise the participant stays in the room: state stays ACTIVE, media keeps flowing, and nothing is broadcast. The client is expected to resume.
- **Media transport fails** (PC state `failed`, or connect-after-ICE timer, or TCP ICE timer). `PCTransport.handleConnectionFailed` → `AnyTransportHandler.OnFailed` → `onAnyTransportFailed` (`LK/pkg/rtc/transport.go#L842-L853, #L869-L884`; `participant.go#L1976-L1978, #L2756-L2774`). It then:
  1. sends `LeaveRequest{action=RESUME, reason=CONNECTION_TIMEOUT}`, but only to clients that support leave with action;
  2. closes the signal connection (`SignallingCloseReasonTransportFailure`);
  3. starts the **5 s disconnect timer**. When the timer fires, if the participant is not closed or disconnected, it runs `Close(sendLeave=true, PeerConnectionDisconnected)`, giving **`CONNECTION_TIMEOUT`** (`participant.go#L2740-L2754`).
- The timer is cleared by `ICERestart`, which is called on a successful resume (`participant.go#L1796-L1811`), or by `Close`.
- **Inference (not measured).** Taking the constants together: after a total blackout (both WS and media), the server closes the participant at about 10 s (disconnected) + 5 s (failed) + 5 s (cleanup) ≈ **20 s** after the last ICE traffic, give or take pion's 2 s keepalive granularity. Other participants then see `ParticipantDisconnected(CONNECTION_TIMEOUT)` and the webhook `participant_left`. If this was the last participant, `departure_timeout` (20 s) then closes the room.
- **Signal down but media fine, and the client never resumes.** Inference: the participant can stay indefinitely. No server timer closes a participant just because signal is missing while ICE is healthy.

### 2.4 Duplicate identity
When a join arrives **without** `reconnect=1` and a participant with the same identity exists, the server calls `room.RemoveParticipant(..., ParticipantCloseReasonDuplicateIdentity)` **before** the new session joins (`LK/pkg/service/roommanager.go#L398-L401`).

- Old session: `Close(sendLeave=true)` sends `LeaveRequest{DISCONNECT, DUPLICATE_IDENTITY}` (`LK/pkg/rtc/room.go#L1489-L1491`, `participant_signal.go#L311-L345`).
- Others: receive a ParticipantUpdate with the old `sid`, `state=DISCONNECTED`, `disconnect_reason=DUPLICATE_IDENTITY` (`room.go#L1495-L1500`). Then the new participant, with a **new sid**, appears through normal join updates.
- Webhooks: `participant_left` (old sid) then `participant_joined` (new sid, when it becomes ACTIVE).

`RemoveParticipant` ignores stale removals whose `pID` no longer matches the current session for that identity (`room.go#L1420-L1424`).

---

## 3. Signal protocol: resume vs full reconnect

Messages are in `PROTO/protobufs/livekit_rtc.proto`.

### 3.1 Join and resume requests
- **Legacy query-string path** (`LK/pkg/service/rtcservice.go#L238-L261`): `reconnect=1`, `sid=<participant sid>`, and `reconnect_reason=<int>`. `reconnect=1` means **resume**. Without it the request is a fresh join, which triggers duplicate-identity replacement if the identity is still present.
- **Wrapped path.** The `join_request` query parameter carries a base64 `WrappedJoinRequest` holding a `JoinRequest` (`livekit_rtc.proto#L634-L658`). Its fields include `reconnect` (bool), `reconnect_reason`, `participant_sid`, and `sync_state`. The client builds it in `JS/src/api/SignalClient.ts#L1364-L1398, #L1469`.
- `ReconnectReason` (`livekit_models.proto#L880-L886`): `RR_UNKNOWN=0`, `RR_SIGNAL_DISCONNECTED=1`, `RR_PUBLISHER_FAILED=2`, `RR_SUBSCRIBER_FAILED=3`, `RR_SWITCH_CANDIDATE=4`.
- `SyncState` (`SignalRequest.sync_state`, `#L505+`) is sent after a resume so the server can reconcile subscriptions and offers (`LK/pkg/service/roommanager.go#L385`).

### 3.2 Server decision on a join that carries `reconnect=1`
Source: `LK/pkg/service/roommanager.go#L326-L420`.

| Server state for that identity | Server response | Client outcome |
|---|---|---|
| Participant exists and is not closed | `ResumeParticipant`: swaps the signal sink and sends **`ReconnectResponse`** (`ice_servers`, `client_configuration`, `server_info`, `last_message_seq`; `livekit_rtc.proto#L269-L276`). Then `ICERestart` (clears the disconnect timer), analytics `PARTICIPANT_RESUMED`, `HandleSyncState` | Resume. **Same sid, and other participants see nothing.** |
| Participant exists but is closed | `LeaveRequest{action=RECONNECT, reason=STATE_MISMATCH}` | Client does a full reconnect |
| No participant with that identity | `LeaveRequest{action=RECONNECT, reason=STATE_MISMATCH}` | Client does a full reconnect |

### 3.3 LeaveRequest (server → client)
Defined in `livekit_rtc.proto#L371-L386`:
```
enum Action { DISCONNECT = 0; RESUME = 1; RECONNECT = 2; }
bool can_reconnect = 1;   // obsoleted by action from protocol 13
DisconnectReason reason = 2; Action action = 3; RegionSettings regions = 4;
```
The server builds it in `LK/pkg/rtc/participant_signal.go#L311-L345`.

| Action | Server-side trigger |
|---|---|
| RESUME | `onAnyTransportFailed` (media PC failed, §2.3) |
| RECONNECT | Unresumable resume attempt (STATE_MISMATCH); `IssueFullReconnect` (negotiation, publication, subscription, or data-channel errors) |
| DISCONNECT | Any `Close(sendLeave=true)`: duplicate identity, RemoveParticipant, room deleted or closed, server shutdown, disconnect-timer expiry (CONNECTION_TIMEOUT) |

A client can also send `LeaveRequest` in `SignalRequest.leave` for a graceful leave. That produces `CLIENT_INITIATED` (`LK/pkg/rtc/signalling/signalhandler.go#L87-L96`).

### 3.4 ParticipantUpdate
`ParticipantUpdate { repeated ParticipantInfo participants }` (`livekit_rtc.proto#L294-L296`) is sent in `SignalResponse.update`. It is the only channel through which other participants learn about joins, state changes, and departures. A departure is an entry with `state=DISCONNECTED` and a `disconnect_reason`.

Ping and Pong: `SignalRequest.ping_req` is `Ping{timestamp, rtt}`, answered by `SignalResponse.pong_resp` as `Pong{last_ping_timestamp, timestamp}` (`#L564-L573`).

---

## 4. Client SDK (client-sdk-js v2.22.3)

### 4.1 Events

**RoomEvent** (`JS/src/room/events.ts#L10-L375`), lifecycle-relevant subset with string values:

| Event (string) | Meaning or trigger |
|---|---|
| `Connected` (`connected`) | Initial connect done |
| `SignalReconnecting` (`signalReconnecting`) | **A resume attempt has started.** Emitted on `EngineEvent.Resuming` (`JS/src/room/Room.ts#L634-L641`) |
| `Reconnecting` (`reconnecting`) | Full reconnect started (`handleRestarting`, `Room.ts#L1783-L1796`), or `EngineEvent.Offline` (signal and PC both severed, `Room.ts#L661-L665`; `RTCEngine.ts#L634-L645`) |
| `Reconnected` (`reconnected`) | Resume succeeded (`EngineEvent.Resumed`, `Room.ts#L642-L651`) or full reconnect succeeded (`handleSignalRestarted`, `Room.ts#L1803-L1828`) |
| `Disconnected` (`disconnected`, arg `DisconnectReason?`) | Final. From a server `LeaveRequest{DISCONNECT}` (reason passed through), or when the SDK gives up (no reason) (`Room.ts#L629-L631, #L1905`) |
| `ConnectionStateChanged` (`connectionStateChanged`) | Every ConnectionState transition |
| `ParticipantConnected` / `ParticipantDisconnected` (`participantConnected` / `participantDisconnected`, arg `(participant, DisconnectReason?)`) | Remote participant added or removed |
| `ParticipantActive` (`participantActive`) | Remote participant reached ACTIVE |
| `TrackPublished` / `TrackUnpublished` / `TrackSubscribed` / `TrackUnsubscribed` / `TrackSubscriptionFailed` / `TrackMuted` / `TrackUnmuted` / `TrackStreamStateChanged` / `TrackSubscriptionStatusChanged` | Track lifecycle |
| `ConnectionQualityChanged` (`connectionQualityChanged`) | Quality is one of `excellent`, `good`, `poor`, `lost`, `unknown` (`JS/src/room/participant/Participant.ts#L27-L37`). Doc comment on `Lost`: "temporarily (or permanently) lost connection … For permanent disconnection a `ParticipantDisconnected` event will be emitted after a timeout" |
| `SignalConnected`, `Moved`, `DCBufferStatusChanged`, `ActiveSpeakersChanged` | Other |

**ParticipantEvent** (`events.ts#L380-L595`): `TrackPublished`, `TrackSubscribed`, `TrackSubscriptionFailed`, `TrackUnpublished`, `TrackUnsubscribed`, `TrackMuted`, `TrackUnmuted`, `LocalTrackPublished`, `LocalTrackUnpublished`, `ParticipantMetadataChanged`, `ParticipantNameChanged`, `IsSpeakingChanged`, `ConnectionQualityChanged`, `TrackStreamStateChanged`, `TrackSubscriptionPermissionChanged`, `TrackSubscriptionStatusChanged`, `ParticipantPermissionsChanged`, `AttributesChanged`, `Active`, and others.

**Internal EngineEvent**, useful for instrumentation: `Resuming`, `SignalResumed`, `Resumed`, `Restarting`, `SignalRestarted`, `Restarted`, `Offline`, `Disconnected`.

**ConnectionState** (`JS/src/room/Room.ts#L138-L144`): `disconnected`, `connecting`, `connected`, `reconnecting`, `signalReconnecting`.

### 4.2 Reconnect policy
Source: `JS/src/room/DefaultReconnectPolicy.ts#L1-L35`; defaults in `JS/src/room/defaults.ts#L42-L52`.

- `DEFAULT_RETRY_DELAYS_IN_MS = [0, 300, 1200, 2700, 4800, 7000, 7000, 7000, 7000, 7000]`, which is **10 attempts**.
- Jitter: for `retryCount ≥ 2`, `delay + Math.random()*1000` is added.
- The policy returns `null` once `retryCount ≥ 10`. The engine then emits `Disconnected` and closes, logging "gave up reconnecting after N attempts" (`JS/src/room/RTCEngine.ts#L1174-L1220`).
- Arithmetic from those constants: the sum of delays is 44.0 s, plus up to 8 s of jitter, **plus each attempt's own duration**. Each attempt includes a fixed 2 s `minReconnectWait` (`RTCEngine.ts#L111, #L1542`) and up to `peerConnectionTimeout` = **15 s** (`defaults.ts#L51`). Inference: the realistic give-up time is about 1 to 3 minutes, depending on how fast each attempt fails.
- A server `LeaveRequest` with RESUME or RECONNECT forces the next delay to 0 (`RTCEngine.ts#L1203-L1205`, `leaveReconnect`). It still counts against the attempt budget.
- Other defaults: `websocketTimeout` 15 s, `maxRetries` 1 (initial connect only), `peerConnectionTimeout` 15 s.

### 4.3 What triggers a reconnect, and resume vs full

**Triggers** (all call `handleDisconnect`):
- Signal WS close, or signal **ping timeout**: no Pong within `ping_timeout` = 15 s, giving `RR_SIGNAL_DISCONNECTED` (`JS/src/api/SignalClient.ts#L631-L637, #L1130-L1143`; `RTCEngine.ts#L756-L758`).
- PC `FAILED` while connected, giving `RR_SUBSCRIBER_FAILED` or `RR_PUBLISHER_FAILED` (`RTCEngine.ts#L620-L631`).
- Server `LeaveRequest` RESUME or RECONNECT (`RTCEngine.ts#L760-L785`).
- Local connection quality `LOST` for **10 s** while publishing, which **forces a full reconnect** (`RTCEngine.ts#L118, #L1225-L1262`).
- Connection-reconcile watchdog: 3 consecutive 4 s checks where the transport looks dead forces a full reconnect (`Room.ts#L146, #L2660-L2690`).
- Negotiation failure forces a full reconnect (`RTCEngine.ts#L1807-L1828`).

**Resume vs full reconnect** (`attemptReconnect`, `RTCEngine.ts#L1289-L1370`). The attempt is a **full reconnect** if `fullReconnectOnNext` is set. That flag is set by any of:
- `LeaveRequest{RECONNECT}`;
- quality-LOST;
- the reconcile watchdog;
- negotiation failure;
- `clientConfiguration.resumeConnection == DISABLED`;
- the PC manager being in state NEW;
- a failed resume that was not a `SignalReconnectError`;
- any failed full reconnect.

Otherwise the attempt is a **resume**. A resume that fails with a signal-level error stays a resume on the next attempt.

- **Resume** (`resumeConnection`, `#L1452-L1530`): emits `Resuming` (RoomEvent `SignalReconnecting`), opens the WS with `reconnect=1&sid=…`, receives `ReconnectResponse`, runs `triggerIceRestart()`, waits for the PC (2 s + up to 15 s), then emits `Resumed` (RoomEvent `Reconnected`). The sid is kept and remote participants are untouched.
- **Full reconnect** (`restartConnection`, `#L1382-L1450`): emits `Restarting` (RoomEvent `Reconnecting`), sends a leave if the WS is still up, tears down the PCs and signal, and does a **fresh join** (no `reconnect=1`, so the server applies duplicate-identity replacement). Then `SignalRestarted`, `republishAllTracks`, and `Restarted` → `Reconnected`. **Locally, `handleRestarting` emits `ParticipantDisconnected` for every remote participant** (`Room.ts#L1788-L1791`). They come back as `ParticipantConnected` from the new JoinResponse.
- `UnexpectedConnectionState` (url or token missing, or token expired or NotAllowed) is unrecoverable and closes immediately.

---

## 5. What each observer sees

"Subject" means the participant whose path is interrupted. "Others" means other participants' client-sdk-js. "Webhook" means the server webhook stream.

| Scenario | Subject (client-sdk-js) | Server state | Others (client-sdk-js) | Webhook |
|---|---|---|---|---|
| **Graceful leave** (`room.disconnect()`) | `Disconnected(CLIENT_INITIATED)`, state `disconnected` | LeaveRequest from client → `Close`, CLIENT_INITIATED | `TrackUnpublished`/`TrackUnsubscribed`, then `ParticipantDisconnected(p, CLIENT_INITIATED)` | `track_unpublished`×n, `participant_left` (reason CLIENT_INITIATED in `participant.disconnect_reason`) |
| **Transport loss, no leave, never returns** | `SignalReconnecting` (ping timeout 15 s, or WS close) → resume attempts fail → escalate to full (`Reconnecting`) → after the retry budget, `Disconnected` (no reason) | Inference: ~20 s after ICE traffic stops, `Close(PeerConnectionDisconnected)` | Possibly `ConnectionQualityChanged(lost)` first (5 s cadence); then `ParticipantDisconnected(p, CONNECTION_TIMEOUT)` | `participant_left` with CONNECTION_TIMEOUT (or `participant_connection_aborted` if it never became active); `room_finished` 20 s later if the room is empty |
| **Resume succeeded** (outage shorter than the server's ~20 s close window; inference) | `SignalReconnecting` → `Reconnected`; ConnectionState `signalReconnecting` → `connected`; same sid. (`Reconnecting` too if the engine emitted `Offline` because signal and PC were both severed) | `ReconnectResponse`, ICE restart, analytics `PARTICIPANT_RESUMED` only | **Nothing lifecycle-level.** Possibly a quality dip or `lost`, and a track stream-state change | **None** |
| **Full reconnect** (rejoin after server closed or forgot the session, or forced full) | `Reconnecting`; local `ParticipantDisconnected` for **all** remotes, then `ParticipantConnected` for each; `Reconnected`; **new sid**; tracks republished | Old session already closed (CONNECTION_TIMEOUT) or replaced (DUPLICATE_IDENTITY); new session joins | If the old session was still present: `ParticipantDisconnected(p, DUPLICATE_IDENTITY)` then `ParticipantConnected(p')`. If already closed: an earlier `ParticipantDisconnected(CONNECTION_TIMEOUT)`, later `ParticipantConnected` | `participant_left` (old sid) then `participant_joined` (new sid, on ACTIVE) plus track events |
| **Rejoin, same identity, from another connection** (no `reconnect=1`) | Old connection receives `LeaveRequest{DISCONNECT, DUPLICATE_IDENTITY}` → `Disconnected(DUPLICATE_IDENTITY)` (no retry). New connection: `Connected` | `RemoveParticipant(DuplicateIdentity)` before the new join | `ParticipantDisconnected(p, DUPLICATE_IDENTITY)`, `ParticipantConnected(p')` (same identity, new sid) | `participant_left` (DUPLICATE_IDENTITY) then `participant_joined` |

**Open points for live verification** (all inferences above):
- the actual server close latency under a UDP blackhole (~20 s predicted);
- whether client-side ordering can race when the DISCONNECTED update for the old sid arrives after the new sid's info, because `handleParticipantUpdates` keys on identity (`Room.ts#L1909-L1937`);
- behaviour when only the WS is cut and media stays up (predicted: invisible to others).
