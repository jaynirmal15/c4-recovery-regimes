// Manipulation checks for the attempt-timeout intervention, from the committed records (read-only; nothing is run).
// usage, from the repository root: node client/runner/timeout-checks.cjs > logs/study/timeout-checks.txt
// Input: logs/study/removal-race/livekit.json, the per-trial rows written by removal-race.mjs, which enumerates
// study/ and study-r2/ from the filesystem. Retained LiveKit trials under full isolation only. Times are seconds
// after isolation onset. The kernel unit is the value fitted earlier from the 22 survivors and is not refitted here.
const fs = require('fs');
const UNIT = 1.033, SCHEDULE = [0, 1, 2, 3, 4, 5, 7, 11, 19], EARLY = 6.5; // a first action before EARLY s is a decoder-defect trial
const all = JSON.parse(fs.readFileSync('logs/study/removal-race/livekit.json', 'utf8')).filter((r) => r.cohort === 'retained' && r.mode === 'all');
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const dist = (v, d = 2) => v.length ? `n ${v.length} | min ${Math.min(...v).toFixed(d)} | p10 ${q(v, 0.1).toFixed(d)} | median ${q(v, 0.5).toFixed(d)} | p90 ${q(v, 0.9).toFixed(d)} | max ${Math.max(...v).toFixed(d)}` : 'n 0';
const act = (r, i) => r.log.client && r.log.client.actions[i], att = (r, i) => r.log.client && r.log.client.attempts[i];
console.log(`LiveKit, full isolation, retained: ${all.length} trials in conditions ${[...new Set(all.map((r) => r.D))].sort((a, b) => a - b).join(', ')} s`);

// ---- 1. when the first attempt begins and when its connection is opened
const withAct = all.filter((r) => act(r, 0) && att(r, 0));
console.log(`rows without a client record of a first action and connection (left out of 1, 2, 4, 5): ${all.length - withAct.length}${all.length - withAct.length ? ' (' + all.filter((r) => !(act(r, 0) && att(r, 0))).map((r) => r.id + (r.log.flags.length ? ' [' + r.log.flags.join(',') + ']' : '')).join('; ') + ')' : ''}`);
const defect = withAct.filter((r) => act(r, 0).t < EARLY), normal = withAct.filter((r) => act(r, 0).t >= EARLY);
const blocked = normal.filter((r) => r.restore > att(r, 0).t), open = normal.filter((r) => r.restore <= att(r, 0).t);
console.log(`\n1. First attempt. ${withAct.length} trials have a first action and a first connection; ${defect.length} began before ${EARLY} s (decoder defect) and are listed apart:`);
for (const r of defect) console.log(`   ${r.id}: attempt begins ${act(r, 0).t.toFixed(2)}, connection opened ${att(r, 0).t.toFixed(2)}`);
console.log(`   attempt begins (driver calls the SDK; the SDK starts its timer here), ${normal.length} trials: ${dist(normal.map((r) => act(r, 0).t))}`);
console.log(`   connection opened, path still blocked (D >= 10 s): ${dist(blocked.map((r) => att(r, 0).t))}`);
console.log(`   connection opened, path already restored (D = 2, 5 s): ${dist(open.map((r) => att(r, 0).t))}`);
console.log(`   opened minus begins, path blocked: ${dist(blocked.map((r) => att(r, 0).t - act(r, 0).t), 3)}`);
console.log(`   opened minus begins, path restored: ${dist(open.map((r) => att(r, 0).t - act(r, 0).t), 3)}`);
console.log(`   per condition, path blocked: ${[...new Set(blocked.map((r) => r.D))].sort((a, b) => a - b).map((D) => { const g = blocked.filter((r) => r.D === D).map((r) => att(r, 0).t); return `${D} s: ${Math.min(...g).toFixed(2)}–${Math.max(...g).toFixed(2)} (${g.length})`; }).join(' | ')}`);
console.log(`   restore (runner confirmed the rules removed) minus nominal D, all ${all.length}: ${dist(all.map((r) => r.restore - r.D), 3)}`);

// ---- 2. does a timer govern the attempt's lifetime, and which one
const failed = withAct.filter((r) => act(r, 0).kind === 'transport_restart' && act(r, 0).ok === false && !act(r, 0).refused);
console.log(`\n2. Lifetime of a first attempt that was not answered: ${failed.length} trials. end minus begin: ${dist(failed.map((r) => act(r, 0).end - act(r, 0).t), 3)}`);
console.log(`   end minus connection opened: ${dist(failed.map((r) => act(r, 0).end - att(r, 0).t), 3)}`);
console.log('   (the source of the 15 s is in logs/study/TIMEOUT-MANIPULATION-CHECKS.md; it is not the driver parameter signalTimeoutMs)');

