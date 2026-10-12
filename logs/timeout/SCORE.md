# R3 score (timeout/)

Valid trials scored: 100. Invalid, listed and not scored: 3 (livekit-iso-all-16s-O-W10-20261010T023724-35; livekit-iso-all-19s-O-W15-20261010T023402-34; livekit-iso-all-26s-O-W25-20261010T024211-36).
Cells short of ten valid trials: none; over ten: none.

## Manipulation check

- W10: 31 unanswered attempts in 31 trials; lifetime 10004–10007 ms; outside 50 ms of the set value: 0. passes
- W15: 10 unanswered attempts in 10 trials; lifetime 15004–15006 ms; outside 50 ms of the set value: 0. passes
- W25: 10 unanswered attempts in 10 trials; lifetime 25004–25006 ms; outside 50 ms of the set value: 0. passes

## Primary rule P: the first attempt's request receives a response

| Cell | Valid | Responded | of which accepted | of which refused | Predicted | Reading |
|---|---|---|---|---|---|---|
| W10-14 | 10 | 9 | 9 | 0 | responds | as predicted |
| W10-15 | 10 | 0 | 0 | 0 | no response | as predicted |
| W10-16 | 10 | 0 | 0 | 0 | no response | as predicted |
| W10-17 | 10 | 0 | 0 | 0 | no response | as predicted |
| W15-18 | 10 | 10 | 10 | 0 | responds | as predicted |
| W15-19 | 10 | 0 | 0 | 0 | no response | as predicted |
| W25-18 | 10 | 10 | 9 | 1 | responds | as predicted |
| W25-19 | 10 | 10 | 0 | 10 | responds | as predicted |
| W25-26 | 10 | 10 | 0 | 10 | responds | as predicted |
| W25-28 | 10 | 0 | 0 | 0 | no response | as predicted |

- W10: boundary at 14/15: AS PREDICTED
- W15: boundary at 18/19: AS PREDICTED
- W25: boundary at 26/28: AS PREDICTED

