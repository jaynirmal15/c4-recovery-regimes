# R2 score

Scored by client/runner/r2-score.mjs from: threshold. Registered rule: margin 0.90 s; a condition is informative with at least 6 T4 trials that took no action.

Trials found: 30 LiveKit 2 s isolation trials (30 valid, 0 invalid); 0 other records not scored.
Self-check against analyze.mjs at the default thresholds: 30 of 30 agree.
Kernel settings read inside the client pods (30 trials, three pods each): {"release":"6.18.48-109.150.amzn2023.aarch64","tcp_syn_linear_timeouts":4,"tcp_syn_retries":6}

## LiveKit full isolation, 2 s

| Group | Trials | Detected | Took an action | Largest rule age before acting (s) | Interruption (s) | Median | Fresh-again (s after onset) | Observed after restore (s) |
|---|---|---|---|---|---|---|---|---|
| T2, concurrent reference | 7 | 7 | 7 | 3.48–3.67 | 7.30–7.84 | 7.68 | 7.74–8.13 | 58.39–63.17 |
| T4, no action | 8 | 1 | 0 | 3.51–5.37 | 7.55–10.16 | 8.92 | 7.94–10.31 | 55.08–57.72 |
| T4, restarted (not a defect) | 0 | 0 | 0 | – | – | – | – | – |
| T4, defect-triggered | 0 | 0 | 0 | – | – | – | – | – |

- T4 split: 8 no action, 0 restarted, 0 defect-triggered, of 8 valid. T4 no-action trials that had detected and were declared healthy again before acting: 1.
- T2 trials that took no action: 0 of 7.
- Observation headroom: T4 no-action trials were observed for at least 55.1 s after restore; the longest interruption in either arm is 10.16 s, 5.4 times shorter. Trials not recovered within the window: 0.

**Contrast: T4 no-action (8) against T2 (7).** Informative.
- as analysed (band 250 ms): **not resolved by this sample** (median T4 − T2 = 1.24 s; ranges overlap)
- band 125 ms: **not resolved by this sample** (median T4 − T2 = 2.31 s; ranges overlap)
- band 375 ms: **not resolved by this sample** (median T4 − T2 = 0.92 s; ranges overlap)
- gap of up to 450 ms tolerated in the hold: **not resolved by this sample** (median T4 − T2 = 1.24 s; ranges overlap)
- Registered verdict for this condition: **not resolved by this sample**.

