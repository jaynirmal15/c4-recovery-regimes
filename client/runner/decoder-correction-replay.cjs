// Proposed decoder correction, replayed over recorded samples (read-only; nothing is run and no record is changed).
// usage, from the repository root: node client/runner/decoder-correction-replay.cjs > logs/study/decoder/correction-replay.txt
// The correction rejects a decoded sample that is physically impossible for a played stream:
//   F: its sender time is ahead of the receiver's clock (recorded as an age of 32 s or more, the 64 s wrap), or
//   B: its sender time is one period of the fine chirp (2 s, taken as 1.5 to 2.5 s) EARLIER than that of the last accepted
//      sample, which was decoded less than 1 s before it. A played stream's sender time does not run backwards; the
//      window is the one the R2 registration used to define the 2 s defect.
// A first version of B rejected any backward step over 0.5 s. It is not used: in the study it rejected 185 samples, 149
// of them stepping back by more than 2.5 s (up to 14.1 s) during recovery, which are not the defect. Kept here as a count.
// Sets, each enumerated from the filesystem: the dataset index (logs/study/divergence-final.json, 215 rows resolved under
// study/ and study-r2/), control/ (valid sessions), timeout/ (valid R3 trials). Every participant record, every stream.
// For isolation trials it also replays the subject's detection rule (a remote stream's effective age over 2 s) on the
// recorded samples, with and without the correction, at the 200 ms tick the driver uses.
const fs = require('fs'), path = require('path'); const BACK_LO = 1500, BACK_HI = 2500, NEAR = 1000, AGE = 2000, TICK = 200;
const sets = [];
{ const idx = JSON.parse(fs.readFileSync('logs/study/divergence-final.json', 'utf8')); sets.push({ name: 'study (215)', dirs: idx.map((r) => ['study', 'study-r2'].map((s) => `${s}/${r.dir}`).find((x) => fs.existsSync(`${x}/S.json`))) }); }
for (const [name, d] of [['control (healthy sessions)', 'control'], ['R3 (timeout)', 'timeout']]) sets.push({ name, dirs: fs.readdirSync(d).map((x) => path.join(d, x)).filter((x) => fs.existsSync(path.join(x, 'result.json')) && JSON.parse(fs.readFileSync(path.join(x, 'result.json'), 'utf8')).valid) });
const filt = (xs) => { const keep = [], rej = []; let last = null; for (const s of xs) { if (s.age >= 32000) { rej.push({ ...s, why: 'F' }); continue; } if (last && s.tP - last.tP < NEAR && last.tS - s.tS >= BACK_LO && last.tS - s.tS <= BACK_HI) { rej.push({ ...s, why: 'B', back: last.tS - s.tS }); continue; } keep.push(s); last = s; } return { keep, rej }; };
const detect = (streams, t0, tEnd) => { // first tick after onset at which any remote stream's effective age exceeds AGE
  for (let t = t0; t < tEnd; t += TICK / 4) for (const xs of streams) { let last = null; for (const s of xs) { if (s.tP <= t) last = s; else break; } if (last && t - last.tS > AGE) return (t - t0) / 1000; } return null; };
for (const set of sets) { let samples = 0, F = 0, B = 0, streams = 0, hours = 0, anyBack = 0, bigBack = 0; const backs = [], where = { 'within 1 s after onset': 0, 'within 3 s after a gap over 300 ms': 0, other: 0 }; const det = [];
  for (const d of set.dirs) { const r = JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')); const t0 = r.iso ? r.iso.onset.after : null; let rowS = null;
    for (const w of ['S', 'O1', 'O2']) { const p = path.join(d, w + '.json'); if (!fs.existsSync(p)) continue; const O = JSON.parse(fs.readFileSync(p, 'utf8')); const per = [];
      for (const k of Object.keys(O.fresh || {})) { const xs = O.fresh[k].slice().sort((a, b) => a.tP - b.tP); if (!xs.length) continue; const { keep, rej } = filt(xs); streams++; { let l = null; for (const z of xs) { if (z.age >= 32000) continue; if (l && z.tS < l.tS - 500) { anyBack++; if (l.tS - z.tS > BACK_HI) bigBack++; continue; } l = z; } } samples += xs.length; hours += (xs[xs.length - 1].tP - xs[0].tP) / 3.6e6;
        for (const x of rej) { if (x.why === 'F') F++; else { B++; backs.push(x.back); } const i = xs.indexOf(x); const gapBefore = xs.slice(Math.max(0, i - 24), i + 1).some((s, j, a) => j && s.tP - a[j - 1].tP > 300);
          if (t0 != null && x.tP > t0 && x.tP < t0 + 1000) where['within 1 s after onset']++; else if (gapBefore) where['within 3 s after a gap over 300 ms']++; else where.other++; }
        per.push({ raw: xs, keep }); }
      if (w === 'S' && t0 != null) rowS = { id: path.basename(d), raw: detect(per.map((x) => x.raw), t0, t0 + 8000), cor: detect(per.map((x) => x.keep), t0, t0 + 8000), rec: ((h) => (h ? (h.t - t0) / 1000 : null))(O.driver.history.find((h) => h.state === 'detected' && h.t > t0)) }; }
    if (rowS) det.push(rowS); }
  const rng = (v) => (v.length ? `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}` : '–');
  console.log(`\n== ${set.name}: ${set.dirs.length} trials or sessions | ${streams} streams | ${samples} samples | ${hours.toFixed(1)} stream-hours`);
  console.log(`   rejected: F (sender time ahead of the clock) ${F} | B (sender time one fine period back, within 1 s) ${B} | per million samples ${(1e6 * (F + B) / samples).toFixed(0)}`);
  console.log(`   B: how far back, ms: ${rng(backs)}`);
  console.log(`   (the unused broad rule would have rejected ${anyBack} for stepping back over 0.5 s, ${bigBack} of them by more than 2.5 s)`);
  console.log(`   where the rejected samples fall: ${JSON.stringify(where)}`);
  if (det.length) { const both = det.filter((x) => x.rec != null && x.raw != null); const early = det.filter((x) => x.rec != null && x.rec < 1.5);
    console.log(`   subject's detection, ${det.length} isolation trials: recorded by the driver ${rng(det.filter((x) => x.rec != null).map((x) => x.rec))} s (${det.filter((x) => x.rec != null).length} with a detection) | replay on the raw samples minus recorded: ${rng(both.map((x) => x.raw - x.rec))} s (${both.length})`);
    console.log(`   recorded detection before 1.5 s: ${early.length} trials | their replayed detection with the correction: ${early.map((x) => (x.cor == null ? 'none in 8 s' : x.cor.toFixed(2))).join(', ') || '–'}`);
    const rest = det.filter((x) => x.rec != null && x.rec >= 1.5 && x.raw != null && x.cor != null); console.log(`   all other trials with a detection in the replay window (${rest.length}): corrected minus raw replay ${rng(rest.map((x) => x.cor - x.raw))} s | changed by more than 0.05 s: ${rest.filter((x) => Math.abs(x.cor - x.raw) > 0.05).length}`); } }
