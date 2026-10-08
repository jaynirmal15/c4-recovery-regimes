# R1 (DRAFT, NOT REGISTERED): does the removal race decide the LiveKit rebuilds?

Status: WITHDRAWN 2026-10-08. Never registered and never run. The author decided against any
intervention for the removal race; see `logs/study/removal-race/SERVER-TIMERS.md`. Kept as the
record of why the test first proposed (retry interval 5 s to 2 s) would have changed nothing. The
"not established" section below is superseded: the arrival time is the kernel's SYN schedule.

## Why the test as first proposed cannot be registered as it stands

The proposal was: shorten the retry interval from 5 s to 2 s; predict that outcomes change in
the rebuilds where the removal came after connectivity had returned (group A) and not in those
where it came before (group B).

The records say that change would not put a new attempt ahead of the removal in either group.
In all 39 settled rebuilds the client opened exactly one signalling connection before the
removal, at the start of its first restart attempt, and that attempt ran to its 15 s attempt
timeout. The second attempt began 5.19–5.20 s after the first ended. With a 2 s retry it would
have begun at 22.2–24.3 s (group A) and 23.9–24.2 s (group B); the removals were at 20.0–21.8 s.
That is before the removal in 0 of 13 and 0 of 26. The first attempt was still running when the
participant was removed in 11 of 13 and 26 of 26.

So in group A the client did have an attempt in flight: one connection, opened during the
isolation, that had not completed. An earlier statement that no attempt was in flight was wrong.
In this client a new connection is opened once per attempt, every (attempt timeout + retry)
= 15 s + 5 s. The retry interval moves the next attempt by 3 s; the attempt timeout is what
keeps it 15 s away.

Registering "retry 5 s to 2 s changes group A and not group B" would therefore register a
prediction the existing records already contradict; the expected result is no change anywhere.

## The groups, fixed here from logs/study/removal-race/livekit.json (commit 8e9664d)

Times are seconds after isolation onset.

Group A, removal after restore (13):

| Trial | D (s) | Restore (s) | Removal (s) | Removal − restore (s) | First attempt ends (s) | Second attempt begins (s) |
|---|---|---|---|---|---|---|
| `study/livekit-iso-all-19s-O-20261002T052953-3` | 19 | 19.08 | 20.13 | 1.05 | 22.22 | 27.41 |
| `study/livekit-iso-all-19s-O-20261002T062027-23` | 19 | 19.06 | 20.94 | 1.88 | 20.23 | 25.43 |
| `study/livekit-iso-all-19s-O-20261002T073111-51` | 19 | 19.07 | 20.27 | 1.20 | 22.16 | 27.35 |
| `study/livekit-iso-all-19s-O-20261002T074141-55` | 19 | 19.05 | 20.77 | 1.72 | 22.07 | 27.26 |
| `study/livekit-iso-all-19s-O-20261002T075418-60` | 19 | 19.06 | 20.04 | 0.97 | 22.13 | 27.33 |
| `study/livekit-iso-all-19s-O-20261002T090238-87` | 19 | 19.08 | 20.54 | 1.46 | 22.03 | 27.22 |
| `study/livekit-iso-all-19s-O-20261002T092502-96` | 19 | 19.07 | 20.67 | 1.60 | 22.16 | 27.35 |
| `study/livekit-iso-all-19s-O-20261002T094225-103` | 19 | 19.06 | 20.64 | 1.58 | 22.14 | 27.34 |
| `study/livekit-iso-all-19s-O-20261002T094500-104` | 19 | 19.06 | 20.74 | 1.68 | 22.24 | 27.43 |
| `study/livekit-iso-all-21s-O-20261002T052717-2` | 21 | 21.07 | 21.80 | 0.74 | 21.89 | 27.08 |
| `study/livekit-iso-all-21s-O-20261002T055504-13` | 21 | 21.07 | 21.25 | 0.19 | 22.15 | 27.34 |
| `study/livekit-iso-all-21s-O-20261002T072835-50` | 21 | 21.07 | 21.60 | 0.53 | 22.30 | 27.49 |
| `study-r2/livekit-iso-all-17s-O-20261002T162344-23` | 17 | 17.07 | 20.88 | 3.81 | 20.36 | 25.55 |

Group B, removal before restore (26):

