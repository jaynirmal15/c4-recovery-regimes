# c4-recovery-regimes

Trial records, client, runner and analysis for a measurement study of **what two WebRTC
media servers report when a participant's session is disrupted and recovers**, compared
with when the other participants' received audio actually recovers.

**This repository is the artifact for a measurement study currently under submission.** If you
arrived here from a citation, this is the data and code behind that paper.

- **Systems:** LiveKit server v1.13.7 and Janus 1.4.1 (VideoRoom), self-hosted, one at a time.
- **A trial:** three audio-only participants in headless Chromium. One of them, the
  subject, is cut off from the server at the network layer for 2–90 s and then restored.
  It recovers under a fixed client policy.
- **What is recorded:** the server's operator surface (webhooks or event handler, and the
  participant-state API), the raw signalling frames the server sent, and the age of the
  audio each receiver is presenting, measured with an in-band audio clock.
- **Result in one line:** membership and participant-state interfaces were silent in all
  164 recoveries in which the session survived; the signals that did report were not
  interchangeable with recovery as measured at the receivers; and several apparent server
  behaviours turned out to depend on the recovery client.

**The current statement of what the data supports is
[`CLAIM-REVIEW-PACKET.md`](CLAIM-REVIEW-PACKET.md).** Read that first.
[`WRITEUP-MATERIALS.md`](WRITEUP-MATERIALS.md) is **superseded** and kept only as a record;
do not cite or draft from it.

## Which data is the study, and which is not

Only two directories hold cited study data. Everything else is development data from
earlier versions of the client and must not be mistaken for it.

| Directory | Trials | Status |
|---|---|---|
| `study/` | 175 | **Study, run 1.** 145 are cited. **30 are superseded** (see below). |
| `study-r2/` | 70 | **Study, run 2.** All 70 are cited. |
| `backlog-cell/` | 10 | Follow-up measurement (Janus, media-only, 16 s and 20 s) with browser WebRTC statistics. Used for one analysis in the paper. **Not part of the 215.** |
| `shakedown/`, `shakedown-smoke/`, `shakedown-smoke-v1/` | 56 | Development. Pre-study shakedown with an earlier client policy. |
| `trials-run1/` … `trials-run5/`, `trials-debug/`, `trials-run3-incomplete/` | 70 | Development. Targeted tests of the harness itself. Includes deliberately invalid trials. |
| `confirm/`, `confirm2/`, `confirm3/`, `confirm-starve/` | 20 | Development. Confirmation runs after individual client fixes. `confirm-starve/` is a deliberate-failure test and both its trials are invalid by design. |
| `arms/` | 24 | Development. Check that two client arms behave identically. |
| `validate/` | 7 | Development. Validation of state polling and timer changes before the study. |

**The cited dataset is 215 trials: 145 from `study/` plus 70 from `study-r2/`.**
The authoritative list is `logs/study/divergence-final.json`, one entry per trial with its
`id` and `run`.

### The 30 superseded trials

They are the run 1 trials of four LiveKit media-only conditions, in `study/`:

```
study/livekit-iso-media-23s-O-*   (5 trials)
study/livekit-iso-media-26s-O-*   (10 trials)
study/livekit-iso-media-28s-O-*   (10 trials)
study/livekit-iso-media-30s-O-*   (5 trials)
```

In these, the recovery client dropped a "please resume" request from LiveKit that arrived
while a restart attempt was in flight. The client then waited its retry interval, LiveKit
removed the participant, and all 30 trials ended in a session rebuild. That outcome was
produced by the client, not by LiveKit. The client was corrected and the same four
conditions were re-run in `study-r2/`, where all 30 ended in a restart with the session
preserved. The run 1 trials are valid recordings of what that client did and are kept for
that reason; they are excluded from every cited result.
`CLAIM-REVIEW-PACKET.md` §6.1 has the full account.

### What is in a trial directory

