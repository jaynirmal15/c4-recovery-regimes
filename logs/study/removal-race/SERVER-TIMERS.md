# The two server timers behind the removals, at the pinned versions

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