| Trial | D (s) | Restore (s) | Removal (s) | Removal − restore (s) | First attempt ends (s) | Second attempt begins (s) |
|---|---|---|---|---|---|---|
| `study/livekit-iso-all-21s-O-20261002T060501-17` | 21 | 21.05 | 20.44 | -0.61 | 22.13 | 27.32 |
| `study/livekit-iso-all-21s-O-20261002T064309-32` | 21 | 21.07 | 20.83 | -0.24 | 21.91 | 27.11 |
| `study/livekit-iso-all-21s-O-20261002T082511-72` | 21 | 21.07 | 20.50 | -0.56 | 21.98 | 27.18 |
| `study/livekit-iso-all-21s-O-20261002T082748-73` | 21 | 21.07 | 20.69 | -0.38 | 22.17 | 27.37 |
| `study/livekit-iso-all-21s-O-20261002T084711-81` | 21 | 21.06 | 20.59 | -0.48 | 22.07 | 27.27 |
| `study/livekit-iso-all-21s-O-20261002T093438-100` | 21 | 21.07 | 20.52 | -0.55 | 22.00 | 27.20 |
| `study/livekit-iso-all-23s-O-20261002T061000-19` | 23 | 23.07 | 20.51 | -2.56 | 22.00 | 27.20 |
| `study/livekit-iso-all-23s-O-20261002T062754-26` | 23 | 23.06 | 20.85 | -2.22 | 21.94 | 27.14 |
| `study/livekit-iso-all-23s-O-20261002T063806-30` | 23 | 23.06 | 20.74 | -2.32 | 22.02 | 27.21 |
| `study/livekit-iso-all-23s-O-20261002T071107-43` | 23 | 23.05 | 21.74 | -1.32 | 22.22 | 27.41 |
| `study/livekit-iso-all-23s-O-20261002T080712-65` | 23 | 23.07 | 21.48 | -1.58 | 21.97 | 27.16 |
| `study/livekit-iso-all-23s-O-20261002T082233-71` | 23 | 23.06 | 21.33 | -1.73 | 22.01 | 27.20 |
| `study/livekit-iso-all-23s-O-20261002T090001-86` | 23 | 23.06 | 21.83 | -1.23 | 21.92 | 27.12 |
| `study/livekit-iso-all-23s-O-20261002T090514-88` | 23 | 23.07 | 20.70 | -2.37 | 21.99 | 27.18 |
| `study/livekit-iso-all-23s-O-20261002T091520-92` | 23 | 23.08 | 20.05 | -3.02 | 22.14 | 27.34 |
| `study/livekit-iso-all-23s-O-20261002T095005-106` | 23 | 23.06 | 20.12 | -2.94 | 22.02 | 27.22 |
| `study/livekit-iso-all-26s-O-20261002T055227-12` | 26 | 26.07 | 20.64 | -5.43 | 22.14 | 27.33 |
| `study/livekit-iso-all-26s-O-20261002T064802-34` | 26 | 26.08 | 20.71 | -5.36 | 22.00 | 27.20 |
| `study/livekit-iso-all-26s-O-20261002T072558-49` | 26 | 26.07 | 20.77 | -5.30 | 22.06 | 27.25 |
| `study/livekit-iso-all-26s-O-20261002T081459-68` | 26 | 26.07 | 20.06 | -6.01 | 21.94 | 27.14 |
| `study/livekit-iso-all-26s-O-20261002T093712-101` | 26 | 26.07 | 20.59 | -5.47 | 22.09 | 27.28 |
| `study/livekit-iso-all-30s-O-20261002T065256-36` | 30 | 30.07 | 21.46 | -8.61 | 21.95 | 27.15 |
| `study/livekit-iso-all-30s-O-20261002T071826-46` | 30 | 30.07 | 20.39 | -9.68 | 22.09 | 27.28 |
| `study/livekit-iso-all-30s-O-20261002T073347-52` | 30 | 30.07 | 21.83 | -8.24 | 21.94 | 27.14 |
| `study/livekit-iso-all-30s-O-20261002T080431-64` | 30 | 30.08 | 20.68 | -9.41 | 21.96 | 27.16 |
| `study/livekit-iso-all-30s-O-20261002T080950-66` | 30 | 30.07 | 20.88 | -9.19 | 21.96 | 27.16 |

Not in either group: the two rebuilt trials whose server logs cannot settle the order (`study/livekit-iso-all-19s-O-20261002T073906-54`, `study/livekit-iso-all-21s-O-20261002T061236-20`).

The groups are past trials. An intervention runs new trials in the same conditions, so the
contrast is by condition: full isolation at 19 s is group A in all 9 settled trials; 23, 26 and
30 s are group B in all 20; 21 s is split 3 to 6; the single 17 s trial is the one in which the
clock defect triggered detection early.

## What is not established, and limits any prediction

In the 22 settled full-isolation survivors (16, 17 and 18 s) the server received the accepted
resume 18.45–19.00 s after onset, whatever the outage length, and the client's record shows one
connection opened, at about 7.3 s. Why the request arrives when it does is not established from
the records. Until it is, the arrival time of a connection opened under a changed schedule
cannot be predicted to better than "after it is opened and after connectivity returns".

## Candidate interventions (the author to choose before registration)

1. **Retry 5 s to 2 s, as proposed.** Expected from the records: no outcome changes in A or B.
   Informative only as a check on the arithmetic above.
2. **Attempt timeout 15 s to a few seconds, retry unchanged or shortened**, so that a new
   connection is opened every few seconds. This is a policy parameter. It also changes the
   signalling-health rule of the driver, which uses the same constant, and an attempt that needs
   about 2 s to complete can be cut off by a short timeout; both would have to be stated.
3. **One additional resume attempt started by the runner at a fixed delay after it removes the
   isolation.** This manipulates the race variable directly and nothing else. It is not a policy
   a client could run, since a client does not know when connectivity returns, and it needs the
   driver to accept an action while another is in flight, which it does not do today.

For 2 or 3 the prediction would be: full isolation at 19 s survives; 23, 26 and 30 s are still
rebuilt; 21 s is mixed; and each new trial is classified from its own server log by whether the
removal preceded the first resume request the server received.

## What each outcome would mean (as the author stated it)

- Outcome changes concentrated in the group-A condition (19 s) and absent in the group-B
  conditions (23, 26, 30 s): supports the race reading.
- Changes spread across both: the manipulated parameter matters for some other reason and the
  race reading is unsupported.
- No change anywhere: the intervention has no purchase and the mechanism rests on the logs alone.

Janus is reported, not relied on: its client has a keepalive probe the LiveKit client lacks, so
"nothing moved on Janus" has another explanation available.
