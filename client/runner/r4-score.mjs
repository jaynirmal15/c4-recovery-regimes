// R4 (REGISTRATION-R4-corrected-decoder.md): scoring. Read-only; applies the registered rules and nothing else.
// usage, from the repository root: node client/runner/r4-score.mjs [dir=replication] > logs/replication/SCORE.md
// Trial set: every directory under <dir> with a result.json whose control.arm is R4, enumerated from the filesystem.
// Invalid trials are listed and not scored. A cell with fewer than ten valid trials prints "incomplete" and no verdict.
import fs from 'node:fs'; import path from 'node:path';
const BAND = [1.8, 2.2], OPEN = [7.05, 7.65], EARLY_WINDOW = 1000;
const dir = process.argv[2] || 'replication'; const f2 = (x) => (x == null ? '–' : x.toFixed(2)); const rng = (v) => (v.length ? `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}` : '–');
const rows = [], invalid = [];
for (const name of fs.readdirSync(dir).sort()) { const d = path.join(dir, name); if (!fs.existsSync(path.join(d, 'result.json'))) continue;
  const r = JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')); if (!r.control || r.control.arm !== 'R4' || !r.iso) continue;
  if (!r.valid) { invalid.push({ id: r.id, why: r.invalid }); continue; }
  const t0 = r.iso.onset.after; const rel = (t) => (t - t0) / 1000; const dumps = {}; for (const w of ['S', 'O1', 'O2']) dumps[w] = JSON.parse(fs.readFileSync(path.join(d, w + '.json'), 'utf8'));
  const S = dumps.S; const det = S.driver.history.find((h) => h.state === 'detected' && h.t > t0); const acts = S.driver.actions; const a1 = acts[0];
  const open = a1 && S.frames.find((f) => f.dir === 'open' && f.t >= a1.tStart);
  const rejects = []; let samples = 0, wrapped = 0;
  for (const w of ['S', 'O1', 'O2']) { const O = dumps[w]; for (const k of Object.keys(O.fresh || {})) { samples += O.fresh[k].length; wrapped += O.fresh[k].filter((s) => s.age >= 32000).length; }
    for (const l of O.log.filter((x) => x.type === 'decoder_reject')) { const near = O.log.filter((e) => (e.type === 'remote_attached' || (e.type === 'driver_state' && e.state === 'left') || (e.type === 'lk_room_event' && /Participant(Dis)?[Cc]onnected/.test(e.ev))) && Math.abs(e.t - l.tP) < 3000).length;
      rejects.push({ at: w, stream: l.key, why: l.why, t: rel(l.tP), age: l.age, where: l.tP > t0 && l.tP < t0 + EARLY_WINDOW ? 'onset' : near ? 'attach-or-leave' : (l.tP > t0 && l.tP < r.iso.restore.after + 30000) ? 'outage-or-recovery' : 'healthy' }); } }
  rows.push({ id: r.id, stack: r.stack, D: r.iso.plannedS, build: r.control.build && r.control.build.name, detect: det ? rel(det.t) : null, firstAction: a1 ? { kind: a1.kind, t: rel(a1.tStart), ok: !!(a1.result && a1.result.ok) } : null, open: open ? rel(open.t) : null,
    outcome: acts.some((a) => a.kind === 'rebuild') ? 'rebuild' : acts.length ? 'restart' : 'ride-out', actions: acts.map((a) => `${a.kind}@${f2(rel(a.tStart))}:${a.result && a.result.ok ? 'ok' : (a.result && (a.result.refused || a.result.detail)) || '?'}`),
    inBand: det ? rel(det.t) >= BAND[0] && rel(det.t) <= BAND[1] : false, rejects, rejectAtSOnset: rejects.filter((x) => x.at === 'S' && x.where === 'onset').length, samples, wrapped }); }
