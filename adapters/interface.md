# C4 stack adapter contract

A stack adapter is one directory, `adapters/<stack>/`, containing:

| File | Purpose |
|---|---|
| `adapter.mjs` | `export default class extends StackAdapter` (from `../base.mjs`) |
| `mapping.json` | One entry per canonical event in `../canonical-events.json`: native evidence, observer, status (`observed` / `docs-only` / `unsupported`), and evidence file. `unsupported` requires a `reason`. |
| `replay-cases.json` | Captured native event streams plus the canonical sequence they must normalize to. This is ground truth from the running deployment; `conformance.mjs` enforces it. |

Adding a third stack means one new directory and nothing else. `conformance.mjs`
discovers every directory containing an `adapter.mjs`.

## Methods (server-facing half; implemented now)

| Method | Returns | Notes |
|---|---|---|
| `describe()` | `{stack, serverVersion, deployment, timers}` | `timers` lists every server knob that bounds a regime, e.g. LiveKit 10+5+5 s, Janus `session_timeout`/`reclaim_session_timeout`. |
| `async health()` | `{ok, detail}` | Plain reachability plus version. |
| `async ensureRoom(room)` | `{room, created}` | Idempotent. |
| `async listParticipants(room)` | `[{key, identity, sessionId, state, raw}]` | `key` is the stack's participant key (LiveKit identity+sid; Janus room/feedId). |
| `async mintJoinCredential(room, identity)` | `{url, ...}` | What a participant needs to join. LiveKit: JWT. Janus: URL, room, feed id (no auth in this config). |
| `parseSinkRecord(record)` | `[{source, at, native}]` | One sink HTTP record to zero or more native events with a timestamp. `at` uses the best clock available (Janus µs; LiveKit sink receive time, because webhook `createdAt` is whole seconds). |
| `normalize(nativeEvents)` | `[{canonical, observer, at, participantKey, native}]` | **Stream-level, not per-event.** Cause often lives in neighbouring events (Janus `leaving` is only interpretable next to `session timeout`/`destroyed`). |

## Participant-facing half (NOT implemented; blocked on DC-1)

`join()`, `leave()`, `onEvent()`, and reconnect-policy hooks will live in client adapters
once DC-1 (hold client policy constant, or measure as shipped) is decided. The canonical
vocabulary already carries `observer: "self" | "other"` so both halves share one event space.

## Timestamps

Every canonical event carries `at` (epoch ms, float) and `atSource`: one of
`server-us`, `sink-receive`, `server-log`, `client`. A study must never compare `at`
values across different `atSource` kinds without stating the offset.
