// R3 (REGISTRATION-R3-attempt-timeout.md): scoring. Read-only; applies the registered rules and nothing else.
// The rules are stated for ten valid trials a cell; a cell with fewer prints "incomplete" and no verdict.
// usage, from the repository root, after `npm ci`: node client/runner/r3-score.mjs [dir=timeout] > logs/timeout/SCORE.md
// Trial set: every directory under <dir> that holds a result.json with a control.wsTimeoutMs, enumerated from the
// filesystem. Invalid trials are listed and not scored. Times are seconds after isolation onset. Frozen quantities are
// the registration's; none is fitted here.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const UNIT = 1.033, SCHEDULE = [0, 1, 2, 3, 4, 5, 7, 11, 19, 35], ARRIVAL_TOL = 0.10, NEAR = 0.16, LIFE_TOL_MS = 50, EARLY = 6.5;
const PLAN = { W10: [14, 15, 16, 17], W15: [18, 19], W25: [18, 19, 26, 28] };
// registered predictions. P: does the first attempt's request get a response. S: survive or rebuild ('A' = rests on assumption A, 'desc' = descriptive)
const PRED_P = { 'W10-14': true, 'W10-15': false, 'W10-16': false, 'W10-17': false, 'W15-18': true, 'W15-19': false, 'W25-18': true, 'W25-19': true, 'W25-26': true, 'W25-28': false };
const PRED_S = { 'W10-14': 'survive', 'W10-15': 'A', 'W10-16': 'desc', 'W10-17': 'rebuild', 'W15-18': 'survive', 'W15-19': 'rebuild', 'W25-18': 'survive', 'W25-19': 'rebuild', 'W25-26': 'rebuild', 'W25-28': 'rebuild' };
const BOUNDARY = { W10: [14, 15], W15: [18, 19], W25: [26, 28] };
const dir = process.argv[2] || 'timeout'; const r2 = (x) => (x == null ? null : +x.toFixed(2)); const f2 = (x) => (x == null ? '–' : x.toFixed(2));
const rng = (v) => (v.length ? `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}` : '–');

function serverIce(d, r, S, t0) { // the server's own report of ICE failure for S, where its log covers the interval
  const p = path.join(d, 'server-livekit.log'); if (!fs.existsSync(p)) return { usable: false, why: 'missing' };
  const off = (r.clock && r.clock.sfu && r.clock.sfu.offsetMs) || 0; const rows = [];
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^(\S+)\s+(\S+)\t(\w+)\t(\S+)\t(\S+)\t([^\t]*)\t?(.*)$/); if (!m) continue; try { rows.push({ t: Date.parse(m[2]) - off, msg: m[6], j: JSON.parse(m[7]) }); } catch { /* not a JSON line */ } }
  if (!rows.length) return { usable: false, why: 'empty' };
  const lastAct = Math.max(t0, ...S.driver.actions.map((a) => a.tEnd || a.tStart));
  if (rows[0].t > t0 || rows[rows.length - 1].t < lastAct) return { usable: false, why: 'does not cover onset to last action' };
  const pid0 = (S.log.filter((l) => l.type === 'lk_joined' && l.t < t0).pop() || {}).sid || null;
  const st = (s) => rows.filter((x) => x.t > t0 && x.j.participant === 'S' && x.msg === 'ice connection state change' && x.j.transport === 'PUBLISHER' && x.j.state === s && x.j.participantID === pid0).map((x) => (x.t - t0) / 1000);
  const rm = rows.find((x) => x.t > t0 && x.msg === 'participant closing' && x.j.participantID === pid0 && x.j.reason !== 'CLIENT_REQUEST_LEAVE');
  return { usable: true, disconnected: r2(st('disconnected')[0]), failed: r2(st('failed')[0]), removal: rm ? r2((rm.t - t0) / 1000) : null };
}