| Trial | Arm | Detected at | Actions | Rule max (s) | First stale | Fresh again | Interruption | band 125 | band 375 | gap tolerated | per observer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `livekit-iso-all-2s-O-T2-20261008T051911-2` | T2 | 2.17 | restart@7.17 | 3.48 | 0.43 | 7.99 | 7.55 | 7.55 | 7.55 | 7.55 | 7.55 / 7.55 |
| `livekit-iso-all-2s-O-T2-20261008T052133-3` | T2 | 1.99 | restart@6.99 | 3.49 | 0.56 | 7.99 | 7.43 | 8.19 | 7.43 | 7.43 | 7.42 / 7.42 |
| `livekit-iso-all-2s-O-T2-20261008T052622-5` | T2 | 2.08 | restart@7.28 | 3.62 | 0.45 | 8.13 | 7.68 | 7.68 | 7.68 | 7.68 | 7.55 / 7.68 |
| `livekit-iso-all-2s-O-T2-20261008T053327-8` | T2 | 1.99 | restart@6.99 | 3.54 | 0 | 7.74 | 7.74 | 7.74 | 7.74 | 7.74 | 7.73 / 7.74 |
| `livekit-iso-all-2s-O-T2-20261008T054737-14` | T2 | 1.96 | restart@6.96 | 3.65 | 0 | 7.84 | 7.84 | 7.84 | 7.84 | 7.84 | 7.83 / 7.84 |
| `livekit-iso-all-2s-O-T2-20261008T060627-22` | T2 | 2.07 | restart@7.07 | 3.59 | 0.01 | 7.83 | 7.83 | 7.83 | 7.83 | 7.83 | 7.81 / 7.81 |
| `livekit-iso-all-2s-O-T2-20261008T061823-27` | T2 | 2.12 | restart@7.12 | 3.67 | 0.56 | 7.86 | 7.3 | 7.3 | 7.3 | 7.3 | 7.3 / 7.3 |
| `livekit-iso-all-2s-O-T4-20261008T052847-6` | T4 | – | none | 3.63 | 0.56 | 8.63 | 8.07 | 8.19 | 7.69 | 8.07 | 8.06 / 8.06 |
| `livekit-iso-all-2s-O-T4-20261008T053554-9` | T4 | – | none | 3.51 | 0 | 9.13 | 9.13 | 10.67 | 8.62 | 9.13 | 8.89 / 9.09 |
| `livekit-iso-all-2s-O-T4-20261008T053813-10` | T4 | – | none | 3.52 | 0.45 | 10.31 | 9.86 | 10.37 | 8.97 | 9.86 | 9.34 / 9.86 |
| `livekit-iso-all-2s-O-T4-20261008T055928-19` | T4 | 2.03 | none | 5.37 | 0 | 10.16 | 10.16 | 11.18 | 9.26 | 10.16 | 10.03 / 10.16 |
| `livekit-iso-all-2s-O-T4-20261008T060148-20` | T4 | – | none | 3.66 | 0.45 | 9.79 | 9.34 | 10.62 | 9.09 | 9.34 | 9.34 / 9.22 |
| `livekit-iso-all-2s-O-T4-20261008T060407-21` | T4 | – | none | 3.59 | 0.51 | 9.22 | 8.71 | 9.73 | 8.58 | 8.71 | 8.7 / 8.7 |
| `livekit-iso-all-2s-O-T4-20261008T061332-25` | T4 | – | none | 3.61 | 0.39 | 7.94 | 7.55 | 8.06 | 7.3 | 7.55 | 7.55 / 7.42 |
| `livekit-iso-all-2s-O-T4-20261008T062050-28` | T4 | – | none | 3.68 | 0.49 | 8.05 | 7.56 | 8.2 | 7.44 | 7.56 | 7.55 / 7.55 |

## LiveKit media-only isolation, 2 s

| Group | Trials | Detected | Took an action | Largest rule age before acting (s) | Interruption (s) | Median | Fresh-again (s after onset) | Observed after restore (s) |
|---|---|---|---|---|---|---|---|---|
| T2, concurrent reference | 7 | 7 | 7 | 3.48–3.68 | 7.43–7.68 | 7.56 | 7.97–8.16 | 58.52–62.67 |
| T4, no action | 8 | 0 | 0 | 3.52–3.78 | 6.79–10.38 | 9.38 | 7.35–10.81 | 54.90–55.89 |
| T4, restarted (not a defect) | 0 | 0 | 0 | – | – | – | – | – |
| T4, defect-triggered | 0 | 0 | 0 | – | – | – | – | – |

- T4 split: 8 no action, 0 restarted, 0 defect-triggered, of 8 valid. T4 no-action trials that had detected and were declared healthy again before acting: 0.
- T2 trials that took no action: 0 of 7.
- Observation headroom: T4 no-action trials were observed for at least 54.9 s after restore; the longest interruption in either arm is 10.38 s, 5.3 times shorter. Trials not recovered within the window: 0.

**Contrast: T4 no-action (8) against T2 (7).** Informative.
- as analysed (band 250 ms): **not resolved by this sample** (median T4 − T2 = 1.83 s; ranges overlap)
- band 125 ms: **not resolved by this sample** (median T4 − T2 = 2.86 s; ranges overlap)
- band 375 ms: **not resolved by this sample** (median T4 − T2 = 1.12 s; ranges overlap)
- gap of up to 450 ms tolerated in the hold: **not resolved by this sample** (median T4 − T2 = 1.83 s; ranges overlap)
- Registered verdict for this condition: **not resolved by this sample**.

