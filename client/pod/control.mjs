// C4 client pod control server. One per participant pod. Listens on 127.0.0.1:9000 only;
// the runner reaches it with `kubectl exec ... curl`. Secrets stay in the pod.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const { LIVEKIT_API_KEY: K, LIVEKIT_API_SECRET: S, POD_ROLE } = process.env;
const WWW = '/c4/www';
const now = () => performance.timeOrigin + performance.now();
const files = {
  '/': ['text/html', '<!doctype html><meta charset=utf-8><body><script src="/common.js"></script><script src="/lkproto.js"></script><script src="/lk-sdk.js"></script><script src="/lk.js"></script><script src="/janus.js"></script><script src="/driver.js"></script></body>'],
  '/lk-sdk.js': ['text/javascript', () => fs.readFileSync('/work/node_modules/livekit-client/dist/livekit-client.umd.js')],
};
for (const f of ['common.js', 'lkproto.js', 'lk.js', 'janus.js', 'driver.js']) files[`/${f}`] = ['text/javascript', () => fs.readFileSync(`${WWW}/${f}`)];
const web = http.createServer((q, r) => { const m = files[q.url]; if (!m) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': m[0], 'cache-control': 'no-store' }); r.end(typeof m[1] === 'function' ? m[1]() : m[1]); });
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${web.address().port}/`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const ctxs = new Map(); // name -> {context, page, console:[]}

function token(identity, room) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ iss: K, sub: identity, name: identity, nbf: t - 5, exp: t + 7200, video: { roomJoin: true, room, canPublish: true, canSubscribe: true } });
  return `${h}.${p}.${crypto.createHmac('sha256', S).update(`${h}.${p}`).digest('base64url')}`;
}
function adminToken(room) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ iss: K, sub: 'c4-admin', nbf: t - 5, exp: t + 600, video: { roomAdmin: true, room, roomList: true } });
  return `${h}.${p}.${crypto.createHmac('sha256', S).update(`${h}.${p}`).digest('base64url')}`;
}
async function twirp(httpUrl, method, body, room) {
  const r = await fetch(`${httpUrl}/twirp/livekit.RoomService/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken(room)}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function janusAdmin(httpUrl, body) {
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, transaction: crypto.randomUUID() }) }).then((x) => x.json());
  const s = (await post(httpUrl, { janus: 'create' })).data.id;
  try {
    const h = (await post(`${httpUrl}/${s}`, { janus: 'attach', plugin: 'janus.plugin.videoroom' })).data.id;
    const r = await post(`${httpUrl}/${s}/${h}`, { janus: 'message', body });
    return r.plugindata ? r.plugindata.data : r;
  } finally { await post(`${httpUrl}/${s}`, { janus: 'destroy' }).catch(() => {}); }
}

// ---- isolation (DC-5): iptables in THIS pod's network namespace -------------
function rules(mode, stack, ip) {
  if (mode === 'all') return [['OUTPUT', '-d', ip, '-j', 'DROP'], ['INPUT', '-s', ip, '-j', 'DROP']];
  const r = [['OUTPUT', '-d', ip, '-p', 'udp', '-j', 'DROP'], ['INPUT', '-s', ip, '-p', 'udp', '-j', 'DROP']];
  if (stack === 'livekit') r.push(['OUTPUT', '-d', ip, '-p', 'tcp', '--dport', '31881', '-j', 'DROP'], ['INPUT', '-s', ip, '-p', 'tcp', '--sport', '31881', '-j', 'DROP']);
  return r; // Janus: ice_tcp is off, media is UDP only
}
const dropRules = () => execFileSync('iptables', ['-S']).toString().split('\n').filter((l) => l.includes('DROP'));