const rows = [], invalid = [];
for (const name of fs.readdirSync(dir).sort()) {
  const d = path.join(dir, name); if (!fs.existsSync(path.join(d, 'result.json'))) continue;
  const r = JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')); if (!r.control || !r.control.wsTimeoutMs || !r.iso) continue;
  if (!r.valid) { invalid.push({ id: r.id, why: r.invalid }); continue; }
  const S = JSON.parse(fs.readFileSync(path.join(d, 'S.json'), 'utf8')); const t0 = r.iso.onset.after; const rel = (t) => (t - t0) / 1000;
  const T = r.control.wsTimeoutMs / 1000, arm = r.control.arm, D = r.iso.plannedS, cell = `${arm}-${D}`;
  const acts = S.driver.actions; const a1 = acts.find((a) => a.kind === 'transport_restart');
  const open = a1 && S.frames.find((f) => f.dir === 'open' && f.t >= a1.tStart);
  const row = { id: r.id, arm, T, D, cell, restore: rel(r.iso.restore.after), begin: a1 ? rel(a1.tStart) : null, open: open ? rel(open.t) : null, end: a1 && a1.tEnd ? rel(a1.tEnd) : null, early: !!(a1 && rel(a1.tStart) < EARLY) };
  // P: any frame from the server on the first attempt's connection before that attempt ended, and its type
  let resp = null;
  if (open) for (const f of S.frames) { if (f.dir !== 'in' || f.ws !== open.ws || !f.b64 || f.t < open.t || (a1.tEnd && f.t > a1.tEnd)) continue; let m = null; try { m = P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message; } catch { /* undecodable */ }
    resp = { t: rel(f.t), type: !m ? 'undecoded' : m.case === 'reconnect' ? 'accepted' : m.case === 'leave' ? `refused ${P.DisconnectReason[m.value.reason]}/${P.LeaveRequest_Action[m.value.action]}` : `other:${m.case}` }; break; }
  row.responded = !!resp; row.response = resp ? resp.type : null; row.responseAt = resp ? resp.t : null;
  // M: the frozen schedule from this trial's own open time
  if (open) { const k = SCHEDULE.find((p) => row.open + p * UNIT > row.restore); const inst = k == null ? null : row.open + k * UNIT; const fire = row.begin + T;
    row.predPoint = k ?? null; row.predArrive = inst; row.predRespond = inst != null && inst < fire;
    row.near = SCHEDULE.some((p) => { const x = row.restore - (row.open + p * UNIT); return x > 0 && x < NEAR; });
    row.mHit = row.predRespond === row.responded && (!row.responded || Math.abs(row.responseAt - inst) <= ARRIVAL_TOL); }
  // S: survive or rebuild, from the driver's own actions
  const rb = acts.find((a) => a.kind === 'rebuild' && a.result && a.result.ok); row.outcome = rb ? 'rebuild' : 'survive'; row.rebuildDone = rb ? rel(rb.tEnd) : null;
  const a2 = acts.filter((a) => a.kind === 'transport_restart')[1]; row.second = a2 ? { begin: r2(rel(a2.tStart)), result: a2.result && (a2.result.ok ? 'accepted' : a2.result.refused || a2.result.detail) } : null;
  if (row.early) { // descriptive: which form the first post-onset sample took on the stream that tripped the rule
    row.sig = []; for (const k of Object.keys(S.fresh)) { const xs = S.fresh[k].slice().sort((a, b) => a.tP - b.tP); const i = xs.findIndex((z, j) => z.tP > t0 && z.tP < t0 + 1000 && j > 0 && (z.age >= 32000 || z.age - xs[j - 1].age > 1000)); if (i < 0) continue;
      const step = xs[i].age - xs[i - 1].age; let run = 1; while (xs[i + run] && xs[i + run].tP - xs[i + run - 1].tP < 300 && Math.abs(xs[i + run].tS - xs[i].tS) < 200) run++;
      const unwA = xs[i].age >= 32000 ? xs[i].age - 64000 : xs[i].age; const oth = Object.keys(S.fresh).filter((o) => o !== k).map((o) => { const z = S.fresh[o].find((y) => Math.abs(y.tP - xs[i].tP) < 70); return z ? { stream: o, age: z.age >= 32000 ? z.age - 64000 : z.age } : null; }).filter(Boolean)[0];
      row.sig.push({ cross: oth ? { stream: oth.stream, diff: r2((unwA - oth.age) / 1000) } : null, stream: k, at: r2(rel(xs[i].tP)), age: r2(xs[i].age / 1000), unwrapped: r2((xs[i].age >= 32000 ? xs[i].age - 64000 : xs[i].age) / 1000), stepVsPreceding: r2(((xs[i].age >= 32000 ? xs[i].age - 64000 : xs[i].age) - xs[i - 1].age) / 1000), form: xs[i].age >= 32000 ? 'wrapped (sender time ahead; read as about 62 s)' : step >= 1500 && step <= 2500 ? 'the committed form (age up by 1.5 to 2.5 s)' : 'neither', clause: xs[i].age >= 32000 ? 'F' : step >= 1500 && step <= 2500 ? 'B' : 'none', run }); } }
  row.lifetimesMs = r.control.unansweredAttemptLifetimesMs || []; row.ice = serverIce(d, r, S, t0);
  rows.push(row);
}

