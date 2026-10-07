// Per-observer recovery endpoints for the final dataset (read-only; no protocol decoding needed).
// Same definitions as analyze.mjs: fresh = age <= baseline+250 ms continuously for 1 s, gaps > 300 ms
// are not fresh; the timestamp is the START of that validated 1 s interval.
// usage (from the project root): node client/runner/per-observer.mjs
import fs from 'node:fs';
const GAP = 300;
function freshAt(samples, base, t0) { const xs = samples.filter((s) => s.tP >= t0);
  for (let i = 0; i < xs.length; i++) { if (xs[i].age > base + 250) continue; let j = i + 1, good = true;
    while (j < xs.length && xs[j].tP <= xs[i].tP + 1000) { if (xs[j].age > base + 250 || xs[j].tP - xs[j - 1].tP > GAP) { good = false; break; } j++; }
    if (good && j < xs.length && xs[j].tP - xs[j - 1].tP <= GAP) return xs[i].tP; } return null; }
const rows = JSON.parse(fs.readFileSync('logs/study/divergence-final.json', 'utf8')); const out = [];
for (const r of rows) { const dir = fs.existsSync(`study-r2/${r.id}`) ? `study-r2/${r.id}` : `study/${r.id}`;
  const res = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8')); const t0 = res.iso.onset.after; const rel = (t) => (t == null ? null : +((t - t0) / 1000).toFixed(3));
  const o = ['O1', 'O2'].map((w) => { const d = JSON.parse(fs.readFileSync(`${dir}/${w}.json`, 'utf8')); const xs = (d.fresh.S || []).slice().sort((a, b) => a.tP - b.tP); const base = (d.driver.baseline || {}).S ?? 100;
    let dist = null, prev = t0; for (const s of xs.filter((x) => x.tP >= t0)) { if (s.tP - prev > GAP || s.age > 1000) { dist = prev; break; } prev = s.tP; }
    return { dist: rel(dist), fresh: rel(dist != null ? freshAt(xs, base, dist) : freshAt(xs, base, t0)) }; });
  out.push({ id: r.id, stack: r.stack, mode: r.mode, D: r.D, regime: r.regime, dist: o.map((x) => x.dist), fresh: o.map((x) => x.fresh), both: Math.max(...o.map((x) => x.fresh)), truthUp: r.truth.up,
    qDown: r.layers.B_obs_quality.down, qKind: r.layers.B_obs_quality.kind, mUp: r.layers.A_media ? r.layers.A_media.up : null }); }
fs.writeFileSync('logs/study/per-observer.json', JSON.stringify(out));
console.log('check vs divergence-final truth.up: max |diff| =', Math.max(...out.map((r) => Math.abs(r.both - r.truthUp))).toFixed(3), 'n', out.length);
const rng = (xs, d = 1) => { const v = xs.filter((x) => x != null); if (!v.length) return '–'; const lo = Math.min(...v).toFixed(d), hi = Math.max(...v).toFixed(d); return lo === hi ? lo : `${lo}–${hi}`; };
const G = new Map(); for (const r of out) { const k = `${r.stack}|${r.mode}|${r.D}`; if (!G.has(k)) G.set(k, []); G.get(k).push(r); }
const lines = ['| Stack | Mode | D (s) | n | O1 fresh again (s) | O2 fresh again (s) | Both, i.e. the slower (s) | Largest O1–O2 difference (s) |', '|---|---|---|---|---|---|---|---|'];
for (const [k, g] of [...G].sort((x, y) => { const [a1, a2, a3] = x[0].split('|'), [b1, b2, b3] = y[0].split('|'); return a1.localeCompare(b1) || a2.localeCompare(b2) || a3 - b3; })) { const [st, mo, D] = k.split('|');
  lines.push(`| ${st === 'livekit' ? 'LiveKit' : 'Janus'} | ${mo === 'all' ? 'full' : 'media-only'} | ${D} | ${g.length} | ${rng(g.map((r) => r.fresh[0]))} | ${rng(g.map((r) => r.fresh[1]))} | ${rng(g.map((r) => r.both))} | ${Math.max(...g.map((r) => Math.abs(r.fresh[0] - r.fresh[1]))).toFixed(1)} |`); }
fs.writeFileSync('logs/study/table-per-observer.md', lines.join('\n') + '\n'); console.log(lines.join('\n'));
const d = out.map((r) => Math.abs(r.fresh[0] - r.fresh[1])).sort((a, b) => a - b); console.log('O1-O2 diff: median', d[d.length >> 1].toFixed(2), 'max', d[d.length - 1].toFixed(2), '| trials > 1 s:', d.filter((x) => x > 1).length, '| > 0.25 s:', d.filter((x) => x > 0.25).length);
for (const D of [2, 5]) for (const mo of ['all', 'media']) { const g = out.filter((r) => r.stack === 'livekit' && r.D === D && r.mode === mo); console.log('livekit', mo, D, '| quality report before the FIRST observer was fresh:', g.filter((r) => r.qDown < Math.min(...r.fresh)).length, '| before BOTH were fresh:', g.filter((r) => r.qDown < r.both).length, 'of', g.length, '| report at', rng(g.map((r) => r.qDown)), '| first observer fresh', rng(g.map((r) => Math.min(...r.fresh))), '| both', rng(g.map((r) => r.both)), '|', g.map((r) => r.qKind.replace('quality ', '')).join(',')); }
const J = out.filter((r) => r.stack === 'janus' && r.mode === 'media' && r.mUp != null);
for (const D of [2, 5, 10, 30, 45]) { const g = J.filter((r) => r.D === D); console.log('janus media', D, '| listener fresh minus reception resumed, per observer:', rng(g.flatMap((r) => r.fresh.map((f) => f - r.mUp)), 2), '| slower observer:', rng(g.map((r) => r.both - r.mUp), 2)); }
const JF = out.filter((r) => r.stack === 'janus' && r.mode === 'all' && r.mUp != null && r.regime !== 'R2'); console.log('janus full (session survived) per observer:', rng(JF.flatMap((r) => r.fresh.map((f) => f - r.mUp)), 2));