// ---- block-first abandonment: blackhole the old PCs' local UDP ports (spec §1.2) ----
const blockedPorts = new Set();
let isoState = null;
function portRules(port) { return [['OUTPUT', '-p', 'udp', '--sport', String(port), '-j', 'DROP'], ['INPUT', '-p', 'udp', '--dport', String(port), '-j', 'DROP']]; }
function blockPorts(ports, on) {
  const before = now(); let n = 0;
  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1024 || p > 65535) continue;
    if (on === blockedPorts.has(p)) continue;
    for (const r of portRules(p)) { execFileSync('iptables', [on ? '-I' : '-D', ...r]); n++; }
    if (on) blockedPorts.add(p); else blockedPorts.delete(p);
  }
  return { ok: true, before, after: now(), rules: n, ports };
}

// ---- participant-state API poller (spec §5.6 layer A_state), 1 s, from an OBSERVER pod ----
let poll = null;
async function pollOnce() {
  const P = poll; if (!P || P.busy) return; P.busy = true; const t1 = now();
  try {
    let parts;
    if (P.stack === 'livekit') {
      const r = await twirp(P.httpUrl, 'ListParticipants', { room: P.room }, P.room);
      if (r.status !== 200) throw new Error(`http ${r.status}`);
      parts = ((r.body && r.body.participants) || []).map((x) => ({ identity: x.identity, sid: x.sid, state: x.state, tracks: (x.tracks || []).length, muted: (x.tracks || []).some((t) => t.muted) }));
    } else {
      const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, transaction: crypto.randomUUID() }) }).then((x) => x.json());
      if (!P.sess) { P.sess = (await post(P.httpUrl, { janus: 'create' })).data.id; P.handle = (await post(`${P.httpUrl}/${P.sess}`, { janus: 'attach', plugin: 'janus.plugin.videoroom' })).data.id; }
      const r = await post(`${P.httpUrl}/${P.sess}/${P.handle}`, { janus: 'message', body: { request: 'listparticipants', room: P.room } });
      const d = r.plugindata && r.plugindata.data; if (!d || !Array.isArray(d.participants)) { P.sess = null; throw new Error(`bad reply ${JSON.stringify(r).slice(0, 120)}`); }
      parts = d.participants.map((x) => ({ id: x.id, display: x.display, publisher: x.publisher, talking: x.talking }));
    }
    P.samples.push({ t1, t2: now(), parts });
  } catch (e) { P.samples.push({ t1, t2: now(), error: String(e.message || e).slice(0, 160) }); }
  P.busy = false;
}