| Trial | Arm | Detected at | Actions | Rule max (s) | First stale | Fresh again | Interruption | band 125 | band 375 | gap tolerated | per observer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `livekit-iso-media-2s-O-T2-20261008T052359-4` | T2 | 2.07 | restart@7.07 | 3.48 | 0.47 | 8.03 | 7.56 | 7.56 | 7.56 | 7.56 | 7.55 / 7.55 |
| `livekit-iso-media-2s-O-T2-20261008T054253-12` | T2 | 2.12 | restart@7.12 | 3.58 | 0.49 | 8.05 | 7.57 | 7.57 | 7.57 | 7.57 | 7.55 / 7.55 |
| `livekit-iso-media-2s-O-T2-20261008T055000-15` | T2 | 2.19 | restart@7.19 | 3.53 | 0.5 | 8.06 | 7.56 | 7.56 | 7.56 | 7.56 | 7.55 / 7.55 |
| `livekit-iso-media-2s-O-T2-20261008T055443-17` | T2 | 2.08 | restart@7.08 | 3.59 | 0.45 | 8.01 | 7.56 | 7.94 | 7.56 | 7.56 | 7.55 / 7.55 |
| `livekit-iso-media-2s-O-T2-20261008T061555-26` | T2 | 2.05 | restart@7.05 | 3.57 | 0.44 | 7.99 | 7.55 | 7.81 | 7.55 | 7.55 | 7.42 / 7.55 |
| `livekit-iso-media-2s-O-T2-20261008T062311-29` | T2 | 2.1 | restart@7.3 | 3.68 | 0.48 | 8.16 | 7.68 | 7.68 | 7.68 | 7.68 | 7.68 / 7.68 |
| `livekit-iso-media-2s-O-T2-20261008T062538-30` | T2 | 2.11 | restart@7.11 | 3.58 | 0.54 | 7.97 | 7.43 | 7.68 | 7.43 | 7.43 | 7.42 / 7.42 |
| `livekit-iso-media-2s-O-T4-20261008T051647-1` | T4 | – | none | 3.65 | 0.56 | 7.35 | 6.79 | 7.69 | 6.54 | 6.79 | 6.78 / 6.78 |
| `livekit-iso-media-2s-O-T4-20261008T053108-7` | T4 | – | none | 3.58 | 0 | 8.95 | 8.95 | 9.72 | 8.31 | 8.95 | 8.95 / 8.83 |
| `livekit-iso-media-2s-O-T4-20261008T054033-11` | T4 | – | none | 3.63 | 0.42 | 9.77 | 9.35 | 10.5 | 8.84 | 9.35 | 9.34 / 9.34 |
| `livekit-iso-media-2s-O-T4-20261008T054517-13` | T4 | – | none | 3.52 | 0 | 9.93 | 9.93 | 11.32 | 9.54 | 9.93 | 9.73 / 9.93 |
| `livekit-iso-media-2s-O-T4-20261008T055225-16` | T4 | – | none | 3.52 | 0.44 | 10.81 | 10.38 | 11.79 | 10.12 | 10.38 | 10.37 / 10.37 |
| `livekit-iso-media-2s-O-T4-20261008T055707-18` | T4 | – | none | 3.61 | 0.43 | 10.8 | 10.37 | 11.26 | 9.99 | 10.37 | 10.24 / 10.37 |
| `livekit-iso-media-2s-O-T4-20261008T060852-23` | T4 | – | none | 3.78 | 0.53 | 8.35 | 7.82 | 8.58 | 7.56 | 7.82 | 7.81 / 7.81 |
| `livekit-iso-media-2s-O-T4-20261008T061113-24` | T4 | – | none | 3.65 | 0 | 9.42 | 9.42 | 10.57 | 8.52 | 9.42 | 9.42 / 9.42 |

The straight-line drain in logs/study/short-outage.txt is an extrapolation and is not used here; agreement or disagreement with it is not a finding about the 215.