Trials whose first attempt began before 6.5 s (decoder defect), counted as they fell: livekit-iso-all-14s-O-W10-20261010T053432-97 (W10-14, no response); livekit-iso-all-16s-O-W10-20261010T022442-31 (W10-16, no response); livekit-iso-all-17s-O-W10-20261010T012941-12 (W10-17, no response); livekit-iso-all-18s-O-W25-20261010T052915-95 (W25-18, responded); livekit-iso-all-19s-O-W25-20261010T034806-57 (W25-19, responded).
Rate, stated plainly: 5 of 100 trials here began their first attempt before 6.5 s. In the study the same early start occurred in 2 of the 78 retained LiveKit full-isolation trials with a client record (logs/study/timeout-checks.txt) and in 6 of all 215 trials. The rate here is higher (5% against 2.6%); with these counts the difference is not distinguishable from chance (Fisher's exact test, two-sided, p = 0.47 for 5 of 100 against 2 of 78, computed once by hand and not by this script). The defect was documented before this run: logs/study/decoder/ (commit d2fbee6, 2026-10-07), the R2 registration's definition of "the 2 s defect" (2026-10-08), and this registration's own sentence that such trials count as they fall.
Of these, the trials that are a deviation from their cell's predicted response or outcome: livekit-iso-all-14s-O-W10-20261010T053432-97 (W10-14); livekit-iso-all-17s-O-W10-20261010T012941-12 (W10-17); livekit-iso-all-18s-O-W25-20261010T052915-95 (W25-18). Every deviation from a predicted response or outcome in a determined cell, early or not: livekit-iso-all-14s-O-W10-20261010T053432-97 (W10-14, early); livekit-iso-all-17s-O-W10-20261010T012941-12 (W10-17, early); livekit-iso-all-18s-O-W25-20261010T052915-95 (W25-18, early).

## Secondary rule M: per-trial timing

Trials with a first connection: 100 of 100. Set apart (restore within 0.16 s after a schedule instant): 1, of which hits 1.
- W10: 39 hits of 39 | response classified correctly 39 | arrival minus predicted, where a response came: 0.03–0.08 s (9)
- W15: 20 hits of 20 | response classified correctly 20 | arrival minus predicted, where a response came: -0.03–0.04 s (10)
- W25: 29 hits of 40 | response classified correctly 40 | arrival minus predicted, where a response came: -0.19–0.39 s (30)
- all: 88 hits of 99 | response classified correctly 99 | arrival minus predicted, where a response came: -0.19–0.39 s (49)

Misses: livekit-iso-all-18s-O-W25-20261010T052915-95 open 5.49 restore 18.07 predicted response at 25.12; observed refused STATE_MISMATCH/RECONNECT at 25.44 | livekit-iso-all-19s-O-W25-20261010T010527-3 open 7.30 restore 19.06 predicted response at 26.93; observed refused STATE_MISMATCH/RECONNECT at 26.74 | livekit-iso-all-19s-O-W25-20261010T034806-57 open 5.59 restore 19.07 predicted response at 25.22; observed refused STATE_MISMATCH/RECONNECT at 25.60 | livekit-iso-all-19s-O-W25-20261010T043428-74 open 7.24 restore 19.08 predicted response at 26.86; observed refused STATE_MISMATCH/RECONNECT at 27.24 | livekit-iso-all-19s-O-W25-20261010T050607-86 open 7.28 restore 19.07 predicted response at 26.91; observed refused STATE_MISMATCH/RECONNECT at 27.11 | livekit-iso-all-19s-O-W25-20261010T051352-89 open 7.53 restore 19.08 predicted response at 27.16; observed refused STATE_MISMATCH/RECONNECT at 27.31 | livekit-iso-all-26s-O-W25-20261010T012124-9 open 7.15 restore 26.07 predicted response at 26.78; observed refused STATE_MISMATCH/RECONNECT at 27.05 | livekit-iso-all-26s-O-W25-20261010T012411-10 open 7.29 restore 26.09 predicted response at 26.91; observed refused STATE_MISMATCH/RECONNECT at 26.75 | livekit-iso-all-26s-O-W25-20261010T032008-47 open 7.15 restore 26.08 predicted response at 26.78; observed refused STATE_MISMATCH/RECONNECT at 27.15 | livekit-iso-all-26s-O-W25-20261010T045535-82 open 7.38 restore 26.07 predicted response at 27.01; observed refused STATE_MISMATCH/RECONNECT at 27.22 | livekit-iso-all-26s-O-W25-20261010T051631-90 open 7.29 restore 26.07 predicted response at 26.91; observed refused STATE_MISMATCH/RECONNECT at 27.23

## Derived rule S: survive or rebuild

| Cell | Valid | Survive | Rebuild | Rebuild completed (s) | Predicted | Reading |
|---|---|---|---|---|---|---|
| W10-14 | 10 | 10 | 0 | – | survive, 9 or more | as predicted |
| W10-15 | 10 | 9 | 1 | 22.92–22.92 | under A: 7 or more survive | assumption A holds |
| W10-16 | 10 | 4 | 6 | 22.82–22.99 | none | descriptive, no verdict (expected about 2 of 10 under A, 0 otherwise) |
| W10-17 | 10 | 1 | 9 | 22.74–23.05 | rebuild, 9 or more | as predicted |
| W15-18 | 10 | 10 | 0 | – | survive, 9 or more | as predicted |
| W15-19 | 10 | 0 | 10 | 27.80–28.04 | rebuild, 9 or more | as predicted |
| W25-18 | 10 | 9 | 1 | 26.06–26.06 | survive, 9 or more | as predicted |
| W25-19 | 10 | 0 | 10 | 26.16–27.92 | rebuild, 9 or more | as predicted |
| W25-26 | 10 | 0 | 10 | 27.21–27.76 | rebuild, 9 or more | as predicted |
| W25-28 | 10 | 0 | 10 | 37.68–37.95 | rebuild, 9 or more | as predicted |

Timing parts of S: W25-19 and W25-26 rebuilds completed by 28 s: W25-19 10 of 10, W25-26 10 of 10; W25-28 rebuilds completed after 37 s: 10 of 10.

## Assumption A observed directly: the server's ICE report, W10-15 and W10-16

- W10-15: server log usable in 10 of 10. No ICE failure reported: 9; failure reported: 1 (at 15.01–15.01 s). Outcome agrees with the report (no failure and survive, or failure and rebuild): 10 of 10. Survivors whose second attempt was accepted: 9 of 9.
- W10-16: server log usable in 8 of 10. No ICE failure reported: 4; failure reported: 4 (at 15.27–16.74 s). Outcome agrees with the report (no failure and survive, or failure and rebuild): 8 of 8. Survivors whose second attempt was accepted: 4 of 4.
- all cells: server log usable in 88 of 100; ICE failure reported at 15.01–16.92 s (66); removal minus failure 5.00–5.01 s.

## Recorded times

First attempt begins 6.83–7.34 s; connection opened 7.09–7.60 s; restore minus nominal 0.05–0.11 s.