const routes = {
  'POST /poll-start': async ({ stack, httpUrl, room }) => { if (poll) clearInterval(poll.timer); poll = { stack, httpUrl, room, samples: [], busy: false }; poll.timer = setInterval(pollOnce, 1000); pollOnce(); return { ok: true }; },
  'POST /poll-stop': async () => { if (!poll) return { samples: [] }; clearInterval(poll.timer); const P = poll; poll = null;
    if (P.sess) fetch(`${P.httpUrl}/${P.sess}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ janus: 'destroy', transaction: 'x' }) }).catch(() => {});
    return { samples: P.samples }; },
  'GET /health': async () => ({ ok: true, role: POD_ROLE, ctxs: [...ctxs.keys()], playwright: JSON.parse(fs.readFileSync('/work/node_modules/playwright/package.json')).version, lkClient: JSON.parse(fs.readFileSync('/work/node_modules/livekit-client/package.json')).version, t: now() }),
  'POST /open': async ({ ctx }) => {
    if (ctxs.has(ctx)) { try { await ctxs.get(ctx).context.close(); } catch {} ctxs.delete(ctx); }
    const context = await browser.newContext(); const page = await context.newPage(); const con = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) con.push({ t: now(), type: m.type(), text: m.text().slice(0, 400) }); });
    page.on('pageerror', (e) => con.push({ t: now(), type: 'pageerror', text: String(e).slice(0, 400) }));
    await page.goto(PAGE_URL); await page.waitForFunction(() => window.C4 && window.C4X && window.LKProto && window.LivekitClient);
    if (POD_ROLE === 'S') { // only the subject pod has NET_ADMIN
      await page.exposeFunction('c4BlockPorts', (ports) => blockPorts(ports, true));
      await page.exposeFunction('c4UnblockPorts', (ports) => blockPorts(ports, false));
    }
    ctxs.set(ctx, { context, page, console: con });
    return { ok: true, sdk: await page.evaluate(() => window.LivekitClient.version) };
  },
  'POST /join': async ({ ctx, cfg }) => {
    if (cfg.stack === 'livekit') cfg.lk = { url: cfg.lk.url, token: token(cfg.identity, cfg.room) };
    return ctxs.get(ctx).page.evaluate((c) => window.C4.join(c), cfg);
  },
  'POST /eval': async ({ ctx, fn, args = [] }) => ctxs.get(ctx).page.evaluate(([f, a]) => window.C4[f](...a), [fn, args]),
  'POST /dump': async ({ ctx }) => { const c = ctxs.get(ctx); const d = await c.page.evaluate(() => window.C4.dump()); return { ...d, console: c.console }; },
  'POST /close': async ({ ctx }) => { const c = ctxs.get(ctx); if (c) { await c.context.close(); ctxs.delete(ctx); } return { ok: true }; },
  // Timed isolation: the POD applies the rules, holds for durMs on its own timer, and restores.
  // (Timing the restore from the Mac through kubectl exec overshot by 1.3-1.6 s.)
  'POST /isolate': async ({ mode, durMs, stack, ip }) => {
    const rs = rules(mode, stack, ip);
    const before = now(); for (const r of rs) execFileSync('iptables', ['-I', ...r]); const after = now();
    isoState = { mode, durMs, onset: { before, after }, rulesDuring: dropRules(), restore: null };
    setTimeout(() => {
      const b = now(); for (const r of rs) { try { execFileSync('iptables', ['-D', ...r]); } catch (e) { isoState.error = String(e); } }
      isoState.restore = { before: b, after: now() }; isoState.rulesAfter = dropRules();
      isoState.actualS = (isoState.restore.before - isoState.onset.after) / 1000;
    }, durMs);
    return isoState;
  },
  'GET /isolate-result': async () => isoState || {},
  // generic in-cluster HTTP call, timed on THIS pod's clock (sink head/range/markers)
  'POST /fetch': async ({ url, method = 'GET', body }) => {
    const t1 = now(); const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); const t2 = now(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, t1, t2, json };
  },
  // NTP-style clock offset to a remote /time endpoint: offset = remote - local midpoint, best of n by RTT
  'POST /probe-clock': async ({ url, n = 9 }) => {
    const xs = [];
    for (let i = 0; i < n; i++) { const t1 = now(); const j = await (await fetch(url)).json(); const t2 = now(); xs.push({ rttMs: t2 - t1, offsetMs: j.t - (t1 + t2) / 2 }); }
    const best = xs.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
    return { offsetMs: best.offsetMs, uncMs: best.rttMs / 2, n, spreadMs: Math.max(...xs.map((x) => x.offsetMs)) - Math.min(...xs.map((x) => x.offsetMs)) };
  },
  'GET /iptables': async () => ({ rules: dropRules() }),
  'POST /unblock-all': async () => blockPorts([...blockedPorts], false),
  'POST /admin/lk': async ({ httpUrl, method, body, room }) => twirp(httpUrl, method, body, room),
  'POST /admin/janus': async ({ httpUrl, body }) => janusAdmin(httpUrl, body),
};

http.createServer(async (q, r) => {
  let body = ''; for await (const c of q) body += c;
  const h = routes[`${q.method} ${q.url}`];
  const send = (code, obj) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(obj)); };
  if (!h) return send(404, { error: 'no route' });
  try { send(200, await h(body ? JSON.parse(body) : {})); } catch (e) { send(500, { error: String(e && e.stack || e).slice(0, 2000) }); }
}).listen(9000, '127.0.0.1', () => console.log(JSON.stringify({ t: now(), ready: true, role: POD_ROLE })));