Each trial is one directory named `<stack>-iso-<mode>-<D>s-<arm>-<timestamp>-<n>`, where
mode is `all` (full isolation) or `media` (media-only).

| File | Content |
|---|---|
| `result.json` | Trial metadata: isolation timing, validity and any invalidation reasons, clock offsets, runner marks. |
| `preconditions.json` | Placement and version checks made before the trial. |
| `S.json`, `O1.json`, `O2.json` | Per participant: driver state and recovery actions, event log, raw signalling frames, audio-age samples. In `backlog-cell/` also WebRTC statistics sampled every 250 ms. |
| `server-events.jsonl` | Every event the server posted to the event sink during the trial (webhooks or event-handler events), sequence-numbered. |
| `state-poll.json` | Participant-state API polled every second. |
| `server-livekit.log` / `server-janus.log` | Server log for the trial. |

Development directories from before 2026-10-01 use an older layout (`server-webhooks.log`,
`server-janus-events.log`) and lack `state-poll.json`.

## Re-running the analysis

The analysis runs from a clean checkout with Node.js 20 or later (developed on 24.10) and
no other setup. It does not need the lab or the secret files.

```bash
npm ci
```

That installs the one pinned dependency, `@livekit/protocol` 1.50.4, used to decode
LiveKit signalling frames.

### Worked example: reproduce the run 1 divergence dataset

```bash
node client/runner/divergence.mjs --json study > /tmp/divergence-run1.json
```

```bash
cmp /tmp/divergence-run1.json logs/study/divergence-all.json && echo identical
```

The first command reads all 175 run 1 trial directories and computes, per trial and per
reporting layer, when the layer first reported a problem, when it reported recovery, and
how those compare with the receivers' audio. The second confirms the output is
byte-identical to the committed file. It takes about a minute.

### The rest of the pipeline

| Step | Command | Committed output it reproduces |
|---|---|---|
| Run 2 divergence | `node client/runner/divergence.mjs --json study-r2` | `logs/study/divergence-r2.json` |
| Assemble the 215 | `node client/runner/final-dataset.mjs` | `logs/study/divergence-final.json`, `logs/study/table-final.md` |
| Raw-frame classifiers | `node client/runner/classify-raw.mjs logs/study/divergence-final.json study study-r2` | `logs/study/rawclass-final.txt` |
| Per-observer recovery | `node client/runner/per-observer.mjs` | `logs/study/per-observer.json`, `logs/study/table-per-observer.md` |
| Backlog test, study trials | `TAG=study node client/runner/janus-backlog-test.cjs study/janus-iso-media-{10,30,45}s-*` | `logs/study/janus-early/backlog-test-study.json` |
| Backlog statistics, follow-up | `node client/runner/janus-backlog-stats.cjs backlog-cell/janus-iso-media-*/` | `logs/study/janus-early/backlog-cell-stats.json` |

`final-dataset.mjs`, `per-observer.mjs` and the two backlog scripts write into `logs/study/`
by default, overwriting the committed copies with identical content. `classify-raw.mjs`
prints to standard output and also writes `logs/study/divergence-final-rawclass.json`.

`logs/study/table-final.md` is the full per-condition table (34 rows).

### The paper's figure

[`paper/fig1_reversal.py`](paper/fig1_reversal.py) draws the paper's Fig. 1 (the LiveKit
media-only 23 s outage before and after the client correction) and
[`paper/fig1_reversal.pdf`](paper/fig1_reversal.pdf) is its output. The plotted values are
constants in the script, transcribed from one run 1 trial and one run 2 trial named in its
docstring. Run from this repository, the script first re-derives the plotted times from
those records and stops if any differs by more than 0.01 s.

That check reads the same record fields the constants were transcribed from, so it guards
against a mistyped constant, not against a wrong choice of field. It agreed on its first
run, with no constant or derivation adjusted. It covers times, not every plotted value: the
rebuild bar is drawn at a minimum width for legibility and is not to scale (the measured
rebuild took 0.43 s, from 28.85 to 29.28 s).

