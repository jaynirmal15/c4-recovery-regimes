// Aggregate divergence.mjs --json output by stack x mode x D x regime. usage: node divergence-agg.mjs rows.json [groupByArm]
import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((r) => r.valid && r.serverComplete && r.regime !== 'R3' && r.regime !== 'unclassified');
const byArm = process.argv[3] === 'arm';
const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const rng = (xs) => { const v = xs.filter((x) => x != null); return v.length ? `${Math.min(...v).toFixed(1)}..${Math.max(...v).toFixed(1)}` : '-'; };
const G = new Map();
for (const r of rows) { const k = [r.stack, r.mode, `${r.D}s`, r.regime, ...(byArm ? [r.arm] : [])].join(' '); if (!G.has(k)) G.set(k, []); G.get(k).push(r); }
for (const [k, rs] of [...G].sort()) {
  console.log(`\n${k}  n=${rs.length}  outage(first stale→fresh) ${rng(rs.map((r) => r.truth.up != null && r.truth.down != null ? r.truth.up - r.truth.down : null))} s`);
  for (const L of ['A_membership', 'A_media', 'A_state', 'B_obs_membership', 'B_obs_quality', 'B_subject']) {
    const ls = rs.map((r) => r.layers[L]); if (ls.every((l) => /^no such|^not captured/.test(l.kind))) continue;
    const kinds = {}; for (const l of ls) { const kk = l.kind === 'nothing' ? 'nothing' : l.kind.replace(/@.*/, ''); kinds[kk] = (kinds[kk] || 0) + 1; }
    const rep = ls.filter((l) => l.kind !== 'nothing');
    console.log(`  ${L.padEnd(17)} reported ${rep.length}/${ls.length}  [${Object.entries(kinds).map(([a, b]) => `${a}×${b}`).join(', ')}]` + (rep.length ? `  onsetDelay ${rng(rep.map((l) => l.onsetDelay))}  blindFrac med ${med(ls.map((l) => l.blindFrac))} (${rng(ls.map((l) => l.blindFrac))})  upErr ${rng(rep.map((l) => l.upError))} (up reported ${rep.filter((l) => l.up != null).length}/${rep.length})` : `  blindFrac 1.0`));
  }
}
