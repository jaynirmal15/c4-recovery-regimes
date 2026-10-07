# Janus participant-lifecycle vocabulary

> **SOURCE: documentation/source code only — not yet verified against the running deployment.**

| Item | Value |
|---|---|
| Date | 2026-09-29 |
| Janus | **v1.4.1** (tag object `b2f91c7f…`, commit **85304a7a4bdb2719583ad53ae04130a8273dba6a**). Deployed as the Debian package 1.4.1+ds-4. Debian patches are not reviewed here. |
| Components | Core (`janus.c`, `ice.c`, `dtls.c`, `events.c`), WebSockets transport, VideoRoom plugin, sample HTTP event handler `janus.eventhandler.sampleevh` with `events="all"`, and `html/demos/janus.js` from the same tag |

URL prefix used below: `J` = https://github.com/meetecho/janus-gateway/blob/v1.4.1/

Online docs at https://janus.conf.meetecho.com/docs/ track the latest release and are not pinned to a version. The same text is generated from `J/src/mainpage.dox` and from the doc comments in `J/src/plugins/janus_videoroom.c`, so those files are cited instead. Claims marked **[docs]** come from that doc text. Unmarked claims come from source. Anything marked **Inference** is my reading and is not stated in code or docs.

---

## 1. Core Janus API: lifecycle messages to the client

### 1.1 Requests and asynchronous events

| Message (`"janus"`) | Direction | Semantics | Source (J) |
|---|---|---|---|
| `create` → `success{data.id}` | C→S | New session. Sets `last_activity`. Event handler: session `created` with `transport{transport,id}` | `src/janus.c#L1150-L1175` |
| `attach` → `success{data.id}` | C→S | New handle bound to a plugin. Event handler: handle `attached` | `src/janus.c#L1260-L1289`; `src/ice.c#L1501-L1502` |
| `detach` | C→S | Removes the handle. The plugin's `destroy_session` runs (VideoRoom: "leaving"). Client receives the `detached` event | `src/janus.c#L1316-L1335`; `src/ice.c#L4675-L4687` |
| `hangup` | C→S | Tears down the PC. Reason `"Janus API"` | `src/janus.c#L1336-L1351` |
| `destroy` | C→S | Removes the session and all its handles. Event handler: session `destroyed` | `src/janus.c#L1290-L1315` |
| `keepalive` → `ack` | C→S | Only refreshes `last_activity`. **Every** session-scoped request updates `last_activity` | `src/janus.c#L1200-L1209`; [docs] `src/mainpage.dox#L1855-L1878` |
| `claim` → `success` | C→S | Re-binds an **existing** session to the requesting transport. The old transport gets `session_over(claimed=TRUE)`, and the `transport_gone` flag is cleared. If the session is already destroyed, the answer is error 458 `No such session` | `src/janus.c#L1352-L1383`, `#L1200-L1205` |
| `timeout` | S→C | Session timed out. Sent just before the session is destroyed | `src/janus.c#L715-L733` |
| `detached` | S→C | Handle destroyed, whether by detach, session destroy, or timeout | `src/ice.c#L4675` |
| `hangup` {`reason`} | S→C | PC closed. Reasons in 1.4.1: `"DTLS alert"`, `"DTLS timeout"`, `"DTLS error"`, `"Janus API"`, `"Admin API"`, `"Close PC"` (plugin `close_pc`), `"Detach"`, `"ICE failed"`, `"Gathering error"`, `"DTLS-SRTP stack error"`, `"ICE gathering error"` | `src/ice.c#L894-L924`; call sites `src/dtls.c#L1026,#L1120,#L1141`, `src/janus.c#L1347,#L2952,#L4315`, `src/ice.c#L1516,#L2061,#L2144,#L3818,#L3835,#L4553` |
| `webrtcup` | S→C | ICE+DTLS up. The plugin's `setup_media` is called | `src/ice.c#L5315-L5342` |
| `media` {`type`:"audio"/"video", `mid`, `receiving`:bool, [`substream`], [`seconds`]} | S→C | Media started or stopped arriving. `receiving:false` is sent after `no_media_timer` seconds without packets | `src/ice.c#L840-L873` |
| `slowlink` {`mid`, `media`, `uplink`:bool, `lost`} | S→C | Loss above `slowlink_threshold` packets/s | `src/ice.c#L1990-L2016` |
| `ice-failed` | S→C | ICE went failed **after** connected/ready (consent freshness detected breakage). Starts the grace timer. **janus.js does not handle this event** (it falls through to "Unknown message/event") | `src/ice.c#L875-L892, #L2130-L2140` |
| `trickle` | both | Candidates. From the server only with `full_trickle` | `src/ice.c` `janus_ice_notify_trickle` |

