// Janus reception-to-playout gap: what each instrument configuration supports on its own (read-only).
// usage, from the repository root: node client/runner/janus-quantum-separation.cjs > logs/study/janus-quantum-separation.txt
// Inputs, each written by an existing script from the trial records and not edited:
//   logs/study/janus-early/burst-vs-residual.json  (janus-burst-vs-residual.cjs: the 15 study trials at 10, 30 and 45 s
//     media-only, run WITHOUT the browser-statistics sampler; backlog from the server's packet counters)
//   logs/study/janus-early/backlog-cell-stats.json (janus-backlog-stats.cjs over backlog-cell/: the 10 follow-up trials at
//     16 and 20 s media-only, run WITH the sampler every 250 ms; backlog and discards from the browsers' counters)
// Model under test, the one the manuscript states: the receiver discards one quantum q each time it fills, so a backlog
// B leaves a residual B - floor(B/q)*q. Candidates are the values the manuscript names plus 1 s. No tolerance is chosen
// here: the worst disagreement is printed for every candidate and population.
const fs = require('fs');
const U = JSON.parse(fs.readFileSync('logs/study/janus-early/burst-vs-residual.json', 'utf8'));
const Sm = JSON.parse(fs.readFileSync('logs/study/janus-early/backlog-cell-stats.json', 'utf8'));
const CAND = [1, 2, 10 / 3, 4, 5, 20 / 3, 8, 10, 20];
const rng = (v, d = 2) => v.length ? `${Math.min(...v).toFixed(d)}–${Math.max(...v).toFixed(d)}` : '–';
const un = U.flatMap((r) => r.obs.map((o) => ({ D: r.D, B: r.burstS, resid: o.resid })));
const sa = Sm.flatMap((r) => r.obs.map((o) => ({ D: r.D, id: r.id, B: o.burstPk / 50, resid: o.resid, discarded: o.discarded, lost: o.lost })));
const withB = sa.filter((x) => x.B > 2), noB = sa.filter((x) => x.B <= 2);
console.log(`UNSAMPLED (study, no browser statistics): ${U.length} trials, ${un.length} observer streams`);
for (const D of [...new Set(un.map((x) => x.D))]) { const g = un.filter((x) => x.D === D); console.log(`  ${D} s: backlog ${rng(g.map((x) => x.B))} s | residual ${rng(g.map((x) => x.resid))} s | backlog minus residual ${rng(g.map((x) => x.B - x.resid))} s`); }
console.log(`SAMPLED (follow-up, statistics every 250 ms): ${Sm.length} trials, ${sa.length} observer streams; a backlog over 2 s in ${withB.length} streams of ${new Set(withB.map((x) => x.id)).size} trials, none in ${noB.length} streams of ${new Set(noB.map((x) => x.id)).size} trials (largest ${Math.max(...noB.map((x) => x.B)).toFixed(2)} s, discarded ${Math.max(...noB.map((x) => x.discarded))})`);
for (const D of [...new Set(withB.map((x) => x.D))]) { const g = withB.filter((x) => x.D === D); console.log(`  ${D} s: backlog ${rng(g.map((x) => x.B))} s | packets discarded ${[...new Set(g.map((x) => x.discarded))].join(', ')} | lost ${[...new Set(g.map((x) => x.lost))].join(', ')} | residual ${rng(g.map((x) => x.resid))} s`); }
const worst = (g, q) => Math.max(...g.map((x) => Math.abs((x.B - Math.floor(x.B / q + 1e-9) * q) - x.resid)));
const count = (g, q) => g.filter((x) => Math.round(Math.floor(x.B / q + 1e-9) * q * 50) === x.discarded).length;
console.log('\nquantum q (s) | UNSAMPLED: worst |predicted - observed residual| (s) | SAMPLED: worst residual disagreement (s) | SAMPLED: streams whose discard counter equals floor(B/q)*q');
for (const q of CAND) console.log(`  ${q.toFixed(2)} | ${worst(un, q).toFixed(2)} | ${worst(withB, q).toFixed(2)} | ${count(withB, q)} of ${withB.length}`);
console.log('\nper 30 s stream, unsampled, residual predicted at q = 4: ' + un.filter((x) => x.D === 30).map((x) => `${(x.B - Math.floor(x.B / 4) * 4).toFixed(2)} vs ${x.resid.toFixed(2)}`).join(' | '));
