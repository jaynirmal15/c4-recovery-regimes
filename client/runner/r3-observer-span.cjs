// R3: what each observer's own connection looked like in every trial of the session, kept or not (read-only).
// usage, from the repository root: node client/runner/r3-observer-span.cjs [dir=timeout] > logs/timeout/observer-span.txt
// For every trial directory, in run order: validity; for each observer, the age of the OTHER observer's audio (a stream the
// isolation does not touch) from 10 s before onset until the first participant leaves: largest age above baseline, largest gap
// between decoded samples, count of samples more than 250 ms above baseline; whether the observer's rule fired and when,
// relative to the other observer leaving; and how long teardown took between O1 leaving and O2 leaving.
const fs = require('fs'), path = require('path'); const dir = process.argv[2] || 'timeout';
const rows = [];
for (const name of fs.readdirSync(dir)) { const d = path.join(dir, name); if (!fs.existsSync(path.join(d, 'result.json'))) continue;
  const r = JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')); if (!r.iso) continue; const t0 = r.iso.onset.after; const rel = (t) => (t - t0) / 1000;
  const row = { seq: Number(name.split('-').pop()), id: r.id, cell: r.control ? `${r.control.arm}-${r.iso.plannedS}` : '?', valid: r.valid, invalid: r.invalid, tStart: r.tStart };
  const dumps = {}; for (const w of ['O1', 'O2']) dumps[w] = JSON.parse(fs.readFileSync(path.join(d, w + '.json'), 'utf8'));
  const left = (O, who) => { const e = O.log.find((l) => l.type === 'lk_room_event' && l.ev === 'ParticipantDisconnected' && l.identity === who && l.t > t0 + 30000); return e ? e.t : null; };
  const ownLeft = (O) => { const e = O.log.find((l) => l.type === 'driver_state' && l.state === 'left'); return e ? e.t : null; };
  const firstLeave = Math.min(...['O1', 'O2'].flatMap((w) => dumps[w].log.filter((l) => l.type === 'lk_room_event' && l.ev === 'ParticipantDisconnected' && l.t > t0 + 30000 && (l.arg === '1' || l.arg === 1)).map((l) => l.t)).concat([Infinity]));
  for (const [w, other] of [['O1', 'O2'], ['O2', 'O1']]) { const O = dumps[w]; const base = (O.driver.baseline || {})[other] ?? ((O.driver.history.find((h) => h.baseline) || {}).baseline || {})[other];
    const xs = (O.fresh[other] || []).filter((x) => x.tP > t0 - 10000 && x.tP < firstLeave - 500 && x.age < 32000).sort((a, b) => a.tP - b.tP);
    let gap = 0; for (let i = 1; i < xs.length; i++) gap = Math.max(gap, xs[i].tP - xs[i - 1].tP);
    const det = O.log.find((l) => l.type === 'OBSERVER_DETECTION'); const otherLeft = left(O, other);
    row[w] = { n: xs.length, maxAbove: xs.length ? Math.max(...xs.map((x) => x.age - base)) : null, maxGap: gap, over250: xs.filter((x) => x.age - base > 250).length, wrapped: (O.fresh[other] || []).filter((x) => x.tP > t0 - 10000 && x.tP < firstLeave - 500 && x.age >= 32000).length,
      detected: det ? rel(det.t) : null, detectedAfterOtherLeft: det && otherLeft ? (det.t - otherLeft) / 1000 : null, ice: O.log.filter((l) => (l.type === 'pc_ice' || l.type === 'pc_conn') && l.t > t0 - 10000 && l.t < firstLeave).length }; }
  const o1gone = left(dumps.O2, 'O1'), o2gone = ownLeft(dumps.O2); row.teardownO1toO2 = o1gone && o2gone ? (o2gone - o1gone) / 1000 : null;
  rows.push(row); }
rows.sort((a, b) => (a.tStart < b.tStart ? -1 : 1)); const f = (x, d = 0) => (x == null ? '–' : x.toFixed(d));
console.log(`trials in ${dir}/: ${rows.length} (valid ${rows.filter((r) => r.valid).length}, invalid ${rows.filter((r) => !r.valid).length})`);
console.log('seq | cell | valid | O1: max age above baseline ms / max gap ms / samples >250 ms above / ICE or connection state changes | O2: same | O2 rule fired at (s after onset), s after O1 left | teardown: O1 gone to O2 left (s)');
for (const r of rows) console.log([r.seq, r.cell, r.valid ? 'valid' : 'INVALID', ...['O1', 'O2'].map((w) => `${f(r[w].maxAbove)} / ${f(r[w].maxGap)} / ${r[w].over250} / ${r[w].ice}`), r.O2.detected == null ? (r.O1.detected == null ? '–' : `O1 at ${f(r.O1.detected, 1)}`) : `${f(r.O2.detected, 1)}, ${f(r.O2.detectedAfterOtherLeft, 1)}`, f(r.teardownO1toO2, 1)].join(' | '));
const v = rows.filter((r) => r.valid); const st = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return `min ${f(s[0], 1)} median ${f(s[Math.floor(s.length / 2)], 1)} p90 ${f(s[Math.floor(s.length * 0.9)], 1)} max ${f(s[s.length - 1], 1)}`; };
console.log(`\nvalid trials (${v.length}): O2 max age above baseline (ms) ${st(v.map((r) => r.O2.maxAbove))} | O2 max gap (ms) ${st(v.map((r) => r.O2.maxGap))} | O1 max age above baseline ${st(v.map((r) => r.O1.maxAbove))} | O1 max gap ${st(v.map((r) => r.O1.maxGap))}`);
console.log(`valid trials: any observer sample >250 ms above baseline in ${v.filter((r) => r.O1.over250 || r.O2.over250).length}; any observer ICE or connection state change in the window in ${v.filter((r) => r.O1.ice || r.O2.ice).length}; wrapped samples (age over 32 s) in ${v.filter((r) => r.O1.wrapped || r.O2.wrapped).length}`);
console.log("the invalidation rule does not test the teardown time below. It fires when an observer's rule (a remote stream's age over 2 s) has held for 1 s; in the three invalid trials it fired 3.1 to 3.2 s after O1 was gone. Valid trials with a teardown over 2 s were under that, not under 2 s.");
console.log(`teardown O1 gone to O2 left (s): valid ${st(v.map((r) => r.teardownO1toO2))} | invalid ${rows.filter((r) => !r.valid).map((r) => f(r.teardownO1toO2, 1)).join(', ')} | valid trials over 2 s: ${v.filter((r) => r.teardownO1toO2 > 2).map((r) => `${r.seq} (${f(r.teardownO1toO2, 1)})`).join(', ') || 'none'}`);