### 1.2 ICE restart
- A **publisher** restarts by sending a new offer with new ICE credentials. `sdp.c` sets `JANUS_ICE_HANDLE_WEBRTC_ICE_RESTART` (`J/src/sdp.c#L411`). The core then calls `janus_ice_restart` and updates the remote credentials (`J/src/janus.c#L1691-L1705`).
- A **server-side offer** with `jsep.restart=true` triggers a restart for plugin-generated offers, such as VideoRoom subscribers (`J/src/janus.c#L3696, #L4081-L4082`).
- **Only possible while the handle still has its PC.** After `hangup`, the PC is gone and the client must renegotiate from scratch.

### 1.3 Timers and defaults
Configured in `janus.jcfg`.

| Key | Default | Semantics | Source (J) |
|---|---|---|---|
| `session_timeout` | **60 s** | Watchdog checks every **2 s** (`#L741-L750`). If `now - last_activity ≥ session_timeout`, it sends `timeout`, clears the handles, emits event-handler session `timeout`, and **destroys the session immediately**. `0` disables. | `src/janus.c#L289-L290, #L697-L737` |
| `reclaim_session_timeout` | **0** | When the transport goes away, **0 means the session is destroyed immediately** (event handler: session `destroyed`, not `timeout`). If >0, the session is flagged `transport_gone` and destroyed by the watchdog once `now - last_activity ≥ reclaim_session_timeout`. **Measured from the last request, not from the transport close.** A `claim` clears the flag. | `src/janus.c#L292-L293, #L3484-L3516, #L713` |
| `no_media_timer` | 1 s | Seconds without media before `media{receiving:false}` | `src/ice.c#L567-L570` |
| `slowlink_threshold` | 0 (off) | Lost packets/s that trigger `slowlink` | `src/ice.c#L585` |
| `dtls_timeout` | 500 ms (retransmission base) | DTLS handshake retransmission. A handshake timeout means `hangup "DTLS timeout"` | [docs] `conf/janus.jcfg.sample.in#L255` |
| `ice_consent_freshness` | **FALSE** | Without it, Janus has no consent-based detection that an **established** peer has vanished. Inference: silent ICE loss then produces only `media receiving:false`, with no hangup. | `src/ice.c#L144`; [docs] `conf/janus.jcfg.sample.in#L294-L312` |
| `ice_keepalive_conncheck` | FALSE | none | `src/ice.c#L163` |
| `hangup_on_failed` | **FALSE** | With FALSE, ICE `failed` starts a grace timer: checked every 500 ms, it hangs up with "ICE failed" at ≥5 s if trickle and answer are complete, and in any case at 15 s. With TRUE, it hangs up immediately on failed-after-connected. | `src/ice.c#L179, #L2020-L2070, #L2130-L2160` |
| WS `pingpong_trigger` / `pingpong_timeout` | unset (off) | libwebsockets idle PING and dead-peer detection. Without them, a dead TCP peer is noticed only by TCP. | `src/transports/janus_websockets.c#L711-L751`; [docs] `conf/janus.transport.websockets.jcfg.sample#L7-L8` |

**Transport close semantics.** WS `LWS_CALLBACK_CLOSED` → `janus_websockets_destroy_client` → event-handler transport `disconnected` → `gateway->transport_gone` (`J/src/transports/janus_websockets.c#L866-L875, #L894, #L1518-L1522`).
- With `reclaim_session_timeout=0`, every session created on that WS is **destroyed synchronously**: handles are cleared, the plugin `destroy_session` runs, and VideoRoom sends `leaving` to others.
- One exception: sessions with `last_activity == 0` are skipped (`#L3494`). That value is never 0 after `create`.
- The WS transport ignores `session_over` and `session_claimed` (`janus_websockets.c#L980-L988`).