const out = []; const say = (s = '') => out.push(s);
say(`# R3 score (${dir}/)`); say();
say(`Valid trials scored: ${rows.length}. Invalid, listed and not scored: ${invalid.length}${invalid.length ? ' (' + invalid.map((x) => x.id).join('; ') + ')' : ''}.`);
const cells = Object.entries(PLAN).flatMap(([a, ds]) => ds.map((D) => `${a}-${D}`)); const of = (c) => rows.filter((x) => x.cell === c);
say(`Cells short of ten valid trials: ${cells.filter((c) => of(c).length < 10).map((c) => `${c} (${of(c).length})`).join(', ') || 'none'}; over ten: ${cells.filter((c) => of(c).length > 10).map((c) => `${c} (${of(c).length})`).join(', ') || 'none'}.`);

say(); say('## Manipulation check'); say();
const failedArms = new Set();
for (const a of Object.keys(PLAN)) { const g = rows.filter((x) => x.arm === a); const L = g.flatMap((x) => x.lifetimesMs); const bad = L.filter((x) => Math.abs(x - g[0].T * 1000) > LIFE_TOL_MS);
  if (!L.length || bad.length) failedArms.add(a);
  say(`- ${a}: ${L.length} unanswered attempts in ${g.filter((x) => x.lifetimesMs.length).length} trials; lifetime ${L.length ? Math.min(...L) + '–' + Math.max(...L) + ' ms' : '–'}; outside ${LIFE_TOL_MS} ms of the set value: ${bad.length}. ${!L.length ? 'NO LIFETIME OBSERVED' : bad.length ? '**FAILED MANIPULATION: arm excluded, not evidence against the model**' : 'passes'}`); }

say(); say('## Primary rule P: the first attempt\'s request receives a response'); say();
say('| Cell | Valid | Responded | of which accepted | of which refused | Predicted | Reading |'); say('|---|---|---|---|---|---|---|');
const cnt = {}; for (const c of cells) { const g = of(c); const y = g.filter((x) => x.responded); cnt[c] = { n: g.length, y: y.length };
  const reading = !g.length ? 'no trials' : g.length < 10 ? `incomplete (${g.length} of 10 valid): the rule defines no verdict` : PRED_P[c] ? (y.length >= 9 ? 'as predicted' : y.length <= 1 ? 'AGAINST' : 'split') : (y.length <= 1 ? 'as predicted' : y.length >= 9 ? 'AGAINST' : 'split');
  say(`| ${c} | ${g.length} | ${y.length} | ${y.filter((x) => x.response === 'accepted').length} | ${y.filter((x) => String(x.response).startsWith('refused')).length} | ${PRED_P[c] ? 'responds' : 'no response'} | ${reading} |`); }
say();
for (const [a, ds] of Object.entries(PLAN)) { let found = null; for (let i = 0; i < ds.length - 1; i++) { const lo = cnt[`${a}-${ds[i]}`], hi = cnt[`${a}-${ds[i + 1]}`]; if (lo.n && hi.n && lo.y >= 9 && hi.y <= 1) found = [ds[i], ds[i + 1]]; }
  const split = ds.filter((D) => { const c = cnt[`${a}-${D}`]; return c.y >= 2 && c.y <= 8; });
  const short = ds.filter((D) => cnt[`${a}-${D}`].n < 10);
  const verdict = failedArms.has(a) ? 'arm excluded (failed manipulation)' : short.length ? `incomplete (fewer than ten valid trials at ${short.join(', ')} s): the rule defines no verdict` : split.length ? `NOT RESOLVED (split at ${split.join(', ')} s)` : !found ? 'NO BOUNDARY among the tested durations' : found[0] === BOUNDARY[a][0] && found[1] === BOUNDARY[a][1] ? `boundary at ${found.join('/')}: AS PREDICTED` : `boundary at ${found.join('/')}: AGAINST (predicted ${BOUNDARY[a].join('/')})`;
  say(`- ${a}: ${verdict}`); }
