# R3 score (timeout-shakedown/)

Valid trials scored: 4. Invalid, listed and not scored: 0.
Cells short of ten valid trials: W10-14 (0), W10-15 (0), W10-16 (0), W10-17 (1), W15-18 (1), W15-19 (1), W25-18 (0), W25-19 (0), W25-26 (0), W25-28 (1); over ten: none.

## Manipulation check

- W10: 1 unanswered attempts in 1 trials; lifetime 10004–10004 ms; outside 50 ms of the set value: 0. passes
- W15: 1 unanswered attempts in 1 trials; lifetime 15004–15004 ms; outside 50 ms of the set value: 0. passes
- W25: 1 unanswered attempts in 1 trials; lifetime 25004–25004 ms; outside 50 ms of the set value: 0. passes

## Primary rule P: the first attempt's request receives a response

| Cell | Valid | Responded | of which accepted | of which refused | Predicted | Reading |
|---|---|---|---|---|---|---|
| W10-14 | 0 | 0 | 0 | 0 | responds | no trials |
| W10-15 | 0 | 0 | 0 | 0 | no response | no trials |
| W10-16 | 0 | 0 | 0 | 0 | no response | no trials |
| W10-17 | 1 | 0 | 0 | 0 | no response | incomplete (1 of 10 valid): the rule defines no verdict |
| W15-18 | 1 | 1 | 1 | 0 | responds | incomplete (1 of 10 valid): the rule defines no verdict |
| W15-19 | 1 | 0 | 0 | 0 | no response | incomplete (1 of 10 valid): the rule defines no verdict |
| W25-18 | 0 | 0 | 0 | 0 | responds | no trials |
| W25-19 | 0 | 0 | 0 | 0 | responds | no trials |
| W25-26 | 0 | 0 | 0 | 0 | responds | no trials |
| W25-28 | 1 | 0 | 0 | 0 | no response | incomplete (1 of 10 valid): the rule defines no verdict |

- W10: incomplete (fewer than ten valid trials at 14, 15, 16, 17 s): the rule defines no verdict
- W15: incomplete (fewer than ten valid trials at 18, 19 s): the rule defines no verdict
- W25: incomplete (fewer than ten valid trials at 18, 19, 26, 28 s): the rule defines no verdict

Trials whose first attempt began before 6.5 s (decoder defect), counted as they fell: none.

## Secondary rule M: per-trial timing

Trials with a first connection: 4 of 4. Set apart (restore within 0.16 s after a schedule instant): 0, of which hits 0.
- W10: 1 hits of 1 | response classified correctly 1 | arrival minus predicted, where a response came: – s (0)
- W15: 2 hits of 2 | response classified correctly 2 | arrival minus predicted, where a response came: -0.02–-0.02 s (1)
- W25: 1 hits of 1 | response classified correctly 1 | arrival minus predicted, where a response came: – s (0)
- all: 4 hits of 4 | response classified correctly 4 | arrival minus predicted, where a response came: -0.02–-0.02 s (1)

## Derived rule S: survive or rebuild

| Cell | Valid | Survive | Rebuild | Rebuild completed (s) | Predicted | Reading |
|---|---|---|---|---|---|---|
| W10-14 | 0 | 0 | 0 | – | survive, 9 or more | no trials |
| W10-15 | 0 | 0 | 0 | – | under A: 7 or more survive | no trials |
| W10-16 | 0 | 0 | 0 | – | none | no trials |
| W10-17 | 1 | 0 | 1 | 22.79–22.79 | rebuild, 9 or more | incomplete (1 of 10 valid): the rule defines no verdict |
| W15-18 | 1 | 1 | 0 | – | survive, 9 or more | incomplete (1 of 10 valid): the rule defines no verdict |
| W15-19 | 1 | 0 | 1 | 27.81–27.81 | rebuild, 9 or more | incomplete (1 of 10 valid): the rule defines no verdict |
| W25-18 | 0 | 0 | 0 | – | survive, 9 or more | no trials |
| W25-19 | 0 | 0 | 0 | – | rebuild, 9 or more | no trials |
| W25-26 | 0 | 0 | 0 | – | rebuild, 9 or more | no trials |
| W25-28 | 1 | 0 | 1 | 37.89–37.89 | rebuild, 9 or more | incomplete (1 of 10 valid): the rule defines no verdict |

Timing parts of S: W25-19 and W25-26 rebuilds completed by 28 s: W25-19 0 of 0, W25-26 0 of 0; W25-28 rebuilds completed after 37 s: 1 of 1.

## Assumption A observed directly: the server's ICE report, W10-15 and W10-16

- W10-15: server log usable in 0 of 0. No ICE failure reported: 0; failure reported: 0 (at – s). Outcome agrees with the report (no failure and survive, or failure and rebuild): 0 of 0. Survivors whose second attempt was accepted: 0 of 0.
- W10-16: server log usable in 0 of 0. No ICE failure reported: 0; failure reported: 0 (at – s). Outcome agrees with the report (no failure and survive, or failure and rebuild): 0 of 0. Survivors whose second attempt was accepted: 0 of 0.
- all cells: server log usable in 3 of 4; ICE failure reported at 15.09–16.59 s (3); removal minus failure 5.00–5.00 s.

## Recorded times

First attempt begins 6.97–7.07 s; connection opened 7.23–7.33 s; restore minus nominal 0.06–0.07 s.
