# R4: corrected-decoder replication

Registered 2026-10-11, before any trial of it and before the shakedown. The commit that adds this file
fixes its text; the prose is not edited afterwards. Order of events: this file committed, then the
corrected client build, the runner and the scoring code (`client/runner/r4-score.mjs`) committed, then
one shakedown trial per stack, then the 20 trials. No trial is added after data are seen.

## What is tested

In the study the audio-clock decoder's 2 s defect made the subject's detection fire about 1.7 s early in
6 of 215 trials and changed the outcome of two: LiveKit full isolation at 17 s (one rebuild where the
other nine restarted) and Janus full isolation at 5 s (one restart where the other four rode the outage
out). This run repeats those two conditions with a corrected decoder, ten valid trials each, one stack at
a time, on the study's client build with one change.

## The correction, verbatim

In `attachRemote`, after a sample `{tP, tS, age = tP - tS}` has passed the decoder's existing checks
and before it is used or recorded, with `lastOk` the last accepted sample of the same stream:

- **F**: reject if `age >= 32000` ms. The sample's sender time is ahead of the receiver's clock; the
  existing code records that as an age of about 60 to 63 s through the 64 s wrap.
- **B**: reject if `lastOk` exists and `tP - lastOk.tP < 1000` ms and
  `1500 <= lastOk.tS - tS <= 2500` ms. The sender time has stepped back by one period of the fine chirp
  within a second.

A rejected sample is logged (`decoder_reject`, with the clause and both samples) and is neither
recorded as a sample nor used by the detection rule. Nothing else in the client changes. The build is
`client/builds/common.js.corrected-decoder`, served with the pre-sampler `driver.js`; every trial
records the served files' hashes.

**The design that was rejected.** A first version of B rejected any backward step in sender time of
more than 0.5 s. Replayed over the study's recorded samples it rejected 185 samples, 149 of them
stepping back by more than 2.5 s, up to 14.1 s, during recovery. Those are not the defect, and
dropping them would have changed the measurement the study reports. B was narrowed to the one-period
window, which is the window the R2 registration used to define the 2 s defect.

## What the offline replay is, and is not

The correction was replayed over every recorded sample of the study (215 trials), the healthy sessions
(80) and R3 (100): `logs/study/decoder/correction-replay.txt`. It rejected 77, 12 and 35 samples; the
replayed detection of the 6 and 5 early trials moved to 1.90–1.95 s and 1.85–2.00 s; no other trial's
replayed detection changed.

**The replay is not evidence that the correction works.** The correction is defined from the defect's
own recorded signature, so on recorded data it removes what it was shaped to remove and cannot fail.
The replay shows only that the rule, as written, does not reject samples outside that signature in
those records. The twenty live trials are the test. The manuscript must not present replay numbers as
evidence that the correction works.

Two limits, registered now:

1. **The corrector is one-sided.** A slip that makes a sample read too young passes both clauses. No
   such slip has tripped the detection rule in the records, and this run cannot show that none will.
2. **The live build has never run.** The replay validates the logic on recorded samples, not the
   implementation in a browser. The shakedown and the 20 trials are its first execution.

The 12 rejections in healthy sessions were examined. All are clause F. Five are at or next to the first
sample of a stream, before the session was armed. Six are in one Janus session, at the subject, in the
0.1 to 0.4 s after the subject itself had left. One is the first sample of a bystander's newly attached
stream, 40 s into a LiveKit session; it is the only one inside a session's scored window and it is not
on the subject's stream. (The bystanders' own records, which the replay does not read, hold three more
of the after-leave kind.)

## Predictions

Detection band: **1.8 to 2.2 s** after onset. This is not the plan's 1.9–2.2 s. It is set from the
driver's recorded detection in the 212 full-isolation trials of the study and R3 whose detection was
not early: 1.83–2.17 s on LiveKit (173) and 1.87–2.13 s on Janus (39). The replay's 1.85 s lies inside
it; the replay also steps time more finely than the driver's 200 ms tick and ran up to 0.22 s ahead of
the recorded detection, so its values are not themselves the band.

**LiveKit, full isolation, 17 s.**
- Supports: 10 of 10 survive by restart, with every detection in the band and every first connection
  opened 7.05 to 7.65 s after onset (the recorded range of non-early trials is 7.09–7.63 s).
- Weighs against: a rebuild while detection is in the band. The study has not established that this
  condition is deterministic, so a rebuild is examined (timing, retries, the server's events) to find
  which assumption failed, and is not an automatic verdict.
- Incomplete correction: any detection outside the band. The arm then tests nothing.

**Janus, full isolation, 5 s.**
- Supports: 10 of 10 ride the outage out with no recovery action and every detection in the band.
- Weighs against: a recovery action while detection is in the band; examined as above.
- Incomplete correction: any detection outside the band.

## When a trial is informative about the correction

The defect is rare: an early start in 7 of the 180 LiveKit and 1 of the 40 Janus full-isolation trials
of the study and R3. Ten trials without the correction would be expected to show no early start about
two times in three on LiveKit and three times in four on Janus. So ten successes do not by themselves
show that the correction did anything.

A trial is **informative** when the subject's corrected decoder logged a rejection within 1 s after
onset: the defect occurred and the correction was exercised where it acts. The score reports the
number of informative trials per arm, and for each its rejected samples, its detection and its
outcome. With none in an arm, that arm shows that the corrected build behaves as the study build does
when the defect is absent, and says nothing about the correction. Rejections at the observers within
1 s of onset are reported as well: they exercise the same code on live audio but not the path to an
outcome.

## Healthy audio

The plan asked for the corrected decoder to be run over the control sessions' healthy audio. Those
sessions recorded decoded samples, not audio, so only the replay above is possible for them. In this
run every rejection is classified by where it falls; a rejection that is not within 1 s after onset,
not during the outage or the 30 s after restore, and not within 3 s of a stream attaching or a
participant leaving is a rejection in healthy audio and is listed individually. The score also counts
recorded samples with an age of 32 s or more, which the correction should leave at zero.

## What this run cannot establish

It can validate the explanation of two specific anomalies. It cannot show that the instrument is
independent of the recovery client: the clock still sits inside the client's control loop. The 215
trials are kept as they are, and this run is reported as a separate population.

## Shakedown, validity, session

One shakedown trial per stack, kept apart, before that stack's ten. Gate: valid; the recorded build is
`corrected-decoder` and the served `common.js` has the committed file's hash; a detection is recorded;
each participant's record can be read for `decoder_reject` lines. Validity checks and stops as in R2
and R3. One session on AC power under `caffeinate -i -s` with the battery guard and the park trap. If
a gate fails, park and stop.