const out = []; const say = (s = '') => out.push(s);
say(`# R4 score (${dir}/)`); say(); say(`Valid trials scored: ${rows.length}. Invalid, listed and not scored: ${invalid.length}${invalid.length ? ' (' + invalid.map((x) => `${x.id}: ${JSON.stringify(x.why)}`).join('; ') + ')' : ''}.`);
say('Design intent (REGISTRATION-R4-NOTE-1.md, written after the run had begun and not part of the registration): the run is powered for the primary question, whether a corrected instrument reproduces ten restarts and ten ride-outs. Whether the correction catches the defect live is answered only by informative trials, expected in a little under half of runs like this one.');
say('The note\'s 33%, 22% and 48% were computed from timing-rule counts of early starts (7 of 180, 1 of 40). As rates of the corrected decoder rejecting a sample at the subject within 1 s of onset, which is what "informative" reads here, those may be floors (logs/timeout/SCORE.md). The note is not amended.');
say(`Build recorded in every scored trial: ${[...new Set(rows.map((x) => x.build))].join(', ') || '–'}.`);
for (const [stack, D, want] of [['livekit', 17, 'restart'], ['janus', 5, 'ride-out']]) { const g = rows.filter((x) => x.stack === stack && x.D === D); say(); say(`## ${stack}, full isolation, ${D} s`); say();
  say('| Trial | Detection (s) | In band | First action | Connection opened (s) | Outcome | Rejected at S within 1 s of onset | All rejections |'); say('|---|---|---|---|---|---|---|---|');
  for (const x of g) say(`| ${x.id} | ${f2(x.detect)} | ${x.inBand ? 'yes' : 'NO'} | ${x.firstAction ? `${x.firstAction.kind} at ${f2(x.firstAction.t)}` : 'none'} | ${f2(x.open)} | ${x.outcome} | ${x.rejectAtSOnset} | ${x.rejects.length} |`);
  say(); const ok = g.filter((x) => x.outcome === want), band = g.filter((x) => x.inBand), opens = g.filter((x) => x.open != null);
  say(`Outcome ${want}: ${ok.length} of ${g.length}. Detection ${rng(g.filter((x) => x.detect != null).map((x) => x.detect))} s; inside ${BAND[0]}–${BAND[1]} s: ${band.length} of ${g.length}.${stack === 'livekit' ? ` First connection opened ${rng(opens.map((x) => x.open))} s; inside ${OPEN[0]}–${OPEN[1]} s: ${opens.filter((x) => x.open >= OPEN[0] && x.open <= OPEN[1]).length} of ${opens.length}.` : ''}`);
  const outBand = g.filter((x) => !x.inBand), other = g.filter((x) => x.outcome !== want);
  const reading = g.length < 10 ? `incomplete (${g.length} of 10 valid): the rule defines no verdict` : outBand.length ? `INCOMPLETE CORRECTION: detection outside the band in ${outBand.length} (${outBand.map((x) => x.id).join('; ')}); the arm tests nothing` : other.length ? `WEIGHS AGAINST: ${other.length} trial(s) with another outcome while detection was in the band (${other.map((x) => `${x.id}: ${x.actions.join(', ')}`).join('; ')}); to be examined, not an automatic verdict` : 'SUPPORTS: ten of ten with detection in the band';
  say(`Reading: ${reading}.`);
  const ex = g.filter((x) => x.rejectAtSOnset); say(`Informative trials (the subject's decoder rejected a sample within 1 s of onset, so the correction was exercised where the defect acts): ${ex.length} of ${g.length}${ex.length ? ' (' + ex.map((x) => `${x.id}: ${x.rejects.filter((q) => q.at === 'S' && q.where === 'onset').map((q) => `${q.stream} ${q.why} age ${(q.age / 1000).toFixed(2)} s at ${f2(q.t)}`).join(', ')}; detection ${f2(x.detect)}; ${x.outcome}`).join(' | ') + ')' : ''}. ${ex.length ? '' : 'With none, this arm shows the corrected build behaving as the study build does in the absence of the defect and says nothing about the correction.'}`); }
say(); say('## Rejections by the corrected decoder, all participants, all trials'); say();
const all = rows.flatMap((x) => x.rejects.map((q) => ({ ...q, id: x.id, stack: x.stack }))); const by = {}; for (const q of all) { const k = `${q.stack} | ${q.where} | ${q.why}`; by[k] = (by[k] || 0) + 1; }
say(`Samples accepted: ${rows.reduce((a, x) => a + x.samples, 0)}; rejected: ${all.length}; recorded samples with an age of 32 s or more (the correction should leave none): ${rows.reduce((a, x) => a + x.wrapped, 0)}.`);
for (const k of Object.keys(by).sort()) say(`- ${k}: ${by[k]}`);
const healthy = all.filter((q) => q.where === 'healthy'); say(`Rejections in healthy audio (not within 1 s after onset, not during outage or the 30 s after restore, not within 3 s of a stream attaching or a participant leaving): ${healthy.length}${healthy.length ? ' (' + healthy.map((q) => `${q.id} ${q.at}<-${q.stream} ${q.why} age ${(q.age / 1000).toFixed(2)} at ${f2(q.t)}`).join('; ') + ')' : ''}.`);
say(`Trials with a rejection at any receiver within 1 s of onset: ${rows.filter((x) => x.rejects.some((q) => q.where === 'onset')).length} of ${rows.length}.`);
console.log(out.join('\n')); fs.mkdirSync('logs/replication', { recursive: true }); fs.writeFileSync(`logs/replication/score-${path.basename(dir)}.json`, JSON.stringify(rows, null, 1));
