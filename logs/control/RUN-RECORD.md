# Control arm (healthy sessions): run record

Run on 2026-10-07 and 2026-10-08 (UTC). Records: `control/` (81 sessions: 80 valid, 1 invalid)
and `control-shakedown/` (13 directories: 12 with a result, 8 valid and 4 invalid, and 1 with
no result). Job logs: this directory. This file was written after
the run, from the job logs and the records.

## What was and was not fixed in advance

No definitions for scoring the control arm were committed before it ran. The head of the
repository when the arm was designed, run and first analysed was `14ef408` (2026-10-07 04:19 UTC),
which predates the design. The design, the arms, the per-stack condition labels and the validity
exemption were settled in conversation before the first launch and are in the runner
(`client/runner/run.mjs`, last edited 16:58 UTC, between the first and second launch, to fix the
bystander-leave handling only). The analysis (`client/runner/control-analyze.mjs`) was written
after the LiveKit shakedown records existed and while the LiveKit 40 were running, and was edited
once more after the Janus shakedown (see "Analysis").

The mute result therefore stands in three tiers, and is reported in three:

- **Pre-stated in correspondence, not committed, and answered.** Before the run the question was
  put whether a media-reception signal can distinguish silence-with-packets from disruption. On
  Janus, in 12 of 12 unsignalled mutes, no reception event or any other server signal fired while
  the server's own statistics showed 50 packets per second received.
- **Post hoc, exploratory.** Reading the two mute conditions as a demonstration of substitution
  error was formed after the records were seen.
- **Absent.** No pre-scoring definition of expected outcomes per rule per arm was committed
  before the data was scored.

## Conditions

No isolation. Three participants as in the 215 study trials, a 15 s warm-up, arming, then 180 s of
armed observation. Per stack: h0 8, h1 8, h2 12, h3 12, in randomised order
(`control/order-<stack>.jsonl`). The arm label is not the condition; each record carries
`control.condition` and `control.conditionNote`.

| Condition | What happens |
|---|---|
| `h0-livekit`, `h0-janus` | nothing |
| `h1-livekit` | a fourth participant joins at about +30 s without publishing and leaves at about +90 s (livekit-client, `publish: false`) |
| `h1-janus` | the same, by a minimal Janus client that joins as a publisher and never publishes |
| `h2-livekit` | a fourth participant joins publishing and leaves; each participant's existing subscriber connection is renegotiated (the client sends the offer after the server's `mediaSectionsRequirement`) |
| `h2-janus` | a fourth participant joins publishing and leaves; each participant opens a new handle and connection for it. No existing connection is renegotiated: benign renegotiation is not tested on Janus |
| `h3-livekit` | S muted for about 10 s with `LocalTrackPublication.mute()`: the track is disabled and the server is told |
| `h3-janus` | S muted for about 10 s with `MediaStreamTrack.enabled = false` only: the server is told nothing |

`h3-livekit` and `h3-janus` are different conditions and are not to be pooled or reported under
one heading. In every h3 session the publisher's outbound RTP counters were read twice inside the
mute; packets continued at 49.9–50.2 per second with 3-byte payloads in 24 of 24.

In h3 the check "observer detected a failure of its own connection" is exempted and the exemption
is written into each record (`exemptions`). It was not exercised in any session: that check covers
the observer's own connection and the other observer, not S's audio.

In h1 and h2 the fourth participant runs as a second browser context in the O2 pod; in h2 every
participant also decodes its audio.

## What differs from the 215

- Client build: `common.js` and `driver.js` are the copies saved on 2026-10-06 just before the
  statistics sampler was added (`logs/study/janus-early/*.before-stats`); `lk.js`, `janus.js` and
  `lkproto.js` are unchanged. sha256 of every served file is in each record (`control.build`).
  That the saved `common.js` equals the one used in study run 1 cannot be shown from records.
- `client/www/control-arm.js` is loaded after `driver.js` (mute, a one-shot packet-counter read,
  the minimal Janus bystander). It wraps the two adapter classes to keep a reference to the
  instance and edits none of the five files above.
