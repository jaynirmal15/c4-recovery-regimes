// Gate between the control arm's shakedown sessions and the 40 (control.sh). Read-only.
// usage: node control-gate.mjs <stack>     exit 0 = proceed; 6 = invalid/missing session or RTP stopped during the mute;
//                                          7 = LiveKit h2 showed no renegotiation of the existing subscriber connections
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const dir = path.join(ROOT, 'control-shakedown'); const stack = process.argv[2];
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(dir, d, f), 'utf8'));
const last = {};
for (const d of fs.readdirSync(dir).filter((x) => fs.existsSync(path.join(dir, x, 'result.json'))).sort()) { const r = rd(d, 'result.json'); if (r.stack === stack && (!last[r.test] || r.tStart > last[r.test].r.tStart)) last[r.test] = { d, r }; }
const bad = ['h0', 'h1', 'h2', 'h3'].filter((t) => !last[t] || !last[t].r.valid);
const out = { stack, sessions: Object.fromEntries(Object.entries(last).map(([t, x]) => [t, { id: x.r.id, valid: x.r.valid, invalid: x.r.invalid, condition: x.r.control.condition }])), invalidOrMissing: bad, mute: last.h3 && last.h3.r.control.mute };
let code = bad.length || !out.mute || out.mute.packetsContinued !== true ? 6 : 0;
if (stack === 'livekit') {
  // Renegotiations after arming, per participant; in h2 also timed against the bystander's own join. With this server and
  // SDK the server sends mediaSectionsRequirement and the CLIENT sends the offer, so a renegotiation is counted as an
  // offer sent by the client that the server answered (found in the first shakedown, 2026-10-07).
  const offers = (d, who) => { const dump = rd(d, `${who}.json`); const armed = (dump.log.find((l) => l.type === 'driver_state' && l.state === 'healthy') || {}).t ?? 0;
    const left = (dump.log.find((l) => l.type === 'driver_state' && l.state === 'left') || {}).t ?? Infinity;
    const msgs = dump.frames.filter((f) => f.b64 && f.t > armed && f.t < left - 300).map((f) => { try { return { t: f.t, k: `${f.dir}:${(f.dir === 'in' ? P.SignalResponse : P.SignalRequest).fromBinary(Buffer.from(f.b64, 'base64')).message.case}` }; } catch { return null; } }).filter(Boolean);
    return msgs.filter((m) => m.k === 'out:offer' && msgs.some((a) => a.k === 'in:answer' && a.t >= m.t && a.t - m.t < 2000)).map((m) => m.t); };
  out.renegotiationsAfterArming = {};
  for (const t of Object.keys(last)) out.renegotiationsAfterArming[t] = Object.fromEntries(['S', 'O1', 'O2'].map((who) => { try { return [who, offers(last[t].d, who).length]; } catch (e) { return [who, `error: ${e.message.slice(0, 80)}`]; } }));
  if (last.h2) try {
    const B = rd(last.h2.d, 'B.json'); const tJoin = (B.log.find((l) => l.type === 'lk_joined') || {}).t; const tLeft = (B.log.filter((l) => l.type === 'driver_state' && l.state === 'left').pop() || {}).t;
    const rel = Object.fromEntries(['S', 'O1', 'O2'].map((who) => [who, offers(last.h2.d, who).map((t) => ({ afterJoinS: +((t - tJoin) / 1000).toFixed(2), afterLeaveS: tLeft ? +((t - tLeft) / 1000).toFixed(2) : null }))]));
    const atJoin = Object.fromEntries(Object.entries(rel).map(([who, xs]) => [who, xs.filter((x) => x.afterJoinS > -5 && x.afterJoinS < 10).length]));
    out.h2Renegotiation = { answeredClientOffers: rel, within5sBefore10sAfterBystanderJoin: atJoin, confirmedOnAllThree: Object.values(atJoin).every((n) => n >= 1) };
    if (!out.h2Renegotiation.confirmedOnAllThree && code === 0) code = 7;
  } catch (e) { out.h2Renegotiation = { error: e.message.slice(0, 200) }; if (code === 0) code = 7; }
}
console.log('SHAKEDOWN ' + JSON.stringify(out));
process.exit(code);
