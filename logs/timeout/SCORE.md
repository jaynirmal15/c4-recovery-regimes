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

| Early trial | Cell | Stream and first slipped sample | Form | Slipped samples in a row | Correction clause that would reject it | Deviation from its cell's prediction |
|---|---|---|---|---|---|---|
| livekit-iso-all-14s-O-W10-20261010T053432-97 | W10-14 | O1: 62.19 s at 0.15 s | wrapped (sender time ahead; read as about 62 s) | 3 | F | YES |
| livekit-iso-all-16s-O-W10-20261010T022442-31 | W10-16 | O1: 2.19 s at 0.17 s; O2: 2.19 s at 0.17 s | the committed form (age up by 1.5 to 2.5 s) | 3, 3 | B | no |
| livekit-iso-all-17s-O-W10-20261010T012941-12 | W10-17 | O1: 2.26 s at 0.21 s | the committed form (age up by 1.5 to 2.5 s) | 2 | B | YES |
| livekit-iso-all-18s-O-W25-20261010T052915-95 | W25-18 | O1: 62.15 s at 0.11 s | wrapped (sender time ahead; read as about 62 s) | 3 | F | YES |
| livekit-iso-all-19s-O-W25-20261010T034806-57 | W25-19 | O2: 62.21 s at 0.18 s | wrapped (sender time ahead; read as about 62 s) | 2 | F | no |

**What was fixed before the run and what was not.** R3's rule, registered before the run, fixed how these trials are counted: a first attempt beginning before 6.5 s is a decoder-defect trial and counts as it falls. That rule reads only the time of the first attempt. It is direction-agnostic, it identified the five trials with no reference to their samples, and the analysis had no free parameters here. Only the mechanism is post hoc: what the slipped samples are, in which direction they slip, and that the readings near 62 s are the same slip, were worked out after the run.

**The slip measured against an independent reference.** Where the subject's other incoming stream decoded a sample at the same instant (within 70 ms) and had not slipped, the difference between the two streams measures the slip directly, with nothing fitted and no reference to earlier samples:

| Early trial | Slipped stream | Other stream at the same instant | Slipped minus other (s) |
|---|---|---|---|
| livekit-iso-all-14s-O-W10-20261010T053432-97 | O1 | O2 | -2.00 |
| livekit-iso-all-16s-O-W10-20261010T022442-31 | O1 | O2 | 0.00 (both streams slipped together) |
| livekit-iso-all-16s-O-W10-20261010T022442-31 | O2 | O1 | 0.00 (both streams slipped together) |
| livekit-iso-all-17s-O-W10-20261010T012941-12 | O1 | O2 | +2.02 |
| livekit-iso-all-18s-O-W25-20261010T052915-95 | O1 | no sample within 70 ms | – |
| livekit-iso-all-19s-O-W25-20261010T034806-57 | O2 | no sample within 70 ms | – |

Available in 2 cases: -2.00 and +2.02 s. Each is one period of the 2 s fine chirp, once in each direction. One more instance exists outside this run, in the R2 records (below): +1.97 s.

**Crossing the two lists.** Of the 3 early trials that deviate from their cell's prediction, 1 slipped in the direction the committed text describes (the R2 registration's "age exceeding the samples either side of it by 1.5–2.5 s") and 2 slipped the other way and were recorded with an age of about 62 s.

**The wrap undone** (an identification made after the run). The decoder takes sender time modulo the 64 s period of the coarse chirp (common.js: `tm = ((tm % 64) + 64) % 64`, then the nearest 64 s multiple at or before the clock plus 0.5 s), so a sender time ahead of the receiver's clock is recorded 64.000 s older than it is. Subtracting 64.000 s:

| Early trial | Stream | Recorded age (s) | Minus 64 s | Step from the preceding sample (s) | Inside 1.5–2.5 s in size | Direction |
|---|---|---|---|---|---|---|
| livekit-iso-all-14s-O-W10-20261010T053432-97 | O1 | 62.19 | -1.81 | -1.88 | yes | younger (sender time ahead) |
| livekit-iso-all-16s-O-W10-20261010T022442-31 | O1 | 2.19 | 2.19 | +2.12 | yes | older (the committed direction) |
| livekit-iso-all-16s-O-W10-20261010T022442-31 | O2 | 2.19 | 2.19 | +2.12 | yes | older (the committed direction) |
| livekit-iso-all-17s-O-W10-20261010T012941-12 | O1 | 2.26 | 2.26 | +2.17 | yes | older (the committed direction) |
| livekit-iso-all-18s-O-W25-20261010T052915-95 | O1 | 62.15 | -1.85 | -1.92 | yes | younger (sender time ahead) |
| livekit-iso-all-19s-O-W25-20261010T034806-57 | O2 | 62.21 | -1.79 | -1.74 | yes | younger (sender time ahead) |

