# R2: the restart after a 2 s outage on LiveKit

Status: REGISTERED by the commit that adds this file, on 2026-10-08, before the lab was unparked
and before any trial of this run existed. The author approved the draft with four changes (arm
sizes; the margin derived from the instrument; a second defect criterion; the argument about the
threshold's second job); this is the draft with those changes and no others.

## The question

After a 2 s outage on LiveKit the client restarts the transport about 7 s after onset, because its
own rule fires: received audio more than 2 s old. In the 10 study trials of these two conditions
the observers' audio from the subject was already coming back before that restart, 0.4–1.1 s late
and draining (`logs/study/short-outage.txt`). The records cannot say whether the restart changes
the interruption the observers experience. This run measures the interruption when the restart
does not happen.

## Conditions

LiveKit v1.13.7 only. Two conditions, each reported separately and never pooled:

- full isolation, 2 s
- media-only isolation, 2 s

The 5 s conditions are not run: the rule read 6.95–7.04 s there, so a 4 s threshold would still
fire. Janus is not run: it took no restart in these conditions (0 of 10).

## Arms, in the same session

| Arm | Detection threshold (`mediaAgeMs`) | Trials per condition |
|---|---|---|
| T4, the intervention | 4000 ms | 8 |
| T2, the concurrent reference | 2000 ms, as in the 215 | 7 |

The arms are nearly equal on purpose: the verdict below uses ranges, and the range of a small
sample understates the true range, so unequal arms would lean towards finding a difference.

30 trials, all four arm-by-condition groups interleaved in one randomised order, in one lab
session. The T2 arm is the reference for the contrast. The 10 study trials of 2026-10-02 are
reported beside it, not pooled with it.

Nothing else differs between arms. Each trial records the constant in force (`params.mediaAgeMs`
in the subject's record).

## The threshold does two jobs, and why that does not contaminate the outcome

The constant is used in one place in the driver: audio is "healthy" when every received stream is
at most that old. So it decides both when the client declares a failure and when it declares
recovery. The outcome contrasted here is neither declaration. It is the interruption at the
observers, computed afterwards from the in-band clock decoded in the observers' browsers, with
the analysis thresholds of the 215, which do not change between arms and do not read the
subject's driver state. The driver's declarations can reach that quantity only by causing or not
causing a recovery action, which is the manipulation.

Two places where the second job could still matter, and what is done about each:

- A T4 trial can detect (rule over 4 s) and then be declared healthy again, under the same looser
  rule, before its 5 s wait ends, and so take no action. Such a trial is in the no-action group,
  because no action is the definition of that group; the number of T4 no-action trials that
  detected is reported.
- The runner ends a trial when the subject's driver has reported healthy for 30 s. A T4 trial that
  never detects is healthy throughout, so its observation ends about 30 s after restore, sooner
  after onset than a T2 trial's. If an observer has not reached fresh-again inside that window,
  the trial is reported as "not recovered within N s" with N stated, counted in neither verdict,
  and not given an interruption value.

## What is held as in the 215, and what is not

- Same server image by pinned digest, same chart and values, same client image, same client
  policy apart from the one constant, same runner sequence (15 s warm-up, arming, isolation,
  observation), same validity checks, same analysis code and thresholds.
- Client build: the copies of `common.js` and `driver.js` saved before the statistics sampler was
  added, plus `control-arm.js`, which will gain one function to set the constant in the T4 arm.
  Both arms load the same files; sha256 of every served file is recorded per trial.
- Not identical: new node instances; the LiveKit API key rotated on 2026-10-06; the 2 s conditions
  in the 215 ran with the driver before the resume-request fix, and this run uses the driver after
  it (no server resume request was sent in any 2 s trial, so the difference is not exercised).
- Node software is checked against the study's values before every trial, with a stop on mismatch.

## Measures

For each trial, from the unchanged analysis:

1. whether the subject's driver took any recovery action, and when;
2. the largest age the rule read before any action;
3. the interruption at the observers: first stale to fresh again at both, as defined for the 215
   (stale: older than 1 s, or 300 ms without a decoded sample; fresh again: within 250 ms of
   baseline for 1 s). This is the quantity contrasted;
4. the same at each observer separately.

## The contrast, and the four outcomes

The contrast is within a condition: T4 trials in which no recovery action was taken, against the T2
trials of the same condition in the same session.

"Differs" means: the two groups' ranges of interruption do not overlap, and their medians differ by
more than 0.90 s. "Indistinguishable" means: the ranges overlap and the medians differ by 0.90 s or
less. Anything else is reported as "not resolved by this sample".

The 0.90 s is derived from the measured error of the reference metric, as the largest amount by
which the instrument alone could move one trial's interruption (`logs/study/decoder/`):

| Source | Bound |
|---|---|
| Sampling: each endpoint is the time of a sample taken every 128 ms, two endpoints | 0.256 s |
| Low-reading samples on LiveKit (0.65% read 0.13–0.26 s young): fresh-again early by one sample, first-stale late by one sample | 0.256 s |
| A 10 ms playout-delay step, which the decoder reports as a gap of 0.384 s | 0.384 s |
| Sum, rounded up | 0.90 s |

The sum is taken linearly because these are bounded errors of unknown sign, not independent noise.
An effect smaller than 0.90 s is therefore not resolvable by this run, and is reported as such.

One instrument effect is not covered by the margin, because it can exceed it: a 0.384 s gap that
falls inside the 1 s hold restarts the hold. Every trial in which the fresh-again hold was
restarted by a single gap of 300–450 ms is listed, with its interruption computed both ways (as
analysed, and with that gap tolerated), and the verdict is computed both ways. If the two differ,
the verdict is reported as dependent on that gap. The verdict is also computed
with the fresh band at 125 ms and at 375 ms; if it changes across the three, it is reported as
dependent on the band.

1. **No restart in T4, and the interruption differs from T2.** The restart changes the interruption
   the observers experience in that condition. The direction is the result, whichever it is.
2. **No restart in T4, and the interruption is indistinguishable from T2.** The restart neither
   shortened nor lengthened it. The sentence in the draft that reads as if LiveKit restarts caused
   the additional staleness is withdrawn for these conditions.
3. **Some T4 trials still restart.** The rule read 3.48–3.82 s in nine of the ten study trials,
   against a 4 s threshold, so this is expected in some. A condition is informative if at least 6 of
   its 8 T4 trials took no action; with 5 or fewer the contrast is not drawn for that condition.
   In either case the split is reported and the restarting T4 trials are reported as their own
   group, with their interruptions; they are not dropped and not merged into T2.
4. **A decoder defect trips the rule.** Two defects are known, and at this margin the smaller is
   the more likely. A T4 trial that takes an action is classed as defect-triggered if either holds
   for the stream whose reading crossed the threshold:
   - *the 2 s defect:* the last decoded sample before the crossing has an age exceeding the samples
     either side of it by 1.5–2.5 s;
   - *the playout-delay step:* the crossing happened during an interval of more than 300 ms between
     consecutive decoded samples; the median age of the five samples after that interval exceeds
     the median of the five before it by 5–15 ms; and the reading would not have crossed the
     threshold within 256 ms of the last sample before the interval (256 ms being the longest
     interval the decoder produces without this defect).
   A defect-triggered trial is reported, with the samples, and left out of the contrast for that
   stated reason. It is not replaced, and it does not count toward the 6 of outcome 3. A crossing
   during an interval of more than 300 ms that lacks the 5–15 ms step is not classed as a defect;
   it is reported as a restarting trial with that interval noted.

An invalid trial (by the runner's existing checks) is replaced by the runner's existing rule, at
most three extra attempts per group, and every invalid trial is reported with its reason.

No trials are added after the data are seen. One session.

## Fixed in advance about the extrapolation

The straight-line drain in `logs/study/short-outage.txt` (the band reached at 7.8–9.6 s after onset
in full isolation and 8.0–10.7 s in media-only) is an extrapolation of what was recorded before
the restart. It is not a counterfactual, before or after this run. If the measured T4 interruption
lands near those figures, that is a measurement agreeing with an extrapolation; it does not turn
the extrapolation into a finding about the 215.

There is no directional prediction. The records are compatible with the restart shortening the
interruption, lengthening it, or leaving it unchanged.

## Recorded in the same session: the kernel's SYN retransmission setting

The explanation of the 11.33 s boundary rests on the default `tcp_syn_linear_timeouts` of Linux
v6.18 and a fit of 56 arrivals. From inside each client pod, before every trial, the runner will
record `net.ipv4.tcp_syn_linear_timeouts`, `net.ipv4.tcp_syn_retries` and the kernel release, as
part of the precondition checks; a trial does not start if they cannot be read. If the value is 4,
the caveat in `logs/study/removal-race/SERVER-TIMERS.md` is closed for these pods and this kernel.
If it is not 4, that is reported as it is and the explanation of the 11.33 s is reopened.

## What this run cannot show

It concerns two conditions, one server version, one client, one browser engine. It says nothing
about the 5 s conditions, where the restart would still fire, or about Janus. A null result at
n = 8 against n = 7 with a 0.90 s margin shows the effect is not large; it does not show there is
none.

## Cost

30 trials at about 2.2 minutes, four shakedown trials, unpark and park: about 1.6 hours of lab
time, about $0.55 at the rate in the lab notes.
