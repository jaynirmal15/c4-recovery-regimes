// Decode spike results: raw signalling frames (via @livekit/protocol 1.50.4, the SDK's own
// version) merged with driver log and isolation marks; then evaluate criteria (a)-(d).
// usage (after `npm ci` at the repo root): node decode.mjs spike/out
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('@livekit/protocol');
const dir = process.argv[2] || 'out';
const ACTION = ['DISCONNECT', 'RESUME', 'RECONNECT'];
const STATE = ['JOINING', 'JOINED', 'ACTIVE', 'DISCONNECTED'];
const DR = (n) => P.DisconnectReason[n] ?? n;
const QUIET = new Set(['pongResp', 'pingReq', 'trickle', 'connectionQuality', 'speakersChanged', 'subscribedQualityUpdate', 'streamStateUpdate', 'roomUpdate']);

function decode(r) {
  const rows = [];
  const counts = {};
  for (const f of r.frames) {
    if (f.dir === 'open') { rows.push({ t: f.t, src: 'ws', s: `WS#${f.ws} OPEN ${f.url.replace(/^ws:\/\/[^/]+/, '')}` }); continue; }
    if (f.dir === 'close') { rows.push({ t: f.t, src: 'ws', s: `WS#${f.ws} CLOSE code=${f.code}` }); continue; }
    if (f.dir !== 'in' && f.dir !== 'out') continue;
    const buf = Buffer.from(f.b64, 'base64');
    let m;
    try { m = (f.dir === 'in' ? P.SignalResponse : P.SignalRequest).fromBinary(buf).message; } catch (e) { rows.push({ t: f.t, src: f.dir, s: `undecodable ${e.message}` }); continue; }
    const k = m.case; counts[`${f.dir}:${k}`] = (counts[`${f.dir}:${k}`] || 0) + 1;
    if (QUIET.has(k)) continue;
    const v = m.value;
    let s = `${f.dir === 'in' ? '<<' : '>>'} WS#${f.ws} ${k}`;
    if (k === 'join') s += ` sid=${v.participant?.sid} identity=${v.participant?.identity} others=[${(v.otherParticipants || []).map((p) => `${p.identity}/${p.sid}`)}] pingTimeout=${v.pingTimeout}`;
    if (k === 'reconnect') s += ` (ReconnectResponse) lastMessageSeq=${v.lastMessageSeq}`;
    if (k === 'leave') s += ` action=${ACTION[v.action] ?? v.action} reason=${DR(v.reason)} canReconnect=${v.canReconnect}`;
    if (k === 'update') s += ' ' + (v.participants || []).map((p) => `${p.identity}/${p.sid}:${STATE[p.state] ?? p.state}${p.disconnectReason ? '(' + DR(p.disconnectReason) + ')' : ''}`).join(' ');
    if (k === 'syncState') s += ' (SyncState)';
    rows.push({ t: f.t, src: f.dir, s, k, v });
  }
  return { rows, counts };
}

for (const role of ['observer', 'subject']) {
  const f = path.join(dir, `${role}.json`);
  if (!fs.existsSync(f)) { console.log(`(no ${f})`); continue; }
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const { rows, counts } = decode(r);
  const t0 = Math.min(...r.marks.map((m) => m.t));
  const rel = (t) => ((t - t0) / 1000).toFixed(2).padStart(8);
  const lines = [...rows,
    ...r.log.filter((l) => !['room_event'].includes(l.type) || ['Reconnecting', 'SignalReconnecting', 'Reconnected', 'Disconnected', 'ParticipantConnected', 'ParticipantDisconnected'].includes(l.ev))
      .map((l) => ({ t: l.t, src: 'drv', s: `${l.type} ${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['t', 'type', 'before', 'after'].includes(k))))}${l.after ? ' after.sid=' + l.after.sid + ' closed=' + l.after.engineClosed : ''}` })),
    ...r.marks.map((m) => ({ t: m.t, src: 'MARK', s: `${m.step}${m.kind ? ' ' + m.kind : ''}${m.sid !== undefined ? ' sid=' + m.sid + ' state=' + m.roomState + ' closed=' + m.engineClosed + ' signal=' + m.signalState : ''}` }))]
    .sort((a, b) => a.t - b.t);
  console.log(`\n==================== ${role.toUpperCase()}  (policy ${JSON.stringify(r.policy)})`);
  for (const l of lines) console.log(`${rel(l.t)} ${l.src.padEnd(4)} ${l.s}`.slice(0, 260));
  console.log(`message counts: ${JSON.stringify(counts)}`);
  console.log(`VIOLATIONS (reconnect/close not made by the driver): ${r.violations.length}`);
  for (const v of r.violations) console.log('   ', JSON.stringify(v));
  if (r.error) console.log('ERROR', r.error);
}
