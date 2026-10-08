# R2 run record: detection threshold, LiveKit, 2 s outages

Registration: `REGISTRATION-R2-detection-threshold.md`, commit `29ddf19` (2026-10-08 04:57 UTC).
Runner code and the scoring script `client/runner/r2-score.mjs`: commit `4d96804` (05:04 UTC).
Lab unparked 05:05:32 UTC. Neither file changed between that commit and the scoring below.

## The session

| | UTC |
|---|---|
| Unparked | 2026-10-08 05:05:32 |
| Shakedown, four trials (`threshold-shakedown/`), all valid; gate passed | 05:07–05:16 |
| The 30 registered trials (`threshold/`) | 05:16–06:28 |
| Parked, verified by the script and from the EC2 and EKS APIs | 06:46:33 |

30 tried, 30 valid, none replaced, no precondition abort. One randomised order
(`threshold/order-livekit.jsonl`). Three `c7g.large` nodes, new instances, node software equal to
the study's (checked before every trial). Client build: the pre-sampler `common.js` and
`driver.js` with `control-arm.js`; sha256 of the served files is in every record.

The shakedown trials are kept apart and are not scored with the 30.

## Kernel settings inside the client pods

Read before every trial in all three pods, in all 34 trials: kernel
`6.18.48-109.150.amzn2023.aarch64`, `tcp_syn_linear_timeouts = 4`, `tcp_syn_retries = 6`. That is
the default the explanation of the 11.33 s boundary assumed
(`logs/study/removal-race/SERVER-TIMERS.md`). Still not done: reading Amazon's kernel source
rather than upstream v6.18.

## Result, as scored by the registered rule (`SCORE.md`, `score.json`)

| Condition | T2, restart (7) | T4, no action (8) | Median T4 − T2 | Ranges | Registered verdict |
|---|---|---|---|---|---|
| Full isolation, 2 s | 7.30–7.84 s, median 7.68 | 7.55–10.16 s, median 8.92 | +1.24 s | overlap | not resolved by this sample |
| Media-only, 2 s | 7.43–7.68 s, median 7.56 | 6.79–10.38 s, median 9.38 | +1.83 s | overlap | not resolved by this sample |

- No T4 trial took a recovery action (16 of 16), so both conditions are informative (at least 6 of
  8 needed) and outcome 3 did not arise. All 14 T2 trials restarted.
- The verdict is the same with the band at 125 ms and at 375 ms and with a 450 ms gap tolerated in
  the hold. No trial's hold was restarted by a single 300–450 ms gap.
- The medians differ by more than the 0.90 s margin in both conditions, with the no-restart arm
  longer, but the ranges overlap, so the registered rule returns neither "differs" nor
  "indistinguishable". In full isolation 2 of the 8 T4 trials fall inside the T2 range and 6 above
  it; in media-only 7 are above it and 1 is below it.
- Outcome 4: no trial was defect-triggered under the registered definition, which applies to
  trials that took an action. One T4 trial is reported because the 2 s decoder defect did reach its
  rule: `livekit-iso-all-2s-O-T4-20261008T055928-19` detected at 2.03 s on a reading of 4.05 s from
  one stream (the other read 2.07 s), was declared healthy again at 4.83 s, and took no action. By
  the registration it is a no-action trial that detected, and it is in the contrast (10.16 s, the
  longest). Not registered, stated for transparency: without it the full-isolation T4 range is
  7.55–9.86 s and the verdict is unchanged.

## Observation window

T4 trials were observed for 54.9–57.7 s after restore, not the "about 30 s" the registration
expected, and T2 trials for 58.4–63.2 s. The longest interruption in either arm is 10.38 s, more
than five times shorter than the shortest window. No trial was "not recovered within the window".
The asymmetry between the arms that the registration named did not bite.

## What this does and does not show

It does not show that the restart lengthens the interruption; no trial and no summary points that
way. It does not show, by the registered rule, that the restart shortens it. The straight-line
drain in `logs/study/short-outage.txt` remains an extrapolation and is not confirmed or refuted by
this run.

## Job log

The AWS account ID and the nodes' public addresses are replaced by placeholders in `session.log`.
The trial records are as the instrument wrote them; the LiveKit server logs in them contain
participant access tokens valid for two hours and per-room `turnPassword` values (see
`PRE-PUBLIC-CHECKLIST.md`).