**Docs/source disagreement.** `mainpage.dox#L1438-L1446` says that after a *timeout*, "if a reclaim_session_timeout value is configured, you can still reclaim the session". In source, a session hitting `session_timeout` is destroyed on the spot (`janus.c#L714-L733`). The reclaim window applies **only** to the transport-gone path. Prefer the source reading.

**Repo cross-reference** (from `deploy/janus/configmap.yaml`, not the running pod): `session_timeout=60`, `reclaim_session_timeout=0`, `no_media_timer=1`, `slowlink_threshold=4`, `dtls_timeout=500`, `events.stats_period=5`. Consent freshness, `hangup_on_failed`, and WS pingpong are not set, so they are at their defaults (off). VideoRoom room 1234 has `notify_joining=true` and `string_ids=false`.

---

## 2. Event handler events (sampleevh, `events="all"`)

Type bitmask, verified in `J/src/events/eventhandler.h#L129-L150`:

| Bit | Value | Name ("events" label) |
|---|---|---|
| SESSION | 1 | `sessions` |
| HANDLE | 2 | `handles` |
| EXTERNAL | 4 | `external` |
| JSEP | 8 | `jsep` |
| WEBRTC | 16 | `webrtc` |
| MEDIA | 32 | `media` |
| PLUGIN | 64 | `plugins` |
| TRANSPORT | 128 | `transports` |
| CORE | 256 | `core` |

`"all"` means `0xffffffff`. Labels are in `J/src/events.c#L22-L33`.

Envelope (`J/src/events.c#L150-L262`):
```
{ emitter, type, [subtype], timestamp(µs, real time), [session_id], [handle_id], [opaque_id], event:{…} }
```
Subtypes are defined in `eventhandler.h#L169-L191`.

| Type | Subtype | `event` body | Emitted when / source (J) |
|---|---|---|---|
| 1 session | none | `{name:"created", transport:{transport:"janus.transport.websockets", id}}` | `create` (`janus.c#L1159-L1172`) |
| 1 session | none | `{name:"destroyed"}` | `destroy` request (`#L1314`), transport gone with reclaim=0 (`#L3502`), Admin API destroy (`#L2878`) |
| 1 session | none | `{name:"timeout"}` | Watchdog timeout (`#L729`) |
| 2 handle | none | `{name:"attached"/"detached", plugin, [opaque_id], [token]}` | `ice.c#L1501, #L4685` |
| 8 jsep | none | `{owner:"local"/"remote", jsep:{type,sdp}}` | `janus.c#L1537, #L3738` |
| 16 webrtc | 1 ICE | `{ice:"disconnected"/"gathering"/"connecting"/"connected"/"ready"/"failed", stream_id, component_id}` | Every libnice component state change (`ice.c#L1320-L1328, #L2120-L2128`) |
| 16 webrtc | 2 / 3 | Local and remote candidate | `ice.c#L3463`; `sdp.c#L1149` |
| 16 webrtc | 4 PAIR | `{selected-pair:"l:port [type,proto] <-> r:port [type,proto]", candidates:{local,remote}, stream_id, component_id}` | `ice.c#L2240-L2268` |
| 16 webrtc | 5 DTLS | `{dtls:"created"/"trying"/"connected"/"failed", stream_id, component_id, retransmissions}` | `dtls.c#L28-L42, #L80-L97` |
| 16 webrtc | 6 STATE | `{connection:"webrtcup"}` or `{connection:"hangup", reason}` | `ice.c#L5335-L5339, #L913-L921` |
| 32 media | 1 STATE | `{media:"audio"/"video", mid, [substream], receiving:bool, [seconds]}` | `ice.c#L862-L873` |
| 32 media | 2 SLOWLINK | `{mid, media, slow_link:"uplink"/"downlink", lost_lastsec}` | `ice.c#L2003-L2013` |
| 32 media | 3 STATS | Every `stats_period` s, per mid and layer: `mid, mindex, media, codec, base, rtt, lost, lost-by-remote, jitter-local/remote, in/out-(media-)link-quality, packets-received/sent, bytes-received/sent, bytes-*-lastsec, nacks-*, retransmissions-received, [remb-bitrate]` | `ice.c#L4455-L4522` |
| 64 plugin | none | `{plugin:"janus.plugin.videoroom", data:{…}}` (see §3.2) | Plugin `notify_event` |
| 128 transport | none | `{transport:"janus.transport.websockets", id, data:{event:"connected", admin_api, ip}}` or `{…data:{event:"disconnected"}}` | `janus_websockets.c#L1247-L1252, #L870-L873` |
| 256 core | 1 / 2 | Startup and shutdown | none |

