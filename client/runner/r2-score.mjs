// R2 scoring: applies the verdict rule of REGISTRATION-R2-detection-threshold.md (read-only).
// Written and committed before the run it scores. usage, from the repository root, after `npm ci`:
//   node client/runner/r2-score.mjs [dir ...]          default: threshold
// Trial set: every directory under each given directory that holds a result.json, enumerated at run time.
// Only LiveKit isolation trials with a planned outage of 2 s are scored; anything else found is counted and named.
// A trial's arm is the one written in its record by the runner (control.arm, T4 or T2); a record without one
// (for example a study trial passed in for comparison) is grouped as "study" and never enters a verdict.
//
// Definitions are those of the 215 (analyze.mjs): first stale = the last sample before the first gap of more than
// 300 ms or the first sample older than 1 s, after isolation onset; fresh again = the first sample from which the
// age stays within the band of baseline for 1 s with no gap of more than 300 ms; the interruption is the earliest
// first-stale to the latest fresh-again over the two observers. The script recomputes them so that the band (125,
// 250, 375 ms) and the gap tolerated inside the hold (300 or 450 ms) can be varied, and checks its default against
// analyze.mjs on every trial.
import fs from 'node:fs'; import path from 'node:path'; import { analyze } from './analyze.mjs';
const MARGIN = 0.90, MIN_NO_ACTION = 6; // registered: 0.90 s; a condition is informative with at least 6 of its 8 T4 trials taking no action
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const r2 = (x) => (x == null ? null : +x.toFixed(2)); const med = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const GAP = 300;

function freshAt(samples, base, t0, band, holdGap) {
  const xs = samples.filter((s) => s.tP >= t0);
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].age > base + band) continue;
    let j = i + 1, good = true;
    while (j < xs.length && xs[j].tP <= xs[i].tP + 1000) { if (xs[j].age > base + band || xs[j].tP - xs[j - 1].tP > holdGap) { good = false; break; } j++; }
    if (good && j < xs.length && xs[j].tP - xs[j - 1].tP <= holdGap) return xs[i].tP;
  }
  return null;
}
function interruption(O, t0, band, holdGap) { // O = the two observers' dumps
  const per = O.map((d) => { const xs = (d.fresh.S || []).slice().sort((a, b) => a.tP - b.tP); const base = (d.driver.baseline || {}).S ?? 100;
    let prev = t0, dist = null; for (const s of xs.filter((s) => s.tP >= t0)) { if (s.tP - prev > GAP || s.age > 1000) { dist = prev; break; } prev = s.tP; }
    return { dist, up: freshAt(xs, base, dist ?? t0, band, holdGap) }; });
  const downs = per.map((p) => p.dist).filter((x) => x != null); const ups = per.map((p) => p.up);
  const down = downs.length ? Math.min(...downs) : null; const up = ups.every((x) => x != null) ? Math.max(...ups) : null;
  return { down, up, s: down != null && up != null ? (up - down) / 1000 : null, per };
}