say(); say(`Trials whose first attempt began before ${EARLY} s (decoder defect), counted as they fell: ${rows.filter((x) => x.early).map((x) => `${x.id} (${x.cell}, ${x.responded ? 'responded' : 'no response'})`).join('; ') || 'none'}.`);

{ const e = rows.filter((x) => x.early); // descriptive only: no rule reads this
  say(`Rate, stated plainly: ${e.length} of ${rows.length} trials here began their first attempt before ${EARLY} s. In the study the same early start occurred in 2 of the 78 retained LiveKit full-isolation trials with a client record (logs/study/timeout-checks.txt) and in 6 of all 215 trials. The rate here is higher (${(100 * e.length / rows.length).toFixed(0)}% against 2.6%); with these counts the difference is not distinguishable from chance (Fisher's exact test, two-sided, p = 0.47 for 5 of 100 against 2 of 78, computed once by hand and not by this script). The defect was documented before this run: logs/study/decoder/ (commit d2fbee6, 2026-10-07), the R2 registration's definition of "the 2 s defect" (2026-10-08), and this registration's own sentence that such trials count as they fall.`);
  const dev = e.filter((x) => (PRED_P[x.cell] !== x.responded) || (PRED_S[x.cell] === 'survive' && x.outcome !== 'survive') || (PRED_S[x.cell] === 'rebuild' && x.outcome !== 'rebuild'));
  say(); say('| Early trial | Cell | Stream and first slipped sample | Form | Slipped samples in a row | Correction clause that would reject it | Deviation from its cell\'s prediction |'); say('|---|---|---|---|---|---|---|');
  const isDev = (x) => (PRED_P[x.cell] !== x.responded) || (PRED_S[x.cell] === 'survive' && x.outcome !== 'survive') || (PRED_S[x.cell] === 'rebuild' && x.outcome !== 'rebuild');
  for (const x of e) say(`| ${x.id} | ${x.cell} | ${(x.sig || []).map((q) => `${q.stream}: ${q.age} s at ${q.at} s`).join('; ') || 'none found'} | ${[...new Set((x.sig || []).map((q) => q.form))].join('; ') || 'neither'} | ${(x.sig || []).map((q) => q.run).join(', ')} | ${[...new Set((x.sig || []).map((q) => q.clause))].join(', ')} | ${isDev(x) ? 'YES' : 'no'} |`);
  { const d = e.filter(isDev); const w = d.filter((x) => (x.sig || []).some((q) => q.clause === 'F')), c = d.filter((x) => (x.sig || []).some((q) => q.clause === 'B'));
    say(); say('**What was fixed before the run and what was not.** R3\'s rule, registered before the run, fixed how these trials are counted: a first attempt beginning before 6.5 s is a decoder-defect trial and counts as it falls. That rule reads only the time of the first attempt. It is direction-agnostic, it identified the five trials with no reference to their samples, and the analysis had no free parameters here. Only the mechanism is post hoc: what the slipped samples are, in which direction they slip, and that the readings near 62 s are the same slip, were worked out after the run.');
    say(); say('**The slip measured against an independent reference.** Where the subject\'s other incoming stream decoded a sample at the same instant (within 70 ms) and had not slipped, the difference between the two streams measures the slip directly, with nothing fitted and no reference to earlier samples:'); say();
    say('| Early trial | Slipped stream | Other stream at the same instant | Slipped minus other (s) |'); say('|---|---|---|---|');
    for (const x of e) for (const q of x.sig || []) say(`| ${x.id} | ${q.stream} | ${q.cross ? q.cross.stream : 'no sample within 70 ms'} | ${q.cross ? (q.cross.diff > 0 ? '+' : '') + q.cross.diff.toFixed(2) + (Math.abs(q.cross.diff) < 0.5 ? ' (both streams slipped together)' : '') : '–'} |`);
    { const cr = e.flatMap((x) => (x.sig || []).filter((q) => q.cross && Math.abs(q.cross.diff) >= 0.5).map((q) => q.cross.diff)); say(); say(`Available in ${cr.length} cases: ${cr.map((v) => (v > 0 ? '+' : '') + v.toFixed(2)).join(' and ')} s. Each is one period of the 2 s fine chirp, once in each direction. One more instance exists outside this run, in the R2 records (below): +1.97 s.`); }
    say(); say(`**Crossing the two lists.** Of the ${d.length} early trials that deviate from their cell's prediction, ${c.length} slipped in the direction the committed text describes (the R2 registration's "age exceeding the samples either side of it by 1.5–2.5 s") and ${w.length} slipped the other way and were recorded with an age of about 62 s.`);
    say(); say('**The wrap undone** (an identification made after the run). The decoder takes sender time modulo the 64 s period of the coarse chirp (common.js: `tm = ((tm % 64) + 64) % 64`, then the nearest 64 s multiple at or before the clock plus 0.5 s), so a sender time ahead of the receiver\'s clock is recorded 64.000 s older than it is. Subtracting 64.000 s:'); say();
    say('| Early trial | Stream | Recorded age (s) | Minus 64 s | Step from the preceding sample (s) | Inside 1.5–2.5 s in size | Direction |'); say('|---|---|---|---|---|---|---|');
    for (const x of e) for (const q of x.sig || []) say(`| ${x.id} | ${q.stream} | ${q.age} | ${q.unwrapped} | ${q.stepVsPreceding > 0 ? '+' : ''}${q.stepVsPreceding} | ${Math.abs(q.stepVsPreceding) >= 1.5 && Math.abs(q.stepVsPreceding) <= 2.5 ? 'yes' : 'NO'} | ${q.stepVsPreceding > 0 ? 'older (the committed direction)' : 'younger (sender time ahead)'} |`);
    const allIn = e.every((x) => (x.sig || []).every((q) => Math.abs(q.stepVsPreceding) >= 1.5 && Math.abs(q.stepVsPreceding) <= 2.5));
    say(); say(allIn ? `Every one of the ${e.length} early trials is a step of 1.5–2.5 s. The readings near 62 s are that step in the younger direction read through the 64 s wraparound; they are not a second form of unknown size. What the committed text did not cover is the direction: it names a sample whose age exceeds its neighbours', and the wrapped ones read younger. For the ${w.length} deviating trials of that kind the explanation is "the known one-period slip, opposite sign, wrap arithmetic undone": a narrower gap than "a form we had not documented", and still a post-run identification of the mechanism. A search by value of every file committed before the run (the tree at acfef63, 2026-10-09) for a sample age of 59.5 to 63.9 s found none outside the raw trial records; the first search had been for phrases and digits ("59.5", "wraps to", "sender time ahead", an age threshold of 32000). Correction (2026-10-12): the younger-direction form was documented in a dated artefact before the run, outside the registration. The manuscript draft of the instrument section, draft/05-attribution.tex in ccwc2027-draft6.zip (archive entry dated 2026-10-07 01:14 local time, three days before the run; kept with the paper, not in this repository), says that a sample decoded 2 s in the future "wraps to about 62 s" and one decoded 2 s in the past "reads as about 2.1 s". It was not in any committed file, so it is not part of the registration; it does show that both directions and the wrap were written down before the run and were not worked out from its data. What remains post hoc is the measurement of the slip in these five trials and its reading against the committed 1.5–2.5 s band.` : 'Not every early trial is a step of 1.5–2.5 s; the finding above stands unchanged.');
    say(); say('**The 4.05 s reading in the R2 outputs is one period, not two, and it exposes a defect in R2\'s definition.** In `threshold/livekit-iso-all-2s-O-T4-20261008T055928-19` the driver recorded an effective age of 4.05 s for one stream at detection (logs/threshold/RUN-RECORD.md). That quantity is the time since the last decoded sample plus that sample\'s age: 1.59 s + 2.46 s. The sample itself had slipped by one period: its stream read 2.08 s where the other stream read 0.11 s at the same instant (+1.97 s), and 2.02 s above its own preceding sample. So the committed picture was one-period throughout, and the band covers this instance in size. What the registered definition does not cover is persistence. It requires the slipped sample to exceed the samples on both sides, and R2\'s scoring code tests both neighbours; in this trial and in all five early trials here the slip persisted for two to four samples until decoding stopped, so the sample after is slipped too and the two-sided test does not fire. It changed no R2 verdict: the definition applied only to T4 trials that took an action, and none did. It is recorded here as a defect in R2\'s definition: as written it would have missed each of the six instances examined here (the five early trials and this one). The study\'s six early trials were not re-examined for persistence.'); }
  say(); say('**Every defect rate quoted in the record, and the detector behind it.** Two detectors exist. The *timing rule* reads only when the subject acted: detection before 1.5 s, or equivalently (the wait being 5.0–5.2 s) a first action before 6.5 s. The *signature test* is the R2 registration\'s two-sided sample test. The signature test misses a slip that persists, which was all six instances examined above, so any figure from it is a floor. Every trial-level rate quoted so far comes from the timing rule and is a count of trials in which the subject acted early:'); say();
  say('| Figure | Population | Detector | Count or floor |'); say('|---|---|---|---|');
  say('| 6 of 215 | the study, all retained trials: LiveKit full isolation 80 (2 early), LiveKit media-only 70 (3), Janus full isolation 40 (1), Janus media-only 25 (0) | timing (detection before 1.5 s) | count |');
  say('| 2 of 78 | the study\'s 80 LiveKit full-isolation trials less the 2 with no client row in the removal-race table (empty server log); the same two early trials as in the row above | timing (first action before 6.5 s) | count |');
  say('| 7 of 180 | LiveKit full isolation: the study\'s 80 (2) and R3\'s 100 (5) | timing (detection before 1.5 s) | count |');
  say('| 1 of 40 | Janus full isolation, the study | timing (detection before 1.5 s) | count |');
  say(`| ${e.length} of ${rows.length} | R3, all valid trials | timing (first attempt before ${EARLY} s, the registered rule) | count |`);
  say('| 0 defect-triggered of 8 (R2, each condition) | R2\'s T4 trials that took an action (none did) | signature test, two-sided | floor |');
  say(); say('"The study\'s six early trials" and "2 of 78" are therefore the same detector on nested populations: six in all 215 trials, of which two are in LiveKit full isolation. Both come from timing, so neither depends on the signature test and no re-examination for persistence is needed to stand behind the counts; persistence bears only on whether the R2 signature test would have flagged them. No comparison made so far sets a timing count against a signature-test figure: 5 of 100 against 2 of 78 is timing against timing.');
  say('Two limits on reading the timing counts as rates of the defect itself. They count trials in which a slip on a stream the subject receives tripped its rule; a slip at an observer, or one that reads too young to trip the rule, is not counted. As rates of the slip occurring anywhere they are floors. The R4 post-registration note computed its 33%, 22% and 48% from 7 of 180 and 1 of 40: as probabilities of an early start those rest on counts; as probabilities that the corrected decoder rejects a sample at the subject within 1 s of onset, which is what the informativeness criterion reads, they may be floors. The note is not amended.');
  say('Recorded without investigation: in livekit-iso-all-16s-O-W10-20261010T022442-31 both of the subject\'s incoming streams slipped together, by the same amount at the same instant. The defect is therefore not per-stream.');
  say();
  say(`Of these, the trials that are a deviation from their cell's predicted response or outcome: ${dev.map((x) => `${x.id} (${x.cell})`).join('; ') || 'none'}. Every deviation from a predicted response or outcome in a determined cell, early or not: ${rows.filter((x) => (PRED_P[x.cell] !== x.responded) || (PRED_S[x.cell] === 'survive' && x.outcome !== 'survive') || (PRED_S[x.cell] === 'rebuild' && x.outcome !== 'rebuild')).map((x) => `${x.id} (${x.cell}${x.early ? ', early' : ', NOT early'})`).join('; ') || 'none'}.`); }
