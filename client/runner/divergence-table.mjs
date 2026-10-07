// One row per cell: regimes, outage, and per layer "reported k/n, kinds, onset delay, blind fraction, up error".
// usage: node divergence-table.mjs rows.json
import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const rows = all.filter((r) => r.valid && r.serverComplete);
const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const rng = (xs, d = 1) => { const v = xs.filter((x) => x != null); return v.length ? (Math.min(...v).toFixed(d) === Math.max(...v).toFixed(d) ? Math.min(...v).toFixed(d) : `${Math.min(...v).toFixed(d)}..${Math.max(...v).toFixed(d)}`) : '-'; };
const cnt = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).map(([a, b]) => `${a}×${b}`).join(' ');
const G = new Map(); for (const r of rows) { const k = `${r.stack} ${r.mode.padEnd(5)} ${String(r.D).padStart(2)}s`; if (!G.has(k)) G.set(k, []); G.get(k).push(r); }
console.log(`rows ${all.length}, analysed ${rows.length}, excluded ${all.length - rows.length}`);
for (const [k, rs] of [...G].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
  console.log(`\n${k} n=${rs.length} | regimes ${cnt(rs.map((r) => r.regime))} | disturbed ${rs.filter((r) => r.truth.down != null).length}/${rs.length} | outage ${rng(rs.map((r) => (r.truth.up != null && r.truth.down != null ? r.truth.up - r.truth.down : null)))} s | stale ${rng(rs.map((r) => r.truth.staleS))} s`);
  for (const L of ['A_membership', 'A_state', 'A_media', 'B_obs_membership', 'B_obs_quality', 'B_subject']) {
    const ls = rs.map((r) => r.layers[L]); if (ls.every((l) => /^no such|^not captured/.test(l.kind))) continue;
    const rep = ls.filter((l) => l.kind !== 'nothing');
    console.log(`   ${L.padEnd(17)} ${rep.length}/${ls.length}` + (rep.length ? `  [${cnt(rep.map((l) => l.kind))}] at ${rng(rep.map((l) => l.down))} s; onsetDelay ${rng(rep.map((l) => l.onsetDelay))}; blindFrac med ${med(ls.map((l) => l.blindFrac))}; up ${rep.filter((l) => l.up != null).length}/${rep.length} upErr ${rng(rep.map((l) => l.upError))}` : '  nothing'));
  }
}