- `client/pod/control.mjs` serves that file and reports file hashes in `/health`.
- LiveKit API key rotated on 2026-10-06 (Helm revision 5); same chart and pinned image.
- Observation is 180 s with no isolation.

## Hardware and software

EKS cluster `realtime-media-aws-lab`, us-east-1, managed node group of 3 × `c7g.large` on demand,
AMI type `AL2023_ARM_64_STANDARD`, release `1.36.4-20260923` (read from the node-group API on
2026-10-08 after the run). Each launch got new instances. Node software, checked before every
session against the values in the study's job logs, with a stop on mismatch: kubelet
`v1.36.4-eks-f4fc4f1`, `Amazon Linux 2023.12.20260918`, kernel `6.18.48-109.150.amzn2023.aarch64`,
`containerd://2.2.7+unknown`. It matched on all nodes in all three launches (`control.nodeInfo`
in each record). No AMI ID was recorded in the study or here. SFU images are checked by pinned
digest per session, as in the study. Runner: one Mac on AC power, under `caffeinate`, with
`battery-guard.sh`; every job parks itself on exit.

## The three launches

| Log | Unparked (UTC) | Sessions | Parked, verified (UTC) |
|---|---|---|---|
| `session1-livekit.log` | 10-07 16:27:01 | LiveKit shakedown only: h0 and h3 valid; h1 and h2 invalid on every attempt (4 invalid records, 1 session killed with no result). Gate failed (6); the 40 did not run | 10-07 17:16:01 |
| `session1b-livekit.log` | 10-07 17:17:42 | LiveKit shakedown h1 and h2 (valid), gate passed, then 40 of 40 valid, done 20:23:08 | 10-07 20:40:46 |
| `session2-janus.log` | 10-07 20:42:47 | Janus shakedown, 4 of 4 valid, gate passed, then 41 sessions for 40 valid, done 10-08 00:08:39 | 10-08 00:26:04 |

Each park was verified by the script (node group desired 0, 0 live instances, 0 nodes) and again
from the EC2 and EKS APIs.

**The first launch's invalid sessions were the runner's fault.** `C4.leave()` returns nothing; the
runner treated the bystander's empty reply as a failed event. The bystander had joined and left in
each (its own log shows `joined` then `left`). Fixed before the second launch: the empty reply is
tolerated and a session is now invalid unless the bystander's own dump shows it left. The runner
was killed during its seventh session (`control-shakedown/livekit-h2-O-20261007T165501-7`, which
has preconditions only). All of these directories are kept.

**The gate** (`client/runner/control-gate.mjs`) originally looked for offers sent by the server and
found none; with this server and SDK the client sends the offer. It was corrected between the first
and second launch to count client offers that the server answered.

## The invalidated session

`control/janus-h0-O-20261007T213504-8`, invalid: "observer O2 detected a failure of its own
connection". S left, then O1 left, and the runner's leave call for O2 came about 6 s after O1's
instead of the usual 1–3 s; O2's audio from O1 passed its 2 s rule and O2 flagged it, about 5 s
after the analysis window had closed. Nothing happened on any layer inside the window. The record
is kept and the session was replaced (h0 on Janus: 9 tried, 8 valid). It is an invalidation, not a
false positive.

## Analysis

`client/runner/control-analyze.mjs`. Window: all three participants armed, to 0.5 s before the
first participant leaves. On 2026-10-07, after the Janus shakedown, it was changed to exclude the
state poller's own Janus session from room events (a `session destroyed` at the end of every Janus
session was being listed as a room event). That change postdates the LiveKit arm's first analysis.
The LiveKit analysis was re-run with the changed script on 2026-10-08: all 40 rows are identical
to the first run.

## Job logs

The AWS account ID and the nodes' public addresses are replaced by `<aws-account-id>` and
`<node-ip>` in the three session logs, as in the earlier job logs. The session records are as the
instrument wrote them; the LiveKit server logs in them contain participant access tokens, each
valid for two hours from its session.

## Correction

An earlier version of this file, and the message of commit `b35a832`, said five shakedown sessions
were invalidated by the runner bug. The count is four (two h1, two h2); the fifth directory is the
session that was killed and has no result. Found on 2026-10-08 by enumerating the directories
(`logs/study/removal-race/cohort.json`).