The transport `id` is a hash of the transport instance pointer. It equals the `transport.id` in session `created` (`janus.c#L1163-L1170`, `events.c#L232-L245`). **That lets WS closes be joined to sessions.**

`ice-failed` (§1.1) has **no** event-handler counterpart. The ICE-state event `ice:"failed"` covers it.

---

## 3. VideoRoom plugin

### 3.1 Events to participants (plugin `event` messages, `"videoroom":…`)

| Event | Recipients | Payload | Source (J `src/plugins/janus_videoroom.c`) |
|---|---|---|---|
| `joined` (response) | Joiner | `room, description, id, private_id, publishers[], [attendees[]]` (attendees only if `notify_joining`) | `#L10033-L10046` |
| `event` + `joining:{id,display,metadata}` | Other publishers-role participants | Only if room `notify_joining=true` | `#L4437-L4458` |
| `event` + `publishers:[{id,display,metadata,streams[…]}]` | Others | New publisher, or updated publisher (`configured`/renegotiated) | `#L4318-L4400` |
| `event` + `unpublished:<id>` | Others | Publisher stopped publishing: `unpublish` request **or PC hangup** | `#L4460-L4516`, `#L9495` |
| `event` + `leaving:<id>` (+display, metadata) | Others | `leave` request, or handle detach/destroy (includes session destroy by WS close or timeout) | `#L4490`, `#L4551`, `#L11201` |
| `event` + `kicked:<id>` | Others | Moderator `kick`. The kicked user gets `leaving:"ok", reason:"kicked"` and its PC is closed | `#L6720-L6760` |
| `destroyed` | All | Room destroyed | [docs] `#L270-L290` |
| `talking` / `stopped-talking` | All | Audio-level detection (if enabled) | `#L8788` |
| `updated` (+ jsep offer) | Subscribers | Stream set changed, e.g. a publisher's streams were removed on hangup | `#L9420-L9470` |
| `event` + `configured:"ok"` | Requester | `configure` response | none |

**ICE restart in VideoRoom.**
- Publishers: send `configure` (or `publish`) with a JSEP offer carrying new ICE credentials. janus.js does this with `createOffer({iceRestart:true})`. [docs] `#L1419-L1427`.
- Subscribers: send `configure {"restart": true}`. The plugin sends a new offer with `jsep.restart=true`, deferred through `pending_restart` if an answer is still outstanding (`#L12094-L12112, #L12695-L12697`).

### 3.2 VideoRoom event-handler events (type 64, `data.event`)
From `#L4406, #L4496, #L10052`, plus the `grep` list below:
- `joined` {room, id, private_id, [display], [metadata], [token]}
- `published` / `updated` {room, id, display, metadata, streams[]}
- `unpublished` / `leaving` / `kicked` {room, id, [display], [metadata]}. **Emitted with a NULL handle, so there is no session_id or handle_id in the envelope** (`#L4505`).
- `configured`, `subscribing`, `subscribed`, `updated` (subscriber), `unsubscribed`, `switched`
- `created`, `edited`, `destroyed` (room)
- `rtp_forward`, `stop_rtp_forward`, `muted`, `unmuted`, `moderated`

### 3.3 Join errors
Codes are at `#L3025-L3043`:

