# R3: attempt-timeout intervention on LiveKit

Registered 2026-10-09, before any trial of it and before the shakedown. The commit that adds this file
fixes its text; the prose is not edited afterwards. Order of events: this file committed, then the
runner and the scoring code (`client/runner/r3-score.mjs`) committed, then the shakedown, then the 100
trials. No trial is added after data are seen.

## What is varied

LiveKit, full isolation, the study's client build (pre-sampler), 3 nodes as in R2. One thing changes:
the signal-connection timeout livekit-client applies to each connection attempt
(`RoomConnectOptions.websocketTimeout`, default 15 s in 2.22.3), set on the subject before the join
and passed to `room.connect`. Every arm sets it through the same call, the 15 s arm included.

| Arm | Timeout | Durations (s) | Trials |
|---|---|---|---|
| W10 | 10 s | 14, 15, 16, 17 | 40 |
| W15 | 15 s | 18, 19 | 20 |
| W25 | 25 s | 18, 19, 26, 28 | 40 |

Ten valid trials a cell, one randomized order across all cells, an invalid trial replaced at most
three times per cell.

## Frozen quantities (from `logs/study/timeout-checks.txt`; none is refitted)

- Kernel unit 1.033 s; requests leave a connection at 0, 1, 2, 3, 4, 5, 7, 11, 19, 35 units after it opens.
- First attempt begins 6.85 to 7.37 s after onset (median 7.06); its connection opens 0.253 to 0.261 s later.
- The SDK's timer starts when the attempt begins. A further attempt begins 5.19 to 5.20 s after the last ended.
- Server reports ICE failure 15.04 to 16.83 s after onset when the path is still down; it removes the
  participant 5.000 to 5.002 s after that.
- Restore is confirmed 0.05 to 0.10 s after the nominal duration.

Attempt times that follow, for a trial at the medians: W10 begins 7.06, 22.26, 37.46 s; W15 7.06,
27.26 s; W25 7.06, 37.26 s.

## Primary rule P: does the first attempt's request receive a response (unconditional)

Observable, per trial, from the subject's recorded frames: the connection opened by the first attempt
received a frame from the server before that attempt ended. The type of the first such frame is
recorded: accepted (a reconnect response) or refused (a leave, with its reason and action). The server
log is not required.

What the frames can and cannot show: a response shows the request arrived, whether it was accepted or
refused. No response does not show that it did not arrive. "Reached the server" is therefore an
inference from this observable and is to be written as one. No cell's predicted verdict differs
between the two definitions: in the cells predicted to respond the response, accepted or refused, is
itself the evidence of arrival, and in the cells predicted not to respond the schedule sends no request
between restore and the end of the attempt. The definitions could come apart only if a request arrived
and the reply did not return before the SDK closed the connection; the schedule leaves 2.5 s (W10),
3.4 s (W15) and 5.1 s (W25) between the last request and that close.

| Cell | Last request inside the attempt leaves at | Prediction | Expected type |
|---|---|---|---|
| W10-14 | 14.34 to 14.86 s | response | accepted |
| W10-15, 16, 17 | | no response | |
| W15-18 | 18.47 to 18.99 s | response | accepted |
| W15-19 | | no response | |
| W25-18, 19, 26 | 26.73 to 27.25 s | response | accepted at 18 s; refused at 19 and 26 s |
| W25-28 | | no response | |

Resolution rule, per arm: the boundary is at D when at least 9 of 10 receive a response at D and at
most 1 of 10 does at the next tested duration above. The expected type is reported and is not part of
the verdict. Predicted boundaries: 14/15, 18/19, 26/28. A cell with 2 to
8 of 10 means the boundary is not resolved in that arm and is reported as unresolved, not
reinterpreted. Trials whose first attempt begins before 6.5 s (decoder defect) count as they fall.

## Secondary rule M: per-trial timing (its own hit rate)

For each trial, from its own recorded open time `o` and confirmed restore `R`: the response arrives at
`o + k × 1.033` for the first schedule point `k` with `o + k × 1.033 > R`, and a response is predicted if
that instant is before the attempt's begin time plus the arm's timeout. A hit is the right response or
no response and, where there is one, its arrival within 0.10 s of the predicted instant. Trials whose `R`
is within 0.16 s after a schedule instant are reported apart (the rules are removed up to 0.16 s
before the runner confirms it). No parameter is adjusted. Reported as hits of N, per arm and overall.

