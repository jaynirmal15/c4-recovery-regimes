// C4 event sink. Stores every POST itself (memory + append-only file); nothing is left to
// container logs (log rotation lost events in the 2026-10-01 shakedown).
// Gap detection is by construction: a per-process bootId and a contiguous sequence number.
//   POST <any path>          -> store {seq, t, path, body}; 200
//   GET  /head               -> {bootId, startedAt, seq}
//   GET  /range?from=N&to=M  -> {bootId, events:[...]}  (seq in (N, M])
//   GET  /time               -> {t}   (epoch ms, this process's clock; for the offset probe)
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
const now = () => performance.timeOrigin + performance.now();
const bootId = crypto.randomUUID(), startedAt = now();
const MAX = 400000; let seq = 0; const ev = []; let base = 0; // ev[i] has seq base+i+1
fs.mkdirSync('/data', { recursive: true }); const file = fs.createWriteStream('/data/events.jsonl', { flags: 'a' });
http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'); const send = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.method === 'GET') {
    if (u.pathname === '/time') return send({ t: now() });
    if (u.pathname === '/head') return send({ bootId, startedAt, seq, oldest: base + 1 });
    if (u.pathname === '/range') { const from = Number(u.searchParams.get('from') || 0), to = Number(u.searchParams.get('to') || seq); return send({ bootId, seq, oldest: base + 1, events: ev.slice(Math.max(0, from - base), Math.max(0, to - base)) }); }
    return send({ ok: true });
  }
  const t = now(); let body = ''; for await (const c of q) body += c;
  let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
  const e = { seq: ++seq, t, path: u.pathname, body: parsed };
  ev.push(e); if (ev.length > MAX) { ev.shift(); base++; }
  file.write(JSON.stringify(e) + '\n');
  send({ ok: true, seq: e.seq });
}).listen(8080, () => console.log(JSON.stringify({ ready: true, bootId, startedAt })));
