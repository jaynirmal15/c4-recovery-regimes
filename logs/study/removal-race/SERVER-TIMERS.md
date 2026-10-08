# The timers behind the removals and the survival boundary, at the pinned versions

Read on 2026-10-08 from the source at the release tags of the versions the study pinned, not from
current documentation. Line numbers are those of the tagged files.

## Janus 1.4.1 (tag `v1.4.1`, github.com/meetecho/janus-gateway)

- `conf/janus.jcfg.sample.in` line 79: `#session_timeout = 60` (commented out, i.e. the default), with
  line 82 "(default=60s)". Line 93: `#reclaim_session_timeout = 0`.
- `src/janus.c` line 289: `#define DEFAULT_SESSION_TIMEOUT 60`.
- `src/janus.c` lines 743–749: the session watchdog runs `janus_check_sessions` from a GLib timer
  created with `g_timeout_source_new_seconds(2)`, i.e. about every 2 s.
- `src/janus.c` lines 712–715: a session is timed out when `now - last_activity >= timeout`, or when
  its transport is gone and `now - last_activity >= reclaim_session_timeout`; it then logs
  "Timeout expired for session".
- `src/janus.c` lines 1201–1209: `last_activity` is set on every incoming request that names an
  existing session, whatever the request, and at session creation (line 799). A request for a
  session that does not exist logs "Couldn't find any session" and is answered
  `JANUS_ERROR_SESSION_NOT_FOUND`.
- Our deployment: `deploy/janus/configmap.yaml` line 18 sets `session_timeout = 60` explicitly (the
  default value), and line 20 sets `reclaim_session_timeout = 30` (the default is 0). The runner
  checks both values on the running server before every trial (`client/runner/run.mjs`,
  `preconditions`).
- Observed in the 10 rebuilt trials: timeout 60.096–61.378 s after the last acknowledged keepalive,
  which is inside the 60 to 62 s that a 60 s timeout checked every 2 s allows.

## LiveKit v1.13.7 (tag `v1.13.7`, github.com/livekit/livekit)

- `pkg/rtc/participant.go` lines 73–79: `disconnectCleanupDuration = 5 * time.Second`, inside a
  `const` block. It is a compile-time constant, not a configuration parameter.
- `pkg/rtc/participant.go` lines 2755–2774, `onAnyTransportFailed`: sends the participant a leave
  request marked as expected to resume, closes the signal connection with reason transport failure,
  and calls `setupDisconnectTimer()`.
- lines 2740–2753, `setupDisconnectTimer`: after `disconnectCleanupDuration`, unless the participant
  is already closed or disconnected, `Close(true, ParticipantCloseReasonPeerConnectionDisconnected, false)`.
- `clearDisconnectTimer()` is called from `ICERestart` (line 1802) and from `Close` (line 1524).
- line 1513–1514: the "participant closing" log line. The study's server logs cite
  `rtc/participant.go:1513` for that message, which ties the running binary to this file.
- `config-sample.yaml` at the tag has no setting for this duration; its only related entries are the
  room-level `empty_timeout` (300) and `departure_timeout` (20). `deploy/livekit/values.yaml` sets
  neither.
- Observed in the 64 settled rebuilds with both timestamps (39 retained, 25 superseded): removal
  5.000–5.002 s after the server's own ICE failure.

## The 11.33 s: the client kernel's SYN retransmission schedule (Linux v6.18)

The LiveKit full-isolation boundary is "restore precedes the client's first connection open plus
11.33 s" (22 of 22 settled survivors, 0 of 39 settled rebuilds). That constant is not in the LiveKit
client.

- `livekit-client` v2.22.3, `src/room/defaults.ts` lines 50–52: `maxRetries: 1`,
  `peerConnectionTimeout: 15_000`, `websocketTimeout: 15_000`. Our adapter pins the signalling
  timeout to the driver's 15 s (`client/www/lk.js`, `signalTimeoutS`). Nothing in either is 11 s.
- Linux v6.18, `Documentation/networking/ip-sysctl.rst` lines 1108–1116, `tcp_syn_linear_timeouts`,
  default 4: "With an initial RTO of 1 and tcp_syn_linear_timeouts = 4 we would expect SYN RTOs to
  be: 1, 1, 1, 1, 1, 2, 4, ...". A connection attempt therefore sends its SYN at 0, 1, 2, 3, 4, 5, 7,
  11, 19, ... times the initial RTO. `net/ipv4/tcp_timer.c` lines 671–679 is the code.
- Fit (`resume-arrival.txt`): with the unit estimated once from the data as 1.033 s, each of the 56
  first arrivals on both stacks falls on the first schedule point after restore: 0, 1, 2, 3, 7 or 11
  units. 52 are within 0.1 s; the other four are Janus 10 s trials in which restore falls within
  0.16 s of a schedule point, which is the uncertainty of the restore time.
- The eleventh unit is 11.33 s. The next point is 19 units, 19.6 s after the open, and the driver
  abandons the attempt after 15 s, so 11.33 s is the last chance of the first connection.
- Tie to the running system: the nodes ran kernel `6.18.48-109.150.amzn2023.aarch64` in every
  session (job logs; `control.nodeInfo`). Not recorded: the value of the sysctl inside the client
  pods, and the AWS kernel's own source. The match of all 56 arrivals to the default schedule is the
  evidence that the default was in force.

The same schedule on Janus: claims succeeded 0, 1, 2 or 7 units after the websocket was opened. The
arrival points are a property of the client host's TCP stack, not of either SDK or either server.

## How item 3 of the remediation plan was closed for the removal race

Decided 2026-10-08: no intervention was run for the removal race. It was closed by reading the
mechanism out of the source at the pinned release tags, confirming the running LiveKit binary
against that source through the file and line cited in its own log, and checking the order of
events in the server logs of every trial (`REPORT.md`). This route was chosen deliberately, not
for want of lab time: an intervention would have shown that changing a parameter changes an outcome,
at a coarser grain than the code that produced the behaviour, and the one server-side manipulation
available on LiveKit would have required a rebuilt binary that is no longer the pinned release.
