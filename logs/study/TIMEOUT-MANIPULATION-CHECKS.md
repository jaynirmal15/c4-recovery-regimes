# Attempt-timeout intervention: the two manipulation checks

2026-10-09. From committed records and pinned source only; nothing was run on the lab and nothing is
registered by this file. Numbers are from `logs/study/timeout-checks.txt`, written by
`client/runner/timeout-checks.cjs` over the rows in `logs/study/removal-race/livekit.json`
(retained LiveKit trials under full isolation: 80, of which 2 have an empty server log and no client
row and are left out of everything below). Times are seconds after isolation onset.

## Check 1. When the first attempt opens

Two of the 78 trials are the decoder-defect trials (attempt begins 5.23 and 5.35 s) and are set apart.
In the other 76:

| Quantity | n | min | p10 | median | p90 | max |
|---|---|---|---|---|---|---|
| Attempt begins (driver calls the SDK) | 76 | 6.85 | 6.94 | 7.06 | 7.25 | 7.37 |
| Connection opened, path still blocked (D of 10 s or more) | 67 | 7.10 | 7.19 | 7.31 | 7.49 | 7.63 |
| Opened minus begins, path blocked | 67 | 0.253 | 0.253 | 0.254 | 0.255 | 0.261 |

The plan's "about 7 s" is the time the attempt begins. The connection, and so the first request the
kernel sends, opens 0.25 s after that, at 7.1 to 7.6 s (median 7.3 s), because the SDK first waits for
the old socket to close. The spread is 0.53 s and no condition stands apart from the others.

With the unit frozen at 1.033 s and each trial's own begin and open times, the last request that leaves
inside the attempt is:

| Timeout | Last schedule point | It leaves at (min, median, max) | Timer fires after it by | Tested durations inside that spread |
|---|---|---|---|---|
| 10 s | 7 units | 14.34, 14.54, 14.86 | 2.51 s | none |
| 15 s | 11 units | 18.47, 18.68, 18.99 | 3.38 s | none |
| 25 s | 19 units | 26.73, 26.94, 27.25 | 5.12 s | 27 s |

Restore was confirmed 0.05 to 0.10 s after the nominal duration (median 0.07 s). So for the 10 s arm a
restore at 14 s precedes the last request in every trial by at least 0.24 s and a restore at 15 s
follows it by at least 0.19 s. For the 15 s arm the margins are 0.37 s and 0.06 s. The open-time spread
does not move a first-attempt prediction across a tested duration in the 10 s or 15 s arm. In the 25 s
arm a restore at 27 s falls inside the spread, which matters only to the per-trial classification, not
to the outcome if the removal binds first.

**Result: passes for what the equation predicts, which is whether the first attempt is answered.**

## Check 2. What sets the attempt's lifetime

A timer does. In the 40 trials whose first attempt was not answered it ended 15.003 to 15.007 s after
it began (14.749 to 14.752 s after the connection was opened).

It is not the driver's parameter. `signalTimeoutMs` is used in two places: the driver's test for dead
signalling (`client/www/driver.js` line 30) and the SDK's ping timeout, which the adapter pins
(`client/www/lk.js` lines 72 and 73). The 15 s on a connection attempt is livekit-client's own default,
`websocketTimeout: 15e3`, in the pinned 2.22.3 bundle (`dist/livekit-client.umd.js`, sha256
`7fa17e37…7dc04d` as served by unpkg on 2026-10-09). The adapter calls `room.connect(url, token,
{ autoSubscribe: true })` (`lk.js` line 90) and passes no timeout, so the default applies. The SDK keeps
the join options and reuses them on every resume (`connect(..., Object.assign({}, this.options,
{ reconnect: true, ... }))`), starts `setTimeout(..., websocketTimeout)` before it tears down the old
socket, and on expiry closes the socket and rejects with "room connection has timed out (signal)".

So the value is settable, by passing `websocketTimeout` to `room.connect`, and once set it does govern
the outstanding request. But three things in the plan need correcting first:

1. It is a change to client code (`lk.js`), not to configuration. The harness has no such knob today.
2. Changing `signalTimeoutMs` would have tested nothing. It would have moved the dead-signalling rule
   and the ping timeout and left the attempt at 15 s.
3. The manuscript's "each attempt times out after 15 s" describes an SDK default on LiveKit, not a rule
   of the recovery policy. The two values coincide.

A shakedown must show the lifetime at the set value (10.00 s and 25.00 s from attempt begin) before any
arm counts, and that is the manipulation check the failure rule applies to.

**Result: passes, conditional on that code change and on the shakedown.**

## A third thing the checks turned up: the 10 s arm's rebuild prediction depends on a fourth time

The equation says a restore at 15 s misses the first attempt in the 10 s arm. It does not say the
session is then rebuilt. A rebuild needs the server to have removed the participant, and the removal
follows the server's ICE failure by 5.000 to 5.002 s (39 of 39).

| | n | min | p10 | median | p90 | max |
|---|---|---|---|---|---|---|
| Server reports ICE failure for S | 61 | 15.04 | 15.13 | 15.74 | 16.48 | 16.83 |

In all 61 trials the failure came before the restore, because no retained full-isolation condition
lies between 10 s and 16 s. In the 14 trials at 2, 5 and 10 s with a usable log the server reported no
ICE failure. A restore at 15 s would come before 58 of the 61 recorded failure times, at 16 s before 13
of 61, at 17 s before none.

If the server's ICE recovers when the path returns before it fails, there is no removal, and the
client's second attempt (it would open about 22.3 to 22.8 s after onset) would be accepted. The trial
would survive at 15 s, and in some trials at 16 s, although its first attempt failed exactly as the
equation predicts. The records do not show whether the server's ICE does recover in that window. The
media-only conditions are consistent with it: there the failure is reported at 21.9 to 22.3 s in the
conditions of 22 s and more (20.2 s in the one trial whose restart the decoder defect advanced) and
not at all at 20 and 21 s (38 of 38 and 0 of 14 trials with a usable log).

Consequence for the registration: "survive at 14, rebuild at 15" for the 10 s arm is two predictions.
The equation supports the first-attempt half. The outcome half at 15 and 16 s is set by the server's
ICE timeout, which is not in the equation. At 17 s both halves agree again: ICE failed before the
restore in 61 of 61, and the second connection would open after the removal in 37 of 37 rebuilds with
normal detection (margin 0.28 to 8.07 s, median 1.68 s).

## Item 3 of the protocol additions: can a second connection rescue a predicted rebuild in the 10 s arm

Replaying the 39 rebuilds with the first attempt ending at 10 s and nothing else changed: the second
connection would open before the removal in 2 of 39, both of them the decoder-defect trials (0.51 and
0.33 s before). With normal detection, 0 of 37; the smallest margin is 0.28 s. This holds only where
the removal happens at all, which is the point above.