say(); say('## Secondary rule M: per-trial timing'); say();
const scor = rows.filter((x) => x.open != null); const apart = scor.filter((x) => x.near), main = scor.filter((x) => !x.near);
say(`Trials with a first connection: ${scor.length} of ${rows.length}. Set apart (restore within ${NEAR} s after a schedule instant): ${apart.length}, of which hits ${apart.filter((x) => x.mHit).length}.`);
for (const a of [...Object.keys(PLAN), 'all']) { const g = main.filter((x) => a === 'all' || x.arm === a); const resp = g.filter((x) => x.responded && x.predArrive != null);
  say(`- ${a}: ${g.filter((x) => x.mHit).length} hits of ${g.length} | response classified correctly ${g.filter((x) => x.predRespond === x.responded).length} | arrival minus predicted, where a response came: ${rng(resp.map((x) => x.responseAt - x.predArrive))} s (${resp.length})`); }
const miss = main.filter((x) => !x.mHit); if (miss.length) { say(); say('Misses: ' + miss.map((x) => `${x.id} open ${f2(x.open)} restore ${f2(x.restore)} predicted ${x.predRespond ? 'response at ' + f2(x.predArrive) : 'no response'}; observed ${x.responded ? x.response + ' at ' + f2(x.responseAt) : 'none'}`).join(' | ')); }