| Code | Name | Meaning |
|---|---|---|
| 421–423 | NO_MESSAGE, INVALID_JSON, INVALID_REQUEST | Malformed request |
| 424 | JOIN_FIRST | Must join first |
| 425 | ALREADY_JOINED | This handle is already publisher or subscriber |
| 426 | NO_SUCH_ROOM | none |
| 427 | ROOM_EXISTS | none |
| 428 | NO_SUCH_FEED | none |
| 429–431 | MISSING/INVALID_ELEMENT, INVALID_SDP_TYPE | none |
| 432 | PUBLISHERS_FULL | none |
| 433 | UNAUTHORIZED | none |
| 434 | ALREADY_PUBLISHED | none |
| 435 | NOT_PUBLISHED | none |
| **436** | **ID_EXISTS** | `"User ID <id> already exists"`. Returned when joining as a publisher with an `id` still present in `room->participants` (`#L9737-L9747`). **No takeover or eviction of the old participant.** |
| 437 | INVALID_SDP | none |
| 438 | INVALID_FEED | none |
| 499 | UNKNOWN_ERROR | none |

### 3.4 Publisher losing its PeerConnection
The core `hangup` (any reason: ICE failed, DTLS alert, and so on) calls `janus_videoroom_hangup_media` → `hangup_media_internal` (`#L9318-L9497`). That function:
- closes recorders and removes all publisher streams from subscribers, sending subscribers an `updated` event plus a new offer when `autoupdate` is on;
- sends **`unpublished:<id>`** to others (`leave_or_unpublish(p, FALSE, FALSE)`, `#L9495`);
- sets `session->started=0`.

**The participant stays joined.** Its handle and id remain in the room, `listparticipants` shows `publisher:false`, and it can publish again on the same handle.

**Inference.** Because `ice_consent_freshness` is off and `hangup_on_failed` is FALSE, a publisher whose network silently disappears *after* connecting may never reach ICE `failed` from Janus's side. Nothing in source forces it without consent checks. Others would then see no `unpublished` until the **session** dies: WS close (immediate, with reclaim=0) or `session_timeout` (60 s after the last keepalive; janus.js keepalive is every 25 s).

**Docs/source note on `leave`.** [docs] `#L1017-L1033` says a leaving publisher's peers also get `unpublished`. In source, `leave` sends `leaving` and removes the participant from the room first (`#L11194-L11203`). A later PC hangup then finds `participant->room == NULL`, so `leave_or_unpublish` returns early and no `unpublished` is sent. Subscriber autoupdate is also skipped because `room == NULL` (`#L4462, #L9444`). Inference; verify live.

### 3.5 `listparticipants`
Response is `{videoroom:"participants", room, participants:[{id, [display], [metadata], [dummy], [remote], publisher:bool, [talking]}]}` (`#L6897-L6975`).
- `publisher` is `session->started`: true after `setup_media` (webrtcup), false after hangup.
- [docs] `#L455-L467` shows `publisher` as a quoted string `"<true|false>"`, but source emits a JSON boolean.

---

## 4. janus.js (`J/html/demos/janus.js`, v1.4.1)

| Aspect | Behaviour | Lines |
|---|---|---|
| Keepalive | `keepalive` every **25 s** over WS (`keepAlivePeriod`, configurable) | `#L636-L640, #L950-L960` |
| WS `close` | If it was connected: sets `connected=false` and calls **`gatewayCallbacks.error("Lost connection to the server (is it down?)")`**. **Nothing else**: no retry, no claim, and no PC teardown | `#L1035-L1043` |
| WS `error` | While creating the session: tries the next server in the list if an array was given (and not reconnecting), else `callbacks.error` | `#L999-L1019` |
| `reconnect` option / `janus.reconnect(callbacks)` | **Manual only.** The application must call it. It opens a new WS and sends `claim` with the old `session_id`. It works only if the server still has the session, i.e. `reclaim_session_timeout > 0` and the window has not expired. **With reclaim=0 the claim fails**: `No such session` (458) → `callbacks.error` | `#L678-L684, #L962-L1033` |
| `destroyOnUnload` | Default **true**. On `beforeunload` (or `pagehide` on iOS) it calls `session.destroy({unload:true})`, which is a graceful destroy | `#L490-L505, #L632-L634` |
| Server `timeout` event | Closes the WS (3504, "Gateway timeout") | `#L936-L942` |
| Server `hangup` | `pluginHandle.webrtcState(false, reason)` then `pluginHandle.hangup()` (local PC teardown) | `#L826-L841` |
| Server `detached` | `ondetached()` then `detach()` | `#L842-L857` |
| `media` / `slowlink` / `webrtcup` | Callbacks `mediaState(type, receiving, mid)`, `slowLink(uplink, lost, mid)`, `webrtcState(true)` | `#L810-L880` |
| PC state | Only forwarded to the `iceState(state)` and `connectionState(state)` callbacks. **No automatic action on failed or disconnected** | `#L1931-L1938` |
| ICE restart | `createOffer({iceRestart:true})` when the caller passes `iceRestart:true`. It is **caller-initiated only** | `#L2195-L2206` |