The script needs Python 3 with matplotlib:

```bash
python3 paper/fig1_reversal.py
```

The committed PDF was built with matplotlib 3.9.4 on Python 3.9.1. The script writes the PDF
without a creation timestamp, so on that matplotlib version it reproduces the committed file
byte for byte; the claim goes no further than that version. Under a different matplotlib
the output is a different, equally correct PDF. Unlike the Node.js dependency, the Python
dependency is not pinned in this repository.

## Re-running trials

This needs more than the repository:

- **A Kubernetes cluster laid out as the study's lab:** three nodes, with the server under
  test, the clients and a TURN server on separate nodes. The lab's infrastructure code is
  in a separate repository, `realtime-media-aws-lab`, which is **not public** at the time
  of writing. `deploy/` here holds only the manifests for the two media servers and the
  event sink.
- **The two secret files** described below.
- `kubectl` and `helm` on the path, and the runner scripts in `client/runner/` (`run.mjs`
  is the entry point; the `.sh` files are the job scripts that were actually used). The
  job scripts take the lab checkout from `C4_LAB_DIR` and a Node.js binary directory from
  `C4_NODE_BIN`.

Software versions are pinned in `client/runner/run.mjs` and `deploy/`: LiveKit server
v1.13.7, Janus 1.4.1 from a dated Debian snapshot, livekit-client 2.22.3 and Playwright
1.62.1, each by image digest or exact version.

## The two secret files

Two files are deliberately absent and are ignored by Git. They are needed only to deploy
the servers, not to run the analysis.

| Absent file | What it holds | Template |
|---|---|---|
| `deploy/livekit/secrets.local.yaml` | LiveKit API key and secret (Helm values) | `deploy/livekit/secrets.example.yaml` |
| `deploy/janus/secret.local.yaml` | Janus admin secret (Kubernetes Secret) | `deploy/janus/secret.example.yaml` |

Copy each template to the absent file's name and fill in your own values.

**About tokens in the logs.** The LiveKit server logs and webhook logs in the trial
directories contain participant access tokens. Each expired on the day of its trial, and
the API key that signed them was retired on 2026-10-06. They cannot be used.

**Scrubbed values.** In the job logs under `logs/`, four kinds of value have been replaced by
placeholders so that the log format stays readable: the lab's AWS account identifier
(`<aws-account-id>`), the cluster's API endpoint (`<eks-endpoint>`, and `<eks-endpoint-id>`
where only its identifier appeared), the TURN load balancer's host name
(`<coturn-host>`), and the public addresses of the cluster nodes in `kubectl get nodes`
output (`<node-ip>`). No trial record was altered.

**Node addresses in the trial records.** The trial records under `study/`, `study-r2/` and
the development runs contain node public addresses in LiveKit ICE candidates, from instances
that no longer exist. They are deliberately unaltered, because the trial records are the
primary evidence and are committed as the instrument wrote them.

## Other documents

| File | What it is |
|---|---|
| `CLAIM-REVIEW-PACKET.md` | **Current.** The claim, the evidence, the limits. |
| `STAGE-A-SPEC.md` | The study specification: client policy, trial protocol, validity rules, matrix, and the record of every change to them. |
| `FINDINGS.md` | Findings F1–F5 from before the study, with later qualifications. |
| `PLAN.md` | Design constraints and decisions. |
| `SHAKEDOWN-REPORT.md`, `TARGETED-TESTS.md`, `SPIKE-REPORT.md`, `CLIENT-FEASIBILITY.md`, `REPORT.md`, `NEXT-STEP.md` | Development reports, in the state they were written. Superseded where they conflict with the packet. |
| `WRITEUP-MATERIALS.md` | **Superseded.** |

## Licence and citation

MIT; see [`LICENSE`](LICENSE). `deploy/livekit/chart/` is a vendored copy of LiveKit's Helm
chart and remains under its own licence. To cite this repository, see
[`CITATION.cff`](CITATION.cff).