say(); say('## Derived rule S: survive or rebuild'); say();
say('| Cell | Valid | Survive | Rebuild | Rebuild completed (s) | Predicted | Reading |'); say('|---|---|---|---|---|---|---|');
for (const c of cells) { const g = of(c); const sv = g.filter((x) => x.outcome === 'survive').length, rb = g.length - sv; const p = PRED_S[c];
  const reading = !g.length ? 'no trials' : g.length < 10 ? `incomplete (${g.length} of 10 valid): the rule defines no verdict` : p === 'survive' ? (sv >= 9 ? 'as predicted' : 'AGAINST') : p === 'rebuild' ? (rb >= 9 ? 'as predicted' : 'AGAINST') : p === 'A' ? (sv >= 7 ? 'assumption A holds' : sv <= 2 ? 'assumption A false (boundary 14/15); not evidence about the equation' : 'unresolved') : 'descriptive, no verdict (expected about 2 of 10 under A, 0 otherwise)';
  say(`| ${c} | ${g.length} | ${sv} | ${rb} | ${rng(g.filter((x) => x.rebuildDone != null).map((x) => x.rebuildDone))} | ${p === 'A' ? 'under A: 7 or more survive' : p === 'desc' ? 'none' : p + ', 9 or more'} | ${reading} |`); }
