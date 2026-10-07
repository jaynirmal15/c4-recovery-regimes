// Assemble the cited dataset: the 215 retained trials.
//   run 1 (study/), minus the four LiveKit media-only conditions superseded by run 2, plus run 2 (study-r2/).
// Reads logs/study/divergence-all.json and logs/study/divergence-r2.json (outputs of divergence.mjs --json)
// and writes logs/study/divergence-final.json and logs/study/table-final.md.
// usage (from the repository root): node client/runner/final-dataset.mjs [outDir]
import fs from 'node:fs';
const out = process.argv[2] || 'logs/study';
const SUPERSEDED = (r) => r.stack === 'livekit' && r.mode === 'media' && [23, 26, 28, 30].includes(r.D);
const a = JSON.parse(fs.readFileSync('logs/study/divergence-all.json', 'utf8')).filter((r) => !SUPERSEDED(r)).map((r) => ({ ...r, run: 1 }));
const b = JSON.parse(fs.readFileSync('logs/study/divergence-r2.json', 'utf8')).map((r) => ({ ...r, run: 2 }));
const rows = [...a, ...b];
fs.writeFileSync(`${out}/divergence-final.json`, JSON.stringify(rows));
const rng = (xs, d = 1) => { const v = xs.filter((x) => x != null); if (!v.length) return '–'; const lo = Math.min(...v).toFixed(d), hi = Math.max(...v).toFixed(d); return lo === hi ? lo : `${lo}–${hi}`; };
const cnt = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort().map(([k, v]) => `${k}×${v}`).join(' ');
const G = new Map(); for (const r of rows) { const k = `${r.stack}|${r.mode}|${r.D}`; if (!G.has(k)) G.set(k, []); G.get(k).push(r); }
const lines = ['| Stack | Mode | D (s) | n | Regime | Outage (s) | Membership reported | at (s) | unreported share | Media/quality signal | onset delay (s) | recovery error (s) |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const [k, rs] of [...G].sort((x, y) => { const [a1, a2, a3] = x[0].split('|'), [b1, b2, b3] = y[0].split('|'); return a1.localeCompare(b1) || a2.localeCompare(b2) || a3 - b3; })) {
  const [st, mo, D] = k.split('|');
  const m = rs.map((r) => r.layers.A_membership), rep = m.filter((l) => l.kind !== 'nothing');
  const sig = rs.map((r) => (st === 'janus' ? r.layers.A_media : r.layers.B_obs_quality)), srep = sig.filter((l) => l.kind !== 'nothing');
  lines.push(`| ${[st === 'livekit' ? 'LiveKit' : 'Janus', mo === 'all' ? 'full' : 'media-only', D, rs.length, cnt(rs.map((r) => r.regime)), rng(rs.map((r) => (r.truth.up != null && r.truth.down != null ? r.truth.up - r.truth.down : null))), `${rep.length}/${rs.length}`, rng(rep.map((l) => l.down)), rep.length ? rng(rep.map((l) => l.blindFrac), 2) : '1.00', `${srep.length}/${rs.length}`, rng(srep.map((l) => l.onsetDelay)), rng(srep.map((l) => l.upError))].join(' | ')} |`);
}
fs.writeFileSync(`${out}/table-final.md`, lines.join('\n') + '\n');
console.log(`${rows.length} trials (${a.length} from run 1, ${b.length} from run 2) in ${G.size} conditions -> ${out}/divergence-final.json, ${out}/table-final.md`);
