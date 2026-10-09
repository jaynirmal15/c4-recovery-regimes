// What the LiveKit server told the subject itself (read-only).
// usage, from the repository root, after `npm ci`: node client/runner/subject-frames.mjs
// Trial set: every LiveKit row of the dataset index logs/study/divergence-final.json (the retained 150), each
// resolved to its directory under study/ or study-r2/. Nothing is listed by name.
// For each trial it decodes the signalling frames the subject received after isolation onset (S.json, "frames",
// direction "in") and lists every `leave` (with its reason and action) and every `reconnect` (the reply to a
// resume). A frame is identified by its zero-based index in that trial's S.json "frames" array; the records carry
// no other sequence number.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const R = JSON.parse(fs.readFileSync('logs/study/divergence-final.json', 'utf8')).filter((r) => r.stack === 'livekit');
const rows = []; const tally = {};
for (const row of R) {
  const dir = ['study', 'study-r2'].map((s) => `${s}/${row.dir}`).find((x) => fs.existsSync(`${x}/S.json`));
  const S = JSON.parse(fs.readFileSync(`${dir}/S.json`, 'utf8')); const t0 = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8')).iso.onset.after;
  const hits = [];
  S.frames.forEach((f, i) => { if (f.dir !== 'in' || !f.b64 || f.t < t0) return; let m; try { m = P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message; } catch { return; }
    if (m.case === 'leave') hits.push({ frame: i, t: +((f.t - t0) / 1000).toFixed(2), kind: 'leave', reason: P.DisconnectReason[m.value.reason], action: P.LeaveRequest_Action[m.value.action] });
    if (m.case === 'reconnect') hits.push({ frame: i, t: +((f.t - t0) / 1000).toFixed(2), kind: 'reconnect' }); });
  rows.push({ trial: dir, regime: row.regime, mode: row.mode, D: row.D, hits });
  for (const h of hits) { const k = h.kind === 'leave' ? `leave ${h.reason}/${h.action}` : 'reconnect'; tally[k] = (tally[k] || 0) + 1; }
}
fs.mkdirSync('logs/study/subject-frames', { recursive: true }); fs.writeFileSync('logs/study/subject-frames/frames.json', JSON.stringify(rows, null, 1));
const withK = (f) => rows.filter((r) => r.hits.some(f)).length;
console.log(`LiveKit retained trials: ${rows.length}`);
console.log(`with a reconnect response to S (reply to a resume): ${withK((h) => h.kind === 'reconnect')}`);
console.log(`with a leave message to S carrying a reason: ${withK((h) => h.kind === 'leave')}`);
console.log(`with neither: ${rows.filter((r) => !r.hits.length).length}`);
console.log('frames by kind:', JSON.stringify(tally));
console.log('by outcome: survived', rows.filter((r) => r.regime !== 'R2').length, 'of which with a reconnect response', rows.filter((r) => r.regime !== 'R2' && r.hits.some((h) => h.kind === 'reconnect')).length, '| rebuilt', rows.filter((r) => r.regime === 'R2').length, 'of which with a leave', rows.filter((r) => r.regime === 'R2' && r.hits.some((h) => h.kind === 'leave')).length);
for (const ex of ['study-r2/livekit-iso-media-23s-O-20261002T161609-20', 'study/livekit-iso-all-23s-O-20261002T061000-19']) { const r = rows.find((x) => x.trial === ex); if (r) console.log('example', ex, JSON.stringify(r.hits)); }