function score(dir) {
  const r = rd(dir, 'result.json'); if (!r.iso || r.stack !== 'livekit' || r.iso.plannedS !== 2) return { skip: `${r.stack} ${r.test}${r.iso ? ` ${r.iso.plannedS} s` : ''}`, id: r.id };
  const S = rd(dir, 'S.json'), O1 = rd(dir, 'O1.json'), O2 = rd(dir, 'O2.json'); const t0 = r.iso.onset.after, tr = r.iso.restore.after; const rel = (t) => r2((t - t0) / 1000);
  const arm = r.control && r.control.arm ? r.control.arm : 'study'; const thr = (S.params || {}).mediaAgeMs;
  const out = { id: r.id, dir, cond: r.iso.mode === 'all' ? 'full' : 'media-only', arm, valid: r.valid, invalid: r.invalid, threshold: thr, clientKernel: r.control ? r.control.clientKernel : null };
  // the subject: detection, actions, and the largest age the rule read before any action
  const det = S.log.find((l) => l.type === 'driver_state' && l.state === 'detected' && l.t > t0 - 1000); const act = S.driver.actions[0] || null; const end = act ? act.tStart : t0 + 12000;
  const streams = Object.fromEntries(['O1', 'O2'].map((k) => [k, (S.fresh[k] || []).slice().sort((a, b) => a.tP - b.tP)]));
  let ruleMax = 0; for (let t = t0; t < end; t += 50) for (const s of Object.values(streams)) { let last = null; for (const x of s) { if (x.tP <= t) last = x; else break; } if (last) ruleMax = Math.max(ruleMax, t - last.tS); }
  out.detectedAt = det ? rel(det.t) : null; out.actions = S.driver.actions.map((a) => ({ kind: a.kind, t: rel(a.tStart), end: a.tEnd ? rel(a.tEnd) : null, ok: !!(a.result && a.result.ok) })); out.action = !!act; out.ruleMaxS = r2(ruleMax / 1000);
  out.detectedThenHealthy = !!det && !act;
  // decoder-defect classification of a trial that acted (registered outcome 4), on each stream whose reading was over the threshold at detection
  out.defect = null; out.longIntervalAtCrossing = null;
  if (act && det) for (const [k, s] of Object.entries(streams)) {
    if (!(det.ages && det.ages[k] > thr)) continue;
    const i = s.findLastIndex((x) => x.tP <= det.t); if (i < 1 || i >= s.length - 1) continue; const prev = s[i], before = s[i - 1], next = s[i + 1];
    if ([before, next].every((n) => prev.age - n.age >= 1500 && prev.age - n.age <= 2500)) out.defect = { kind: '2 s defect', stream: k, sample: { t: rel(prev.tP), age: r2(prev.age) }, neighbours: [r2(before.age), r2(next.age)] };
    const interval = next.tP - prev.tP;
    if (interval > 300) { const b5 = med(s.slice(Math.max(0, i - 4), i + 1).map((x) => x.age)), a5 = med(s.slice(i + 1, i + 6).map((x) => x.age)); const step = a5 - b5; const wouldCross = prev.age + 256 > thr;
      if (step >= 5 && step <= 15 && !wouldCross && !out.defect) out.defect = { kind: 'playout-delay step', stream: k, intervalMs: Math.round(interval), stepMs: r2(step), ageBeforeMs: r2(prev.age) };
      else if (!out.defect) out.longIntervalAtCrossing = { stream: k, intervalMs: Math.round(interval), stepMs: r2(step), wouldHaveCrossedWithin256ms: wouldCross }; }
  }
  // the observers: the interruption, as analysed and under the registered variations
  const obs = [O1, O2]; const v = (band, hg) => interruption(obs, t0, band, hg); const d = v(250, 300);
  out.interruption = r2(d.s); out.firstStale = d.down != null ? rel(d.down) : null; out.freshAgain = d.up != null ? rel(d.up) : null; out.perObserver = d.per.map((p) => (p.dist != null && p.up != null ? r2((p.up - p.dist) / 1000) : null));
  out.band125 = r2(v(125, 300).s); out.band375 = r2(v(375, 300).s); out.gapTolerant = r2(v(250, 450).s); out.holdRestartedByGap = out.interruption != null && out.gapTolerant != null && Math.abs(out.interruption - out.gapTolerant) > 0.001;
  // observation window and headroom
  const left = (S.log.find((l) => l.type === 'driver_state' && l.state === 'left') || {}).t; out.observedAfterRestoreS = left ? r2((left - 500 - tr) / 1000) : null; out.notRecovered = d.up == null;
  // self-check against analyze.mjs at the defaults
  try { const a = analyze(dir); const ref = a.freshness && a.freshness.recovered_t != null ? a.freshness.recovered_t - Math.min(...a.freshness.disturbed.filter((x) => x != null)) : null; out.matchesAnalyze = ref == null ? out.interruption == null : out.interruption != null && Math.abs(ref - d.s) < 0.002; } catch (e) { out.matchesAnalyze = `analyze failed: ${e.message.slice(0, 80)}`; }
  return out;
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['threshold']; const rows = [], skipped = [];
for (const top of dirs) for (const d of fs.readdirSync(top).sort()) { const p = path.join(top, d); if (!fs.existsSync(path.join(p, 'result.json'))) continue; const x = score(p); (x.skip ? skipped : rows).push(x); }
const rng = (v) => (v.length ? `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}` : '–'); const L = [];
L.push('# R2 score', '', `Scored by client/runner/r2-score.mjs from: ${dirs.join(', ')}. Registered rule: margin ${MARGIN.toFixed(2)} s; a condition is informative with at least ${MIN_NO_ACTION} T4 trials that took no action.`, '');
L.push(`Trials found: ${rows.length} LiveKit 2 s isolation trials (${rows.filter((r) => r.valid).length} valid, ${rows.filter((r) => !r.valid).length} invalid); ${skipped.length} other records not scored${skipped.length ? `: ${skipped.map((s) => s.id).join(', ')}` : ''}.`);
L.push(`Self-check against analyze.mjs at the default thresholds: ${rows.filter((r) => r.matchesAnalyze === true).length} of ${rows.length} agree${rows.some((r) => r.matchesAnalyze !== true) ? `; DISAGREE: ${rows.filter((r) => r.matchesAnalyze !== true).map((r) => r.id).join(', ')}` : ''}.`);
const kern = rows.map((r) => r.clientKernel).filter(Boolean); if (kern.length) { const vals = new Set(kern.flatMap((k) => Object.values(k).map((c) => JSON.stringify(c)))); L.push(`Kernel settings read inside the client pods (${kern.length} trials, three pods each): ${[...vals].join(' ; ')}`); }
for (const r of rows.filter((r) => !r.valid)) L.push(`- invalid: \`${r.id}\` (${r.cond}, ${r.arm}): ${JSON.stringify(r.invalid)}`);
const verdict = (a, b) => { if (!a.length || !b.length) return { v: 'no data' }; const overlap = Math.max(Math.min(...a), Math.min(...b)) <= Math.min(Math.max(...a), Math.max(...b)); const dm = Math.abs(med(a) - med(b));
  return { v: !overlap && dm > MARGIN ? 'differs' : overlap && dm <= MARGIN ? 'indistinguishable' : 'not resolved by this sample', overlap, medianDiff: r2(med(a) - med(b)) }; };
const summary = {};
for (const cond of ['full', 'media-only']) {
  const g = rows.filter((r) => r.cond === cond && r.valid); if (!g.length) continue;
  const T4 = g.filter((r) => r.arm === 'T4'), T2 = g.filter((r) => r.arm === 'T2'), other = g.filter((r) => !['T4', 'T2'].includes(r.arm));
  const defect = T4.filter((r) => r.defect), acted = T4.filter((r) => r.action && !r.defect), noAct = T4.filter((r) => !r.action), noActRec = noAct.filter((r) => !r.notRecovered), T2rec = T2.filter((r) => !r.notRecovered);
  L.push('', `## LiveKit ${cond} isolation, 2 s`, '', '| Group | Trials | Detected | Took an action | Largest rule age before acting (s) | Interruption (s) | Median | Fresh-again (s after onset) | Observed after restore (s) |', '|---|---|---|---|---|---|---|---|---|');
  const line = (name, x) => L.push(`| ${name} | ${x.length} | ${x.filter((r) => r.detectedAt != null).length} | ${x.filter((r) => r.action).length} | ${rng(x.map((r) => r.ruleMaxS))} | ${rng(x.filter((r) => r.interruption != null).map((r) => r.interruption))} | ${x.some((r) => r.interruption != null) ? med(x.filter((r) => r.interruption != null).map((r) => r.interruption)).toFixed(2) : '–'} | ${rng(x.filter((r) => r.freshAgain != null).map((r) => r.freshAgain))} | ${rng(x.filter((r) => r.observedAfterRestoreS != null).map((r) => r.observedAfterRestoreS))} |`);
  line('T2, concurrent reference', T2); line('T4, no action', noAct); line('T4, restarted (not a defect)', acted); line('T4, defect-triggered', defect); if (other.length) line('other records (not in any verdict)', other);
  L.push('', `- T4 split: ${noAct.length} no action, ${acted.length} restarted, ${defect.length} defect-triggered, of ${T4.length} valid. T4 no-action trials that had detected and were declared healthy again before acting: ${noAct.filter((r) => r.detectedThenHealthy).length}.`);
  L.push(`- T2 trials that took no action: ${T2.filter((r) => !r.action).length} of ${T2.length}.`);
  for (const r of defect) L.push(`- defect-triggered, left out of the contrast: \`${r.id}\`: ${JSON.stringify(r.defect)}; interruption ${r.interruption} s.`);
  for (const r of [...T2, ...other].filter((r) => r.defect)) L.push(`- note, ${r.arm} trial whose detection meets a defect criterion (it stays in its group; the registration removes only T4 trials): \`${r.id}\`: ${JSON.stringify(r.defect)}.`);
  for (const r of acted.filter((r) => r.longIntervalAtCrossing)) L.push(`- restarted with a long interval at the crossing, not classed as a defect: \`${r.id}\`: ${JSON.stringify(r.longIntervalAtCrossing)}.`);
  const nr = g.filter((r) => r.notRecovered); for (const r of nr) L.push(`- **FLAG, not recovered within the window:** \`${r.id}\` (${r.arm}): no fresh-again within ${r.observedAfterRestoreS} s after restore. In neither verdict.`);
  const allInt = [...noActRec, ...T2rec].map((r) => r.interruption); const minWin = Math.min(...noAct.map((r) => r.observedAfterRestoreS).filter((x) => x != null));
  if (noAct.length && allInt.length) L.push(`- Observation headroom: T4 no-action trials were observed for at least ${minWin.toFixed(1)} s after restore; the longest interruption in either arm is ${Math.max(...allInt).toFixed(2)} s, ${(minWin / Math.max(...allInt)).toFixed(1)} times shorter. Trials not recovered within the window: ${nr.length}.`);
  const hr = [...noAct, ...T2].filter((r) => r.holdRestartedByGap); for (const r of hr) L.push(`- hold restarted by a single 300–450 ms gap: \`${r.id}\` (${r.arm}): ${r.interruption} s as analysed, ${r.gapTolerant} s with that gap tolerated.`);
  const informative = noAct.length >= MIN_NO_ACTION; const vs = { 'as analysed (band 250 ms)': verdict(noActRec.map((r) => r.interruption), T2rec.map((r) => r.interruption)), 'band 125 ms': verdict(noActRec.filter((r) => r.band125 != null).map((r) => r.band125), T2rec.filter((r) => r.band125 != null).map((r) => r.band125)), 'band 375 ms': verdict(noActRec.filter((r) => r.band375 != null).map((r) => r.band375), T2rec.filter((r) => r.band375 != null).map((r) => r.band375)), 'gap of up to 450 ms tolerated in the hold': verdict(noActRec.filter((r) => r.gapTolerant != null).map((r) => r.gapTolerant), T2rec.filter((r) => r.gapTolerant != null).map((r) => r.gapTolerant)) };
  L.push('', `**Contrast: T4 no-action (${noActRec.length}) against T2 (${T2rec.length}).** ${informative ? 'Informative' : `NOT INFORMATIVE: only ${noAct.length} T4 trials took no action (at least ${MIN_NO_ACTION} needed); no contrast is drawn`}.`);
  if (informative) { for (const [k, x] of Object.entries(vs)) L.push(`- ${k}: **${x.v}**${x.medianDiff != null ? ` (median T4 − T2 = ${x.medianDiff.toFixed(2)} s; ranges ${x.overlap ? 'overlap' : 'do not overlap'})` : ''}`);
    const main = vs['as analysed (band 250 ms)'].v; const bandDep = [vs['band 125 ms'].v, vs['band 375 ms'].v].some((x) => x !== main), gapDep = vs['gap of up to 450 ms tolerated in the hold'].v !== main;
    L.push(`- Registered verdict for this condition: **${main}**${bandDep ? ', dependent on the band' : ''}${gapDep ? ', dependent on a decode gap inside the hold' : ''}.`); summary[cond] = { verdict: main, bandDependent: bandDep, gapDependent: gapDep, ...vs['as analysed (band 250 ms)'] }; } else summary[cond] = { verdict: 'not informative', noAction: noAct.length };
  L.push('', '| Trial | Arm | Detected at | Actions | Rule max (s) | First stale | Fresh again | Interruption | band 125 | band 375 | gap tolerated | per observer |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of g) L.push(`| \`${r.id}\` | ${r.arm}${r.defect ? ' (defect)' : ''} | ${r.detectedAt ?? '–'} | ${r.actions.map((a) => `${a.kind.replace('transport_', '')}@${a.t}`).join(' ') || 'none'} | ${r.ruleMaxS} | ${r.firstStale ?? '–'} | ${r.freshAgain ?? '–'} | ${r.interruption ?? 'not recovered'} | ${r.band125 ?? '–'} | ${r.band375 ?? '–'} | ${r.gapTolerant ?? '–'} | ${r.perObserver.join(' / ')} |`);
}
L.push('', 'The straight-line drain in logs/study/short-outage.txt is an extrapolation and is not used here; agreement or disagreement with it is not a finding about the 215.');
const outDir = process.env.R2_OUT || 'logs/threshold'; fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'SCORE.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(outDir, 'score.json'), JSON.stringify({ margin: MARGIN, minNoAction: MIN_NO_ACTION, summary, rows }, null, 1));
console.log(L.join('\n'));
