# R4 score (replication/)

Valid trials scored: 20. Invalid, listed and not scored: 0.
Design intent (REGISTRATION-R4-NOTE-1.md, written after the run had begun and not part of the registration): the run is powered for the primary question, whether a corrected instrument reproduces ten restarts and ten ride-outs. Whether the correction catches the defect live is answered only by informative trials, expected in a little under half of runs like this one.
The note's 33%, 22% and 48% were computed from timing-rule counts of early starts (7 of 180, 1 of 40). As rates of the corrected decoder rejecting a sample at the subject within 1 s of onset, which is what "informative" reads here, those may be floors (logs/timeout/SCORE.md). The note is not amended.
Build recorded in every scored trial: corrected-decoder.

## livekit, full isolation, 17 s

| Trial | Detection (s) | In band | First action | Connection opened (s) | Outcome | Rejected at S within 1 s of onset | All rejections |
|---|---|---|---|---|---|---|---|
| livekit-iso-all-17s-O-R4-20261012T021610-1 | 2.03 | yes | transport_restart at 7.03 | 7.29 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T021848-2 | 1.97 | yes | transport_restart at 6.97 | 7.22 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T022127-3 | 2.15 | yes | transport_restart at 7.15 | 7.40 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T022401-4 | 2.02 | yes | transport_restart at 7.02 | 7.28 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T022634-5 | 1.94 | yes | transport_restart at 6.94 | 7.20 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T022906-6 | 1.96 | yes | transport_restart at 7.16 | 7.42 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T023140-7 | 2.05 | yes | transport_restart at 7.05 | 7.30 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T023412-8 | 2.05 | yes | transport_restart at 7.05 | 7.30 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T023643-9 | 2.10 | yes | transport_restart at 7.10 | 7.35 | restart | 0 | 0 |
| livekit-iso-all-17s-O-R4-20261012T023914-10 | 2.09 | yes | transport_restart at 7.09 | 7.35 | restart | 0 | 0 |

Outcome restart: 10 of 10. Detection 1.94–2.15 s; inside 1.8–2.2 s: 10 of 10. First connection opened 7.20–7.42 s; inside 7.05–7.65 s: 10 of 10.
Reading: SUPPORTS: ten of ten with detection in the band.
Informative trials (the subject's decoder rejected a sample within 1 s of onset, so the correction was exercised where the defect acts): 0 of 10. With none, this arm shows the corrected build behaving as the study build does in the absence of the defect and says nothing about the correction.

## janus, full isolation, 5 s

| Trial | Detection (s) | In band | First action | Connection opened (s) | Outcome | Rejected at S within 1 s of onset | All rejections |
|---|---|---|---|---|---|---|---|
| janus-iso-all-5s-O-R4-20261012T024616-1 | 1.96 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T024839-2 | 2.00 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T025103-3 | 2.05 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T025329-4 | 1.98 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T025556-5 | 2.01 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T025821-6 | 2.04 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T030047-7 | 1.91 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T030313-8 | 2.01 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T030535-9 | 2.07 | yes | none | – | ride-out | 0 | 0 |
| janus-iso-all-5s-O-R4-20261012T030758-10 | 2.03 | yes | none | – | ride-out | 0 | 0 |

Outcome ride-out: 10 of 10. Detection 1.91–2.07 s; inside 1.8–2.2 s: 10 of 10.
Reading: SUPPORTS: ten of ten with detection in the band.
Informative trials (the subject's decoder rejected a sample within 1 s of onset, so the correction was exercised where the defect acts): 0 of 10. With none, this arm shows the corrected build behaving as the study build does in the absence of the defect and says nothing about the correction.

## Rejections by the corrected decoder, all participants, all trials

Samples accepted: 85513; rejected: 0; recorded samples with an age of 32 s or more (the correction should leave none): 0.
Rejections in healthy audio (not within 1 s after onset, not during outage or the 30 s after restore, not within 3 s of a stream attaching or a participant leaving): 0.
Trials with a rejection at any receiver within 1 s of onset: 0 of 20.
