// Polls LiveKit RoomService.ListParticipants every POLL_MS and logs changes (server-side view; not a participant).
import crypto from 'node:crypto';
const { LIVEKIT_URL, LIVEKIT_API_KEY: K, LIVEKIT_API_SECRET: S } = process.env;
const ROOM = process.env.ROOM || 'c4-probe', POLL_MS = Number(process.env.POLL_MS || 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ iss: K, nbf: now - 5, exp: now + 600, sub: 'c4-state-poller', video: { roomAdmin: true, room: ROOM, roomList: true } });
  return `${h}.${p}.${crypto.createHmac('sha256', S).update(`${h}.${p}`).digest('base64url')}`;
}
let prev = '';
for (;;) {
  const t = new Date().toISOString();
  try {
    const r = await fetch(`${LIVEKIT_URL}/twirp/livekit.RoomService/ListParticipants`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` }, body: JSON.stringify({ room: ROOM }) });
    const j = await r.json();
    const view = (j.participants || []).map((p) => ({ identity: p.identity, sid: p.sid, state: p.state || 'JOINING', joinedAt: p.joinedAtMs || p.joinedAt, disconnectReason: p.disconnectReason, isPublisher: p.isPublisher, tracks: (p.tracks || []).length, kind: p.kind }));
    const key = JSON.stringify(view);
    if (key !== prev) { console.log(JSON.stringify({ t, http: r.status, participants: view, raw: j.participants })); prev = key; }
  } catch (e) { console.log(JSON.stringify({ t, err: String(e) })); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