**Confirmed: janus.js has no automatic media-reconnect or ICE-restart policy.** Recovery is entirely application-driven: `iceState` → app calls `createOffer({iceRestart:true})` + `configure`; WS loss → app calls `reconnect()`. The VideoRoom demo apps may add their own logic; that is not reviewed here.

---

## 5. What each observer sees

"Subject" means the participant whose path is interrupted (a VideoRoom publisher). "Others" means other VideoRoom participants on their publisher-role handles. "EVH" means the sampleevh stream.

| Scenario | Subject (janus.js) | Server | Others | EVH |
|---|---|---|---|---|
| **Graceful leave** (`leave`, then `detach`/`destroy`) | `leaving:"ok"`, then `detached`/`hangup` | Participant removed from the room; handles and session destroyed | `leaving:<id>`. Per [docs] also `unpublished:<id>`; per source, likely **not** (§3.4) | plugin `leaving`; webrtc `hangup` ("Janus API"/"Detach"); handle `detached`; session `destroyed` |
| **WS closed without leave** (reclaim=0) | `error("Lost connection…")`; the PC may keep running until torn down | `transport_gone` → session **destroyed immediately** → handles detached → plugin `destroy_session` | `leaving:<id>` (hangup_media runs first inside destroy_session, so `unpublished:<id>` may also precede it; inference), and subscribers get `updated` | transport `disconnected`; session `destroyed`; webrtc `hangup` reason "Detach"; plugin `unpublished`/`leaving`; handle `detached` |
| **Silent session (no requests ≥60 s), WS still open** | Receives `timeout`; janus.js closes the WS (3504) | Watchdog (2 s cadence) destroys the session | `leaving:<id>` (plus `unpublished`, inference) | session `timeout` (not `destroyed`), then the handle/plugin events above |
| **ICE failure / hangup, WS alive** | `ice-failed` (only if it had connected; janus.js ignores it), later `hangup{reason:"ICE failed"}` (grace period 5–15 s), `webrtcState(false)` | PC torn down; publisher remains joined, `publisher:false` | `unpublished:<id>`; subscribers `updated`. **No `leaving`** | webrtc `ice:"failed"`, then `connection:"hangup","ICE failed"`; media `receiving:false`; plugin `unpublished` |
| **Silent media loss, WS alive, no consent freshness** (inference) | `media{receiving:false}` from Janus (≥1 s); nothing else | PC nominally up | Nothing lifecycle-level. Subscribers just stop getting RTP | media `receiving:false`; stats go flat |
| **Subject ICE restart** (app-driven) | `configure` + offer with new ufrag → answer; `webrtcup` is **not** re-sent (inference: `pc->connected` already set) | Same handle, same PC | Nothing, or `publishers` again if the streams changed | jsep local/remote; webrtc `ice` states; new `selected-pair` |
| **Claim/reconnect** | `reconnect()` → `claim`. With reclaim=0 → error 458 "No such session". With reclaim>0 inside the window → success; handles and PCs survive | Session re-bound; `transport_gone` cleared | Nothing (only if the claim succeeds) | No session-level "claimed" event exists; only transport `connected` for the new WS |
| **Rejoin with the same feed id** | If the old participant is still in the room: **error 436 "User ID X already exists"**. After it is gone: a normal `joined` | No eviction; the first session wins until it is destroyed | After the old one leaves: `leaving`/`unpublished`, then `joining` (notify_joining) and `publishers` for the new session | plugin `joined` (new private_id), later `published` |