Every one of the 5 early trials is a step of 1.5–2.5 s. The readings near 62 s are that step in the younger direction read through the 64 s wraparound; they are not a second form of unknown size. What the committed text did not cover is the direction: it names a sample whose age exceeds its neighbours', and the wrapped ones read younger. For the 2 deviating trials of that kind the explanation is "the known one-period slip, opposite sign, wrap arithmetic undone": a narrower gap than "a form we had not documented", and still a post-run identification of the mechanism. A search by value of every file committed before the run (the tree at acfef63, 2026-10-09) for a sample age of 59.5 to 63.9 s found none outside the raw trial records; the first search had been for phrases and digits ("59.5", "wraps to", "sender time ahead", an age threshold of 32000).

**The 4.05 s reading in the R2 outputs is one period, not two, and it exposes a defect in R2's definition.** In `threshold/livekit-iso-all-2s-O-T4-20261008T055928-19` the driver recorded an effective age of 4.05 s for one stream at detection (logs/threshold/RUN-RECORD.md). That quantity is the time since the last decoded sample plus that sample's age: 1.59 s + 2.46 s. The sample itself had slipped by one period: its stream read 2.08 s where the other stream read 0.11 s at the same instant (+1.97 s), and 2.02 s above its own preceding sample. So the committed picture was one-period throughout, and the band covers this instance in size. What the registered definition does not cover is persistence. It requires the slipped sample to exceed the samples on both sides, and R2's scoring code tests both neighbours; in this trial and in all five early trials here the slip persisted for two to four samples until decoding stopped, so the sample after is slipped too and the two-sided test does not fire. It changed no R2 verdict: the definition applied only to T4 trials that took an action, and none did. It is recorded here as a defect in R2's definition: as written it would have missed each of the six instances examined here (the five early trials and this one). The study's six early trials were not re-examined for persistence.

**Every defect rate quoted in the record, and the detector behind it.** Two detectors exist. The *timing rule* reads only when the subject acted: detection before 1.5 s, or equivalently (the wait being 5.0–5.2 s) a first action before 6.5 s. The *signature test* is the R2 registration's two-sided sample test. The signature test misses a slip that persists, which was all six instances examined above, so any figure from it is a floor. Every trial-level rate quoted so far comes from the timing rule and is a count of trials in which the subject acted early:

| Figure | Population | Detector | Count or floor |
|---|---|---|---|
| 6 of 215 | the study, all retained trials: LiveKit full isolation 80 (2 early), LiveKit media-only 70 (3), Janus full isolation 40 (1), Janus media-only 25 (0) | timing (detection before 1.5 s) | count |
| 2 of 78 | the study's 80 LiveKit full-isolation trials less the 2 with no client row in the removal-race table (empty server log); the same two early trials as in the row above | timing (first action before 6.5 s) | count |
| 7 of 180 | LiveKit full isolation: the study's 80 (2) and R3's 100 (5) | timing (detection before 1.5 s) | count |
| 1 of 40 | Janus full isolation, the study | timing (detection before 1.5 s) | count |
| 5 of 100 | R3, all valid trials | timing (first attempt before 6.5 s, the registered rule) | count |
| 0 defect-triggered of 8 (R2, each condition) | R2's T4 trials that took an action (none did) | signature test, two-sided | floor |

"The study's six early trials" and "2 of 78" are therefore the same detector on nested populations: six in all 215 trials, of which two are in LiveKit full isolation. Both come from timing, so neither depends on the signature test and no re-examination for persistence is needed to stand behind the counts; persistence bears only on whether the R2 signature test would have flagged them. No comparison made so far sets a timing count against a signature-test figure: 5 of 100 against 2 of 78 is timing against timing.
Two limits on reading the timing counts as rates of the defect itself. They count trials in which a slip on a stream the subject receives tripped its rule; a slip at an observer, or one that reads too young to trip the rule, is not counted. As rates of the slip occurring anywhere they are floors. The R4 post-registration note computed its 33%, 22% and 48% from 7 of 180 and 1 of 40: as probabilities of an early start those rest on counts; as probabilities that the corrected decoder rejects a sample at the subject within 1 s of onset, which is what the informativeness criterion reads, they may be floors. The note is not amended.
Recorded without investigation: in livekit-iso-all-16s-O-W10-20261010T022442-31 both of the subject's incoming streams slipped together, by the same amount at the same instant. The defect is therefore not per-stream.

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