## Derived rule S: survive or rebuild

This is a prediction from the same arithmetic plus the server's two times. It is scored separately
from P.

| Cell | Prediction | Why |
|---|---|---|
| W10-14 | survive, 9 of 10 or more | first attempt answered before the server's ICE fails |
| W10-17 | rebuild, 9 of 10 or more | ICE failed before restore (61 of 61 recorded times); second connection opens about 22.0 to 22.9 s, after the removal at 20.0 to 21.8 s |
| W15-18 | survive, 9 of 10 or more | as in the study |
| W15-19 | rebuild, 9 of 10 or more | as in the study |
| W25-18 | survive, 9 of 10 or more | request arrives 18.5 to 19.0 s, before the removal |
| W25-19, 26 | rebuild, 9 of 10 or more | the request that arrives at 26.7 to 27.3 s is refused, the removal having happened |
| W25-28 | rebuild, 9 of 10 or more | first attempt times out near 32 s; second begins near 37.3 s |

Two timing statements are scored beside these counts and are not part of the 9-of-10 verdicts: the
W25-19 and W25-26 rebuilds complete by 28 s, and the W25-28 rebuilds complete after 37 s.

So lengthening the timeout moves the first-request boundary up (to 26/28) and does not move the
survival boundary (18/19). Shortening it moves the first-request boundary down (to 14/15).

**W10-15 and W10-16 are not determined by the frozen quantities.** In the 61 retained full-isolation
trials with a usable server log and an ICE failure, the failure was reported 15.04 to 16.83 s after
onset, always before the restore. A restore at 15 s (confirmed at 15.08 s) would precede 58 of those 61
failure times; a restore at 16 s, 13 of 61; a restore at 17 s, none. Whether the server's ICE recovers
when the path returns before it fails has not been observed under full isolation. Stated as an
assumption under test:

- A: if the path returns before the server's ICE fails, the server reports no failure and does not
  remove the participant; the second attempt is then accepted and the trial survives.
- W10-15 is the test of A. Under A the expected count is 58/61 of 10, about 9 or 10 survivors; under
  its negation, 0. Rule: 7 of 10 or more survive, A holds, and the survival boundary of the 10 s arm
  lies above 15 s, below the 15 s arm's 18/19 and above its own first-request boundary. 2 of 10 or
  fewer survive, A is false and the boundary is 14/15; that is reported as a finding about the server's
  ICE, not as evidence for or against the timing equation. 3 to 6 is unresolved.
- W10-16 is descriptive and carries no verdict. Under A the expected count is 13/61 of 10, about 2
  survivors; under its negation, 0. Its count is recorded and reported beside that expectation.
- A is also observed directly. For every trial whose server log covers onset to the client's last
  action, the server's ICE report for S (disconnected, failed, removal, or none) is recorded and
  reported beside the survival counts, with the coverage stated. Where both exist they should agree:
  no failure reported and survival, or failure reported and rebuild.

## Manipulation check and its failure rule

Shakedown, kept apart from the 100: one trial each at W10-17, W15-19 and W25-28. In each, the first
unanswered attempt must end within 50 ms of the set timeout (10.00, 15.00, 25.00 s after it began),
as recorded by the driver. The gate is in `client/runner/timeout.sh` and stops the session if it
fails.

In the 100, the same lifetime is recorded for every unanswered attempt. If in an arm the configured
timeout does not govern the outstanding connection request's lifetime, that arm is uninterpretable as
a test of the mechanism: it is reported as a failed manipulation and excluded, and is not reported as
evidence against the timing model.

## What would count against the model

- P: a boundary resolved at a different pair of durations from the predicted one in any arm.
- M: arrivals off the schedule by more than 0.10 s, or response and no response misclassified, beyond
  the trials set apart.
- S: W25 surviving at 19 s or later (the removal does not bind); W10-17 surviving (a second attempt
  arrives before the removal, or there is no removal).

## Validity, stops, session

As R2: the run-time validity checks of the study; stop on a change of node image, kubelet or kernel
from the recorded ones, or on client `tcp_syn_linear_timeouts` other than 4. One session under
`caffeinate -i -s` on AC power with the battery guard and the park trap. If the gate fails, park and
stop.