say(); say('Timing parts of S: W25-19 and W25-26 rebuilds completed by 28 s: ' + ['W25-19', 'W25-26'].map((c) => `${c} ${of(c).filter((x) => x.rebuildDone != null && x.rebuildDone <= 28).length} of ${of(c).filter((x) => x.outcome === 'rebuild').length}`).join(', ') + `; W25-28 rebuilds completed after 37 s: ${of('W25-28').filter((x) => x.rebuildDone != null && x.rebuildDone > 37).length} of ${of('W25-28').filter((x) => x.outcome === 'rebuild').length}.`);

say(); say('## Assumption A observed directly: the server\'s ICE report, W10-15 and W10-16'); say();
for (const c of ['W10-15', 'W10-16']) { const g = of(c); const u = g.filter((x) => x.ice.usable);
  const agree = u.filter((x) => (x.ice.failed == null) === (x.outcome === 'survive')).length;
  say(`- ${c}: server log usable in ${u.length} of ${g.length}. No ICE failure reported: ${u.filter((x) => x.ice.failed == null).length}; failure reported: ${u.filter((x) => x.ice.failed != null).length} (at ${rng(u.filter((x) => x.ice.failed != null).map((x) => x.ice.failed))} s). Outcome agrees with the report (no failure and survive, or failure and rebuild): ${agree} of ${u.length}. Survivors whose second attempt was accepted: ${g.filter((x) => x.outcome === 'survive' && x.second && x.second.result === 'accepted').length} of ${g.filter((x) => x.outcome === 'survive').length}.`); }
const allU = rows.filter((x) => x.ice.usable); say(`- all cells: server log usable in ${allU.length} of ${rows.length}; ICE failure reported at ${rng(allU.filter((x) => x.ice.failed != null).map((x) => x.ice.failed))} s (${allU.filter((x) => x.ice.failed != null).length}); removal minus failure ${rng(allU.filter((x) => x.ice.removal != null && x.ice.failed != null).map((x) => x.ice.removal - x.ice.failed))} s.`);

say(); say('## Recorded times'); say();
say(`First attempt begins ${rng(rows.filter((x) => !x.early && x.begin != null).map((x) => x.begin))} s; connection opened ${rng(rows.filter((x) => !x.early && x.open != null).map((x) => x.open))} s; restore minus nominal ${rng(rows.map((x) => x.restore - x.D))} s.`);
console.log(out.join('\n'));
fs.mkdirSync('logs/timeout', { recursive: true }); fs.writeFileSync(`logs/timeout/score-${path.basename(dir)}.json`, JSON.stringify(rows, null, 1));