// ---- 3. the server's ICE failure, which the removal follows by 5 s
const ice = all.filter((r) => !r.log.flags.length && r.log.iceFailed && r.log.iceFailed.length);
const noIce = all.filter((r) => !r.log.flags.length && !(r.log.iceFailed && r.log.iceFailed.length));
const f = ice.map((r) => r.log.iceFailed[0]);
console.log(`\n3. Server reports ICE failure for S: ${ice.length} trials with a usable log (conditions ${[...new Set(ice.map((r) => r.D))].sort((a, b) => a - b).join(', ')} s): ${dist(f)}`);
console.log(`   no ICE failure reported, usable log: ${noIce.length} trials (conditions ${[...new Set(noIce.map((r) => r.D))].sort((a, b) => a - b).join(', ')} s)`);
console.log(`   failure minus restore, by condition: ${[...new Set(ice.map((r) => r.D))].sort((a, b) => a - b).map((D) => { const g = ice.filter((r) => r.D === D).map((r) => r.log.iceFailed[0] - r.restore); return `${D} s: ${Math.min(...g).toFixed(2)}–${Math.max(...g).toFixed(2)}`; }).join(' | ')}`);
console.log(`   in every one of these trials the failure preceded the restore: ${ice.every((r) => r.log.iceFailed[0] < r.restore)}`);
for (const D of [15, 16, 17]) console.log(`   failure times later than a restore at ${D} s + 0.08: ${f.filter((t) => t > D + 0.08).length} of ${f.length}`);
const rem = all.filter((r) => r.log.removal && !r.log.flags.length);
console.log(`   removal minus ICE failure: ${dist(rem.map((r) => r.log.removal.t - r.log.iceFailed[0]), 3)}`);

// ---- 4. where the frozen schedule puts the last usable request, per arm, from each trial's own times
console.log(`\n4. Last request the kernel sends inside the attempt, unit frozen at ${UNIT} s, from each of the ${blocked.length} blocked-path trials' own begin and open times:`);
for (const T of [10, 15, 25]) {
  const rows = blocked.map((r) => { const o = att(r, 0).t, fire = act(r, 0).t + T; const k = SCHEDULE.filter((p) => o + p * UNIT < fire).pop(); const nx = SCHEDULE.find((p) => p > k); return { k, last: o + k * UNIT, slack: fire - (o + k * UNIT), next: nx == null ? null : o + nx * UNIT, fire }; });
  const ks = [...new Set(rows.map((x) => x.k))];
  console.log(`   timeout ${T} s: last point ${ks.join(' or ')} units | it leaves at ${dist(rows.map((x) => x.last))} | timer fires ${dist(rows.map((x) => x.slack))} s later | durations whose restore (D + 0.08) falls inside the spread of that instant: ${[...Array(40).keys()].filter((D) => D + 0.08 > Math.min(...rows.map((x) => x.last)) && D + 0.08 < Math.max(...rows.map((x) => x.last))).join(', ') || 'none'}`);
}

// ---- 5. could a second attempt arrive before the removal if the timeout were 10 s
const rb = all.filter((r) => r.regime === 'R2' && !r.log.flags.length && r.log.removal && act(r, 1) && att(r, 1));
const second = rb.map((r) => { const shift = (act(r, 0).end - act(r, 0).t) - 10; return { id: r.id, early: act(r, 0).t < EARLY, margin: (att(r, 1).t - shift) - r.log.removal.t }; });
console.log(`\n5. Rebuilds with a usable log and a second attempt: ${rb.length}. With the first attempt ending at 10 s instead of ${dist(rb.map((r) => act(r, 0).end - act(r, 0).t), 2).split('| median ')[1].split(' ')[0]} s and nothing else changed,`);
console.log(`   second connection opened minus removal, normal detection: ${dist(second.filter((x) => !x.early).map((x) => x.margin))}`);
console.log(`   decoder-defect trials: ${second.filter((x) => x.early).map((x) => `${x.id} ${x.margin.toFixed(2)}`).join('; ') || 'none'}`);
console.log(`   second connection would open before the removal in ${second.filter((x) => x.margin < 0).length} of ${second.length} (${second.filter((x) => x.margin < 0 && !x.early).length} with normal detection)`);
console.log(`   gap between the first attempt ending and the second beginning: ${dist(rb.map((r) => act(r, 1).t - act(r, 0).end), 3)}`);
