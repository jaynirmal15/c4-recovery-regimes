// C4 spike runner (runs inside a pod). ROLE=observer | subject.
// Serves the page + pinned livekit-client, drives headless Chromium, and (subject only)
// isolates this pod at the network layer with iptables (DC-5). Writes /out/result.json.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const { ROLE, SFU_IP, LIVEKIT_API_KEY: K, LIVEKIT_API_SECRET: S } = process.env;
const ROOM = process.env.ROOM || 'c4-spike';
const URL_WS = `ws://${SFU_IP}:31880`;
const POLICY = {
  passiveDelayMs: 24 * 3600 * 1000, // the SDK never retries on its own and never gives up
  signalTimeoutS: 20, // deliberately != server's 15 s, so the log shows which value governs
  obeyServerResume: false,
  obeyServerReconnect: false,
};
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 330000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = [];
const mark = (step, extra = {}) => { const e = { t: Date.now(), step, ...extra }; T.push(e); console.log(JSON.stringify(e)); };

function token(identity) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ iss: K, sub: identity, name: identity, nbf: now - 5, exp: now + 7200, video: { roomJoin: true, room: ROOM, canPublish: true, canSubscribe: true } });
  return `${h}.${p}.${crypto.createHmac('sha256', S).update(`${h}.${p}`).digest('base64url')}`;
}

// iptables in this pod's own network namespace only.
const RULES = {
  all: [['OUTPUT', '-d', SFU_IP, '-j', 'DROP'], ['INPUT', '-s', SFU_IP, '-j', 'DROP']],
  // media only: UDP mux 31882 and ICE-TCP 31881; signalling (TCP 31880) untouched
  media: [
    ['OUTPUT', '-d', SFU_IP, '-p', 'udp', '-j', 'DROP'], ['INPUT', '-s', SFU_IP, '-p', 'udp', '-j', 'DROP'],
    ['OUTPUT', '-d', SFU_IP, '-p', 'tcp', '--dport', '31881', '-j', 'DROP'], ['INPUT', '-s', SFU_IP, '-p', 'tcp', '--sport', '31881', '-j', 'DROP'],
  ],
};
const ipt = (op, rule) => execFileSync('iptables', [op, ...rule]);
function isolate(kind) { for (const r of RULES[kind]) ipt('-I', r); mark('isolate_on', { kind, rules: execFileSync('iptables', ['-S']).toString().split('\n').filter((l) => l.includes('DROP')) }); }
function restore(kind) { for (const r of RULES[kind]) ipt('-D', r); mark('isolate_off', { kind, remaining: execFileSync('iptables', ['-S']).toString().split('\n').filter((l) => l.includes('DROP')) }); }

const server = http.createServer((req, res) => {
  const map = { '/': ['text/html', '<!doctype html><meta charset=utf-8><script src="/driver.js"></script><script src="/lk.js"></script>'],
    '/driver.js': ['text/javascript', fs.readFileSync('/spike/driver.js')],
    '/lk.js': ['text/javascript', fs.readFileSync('/work/node_modules/livekit-client/dist/livekit-client.umd.js')] };
  const m = map[req.url]; if (!m) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': m[0] }); res.end(m[1]);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(JSON.stringify({ t: Date.now(), console: m.type(), text: m.text().slice(0, 300) })); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.SPIKE && window.LivekitClient);
mark('page_ready', { sdk: await page.evaluate(() => window.LivekitClient.version) });

const status = () => page.evaluate(() => window.SPIKE.status());
const act = async (kind) => { const r = await page.evaluate(([k, u, t]) => window.SPIKE.action(k, { url: u, token: t }), [kind, URL_WS, token(ROLE === 'subject' ? 'subj' : 'obs')]); mark(`action_${kind}`, r); return r; };
let result = { role: ROLE, policy: POLICY };
try {
  const j = await page.evaluate((a) => window.SPIKE.join(a), { url: URL_WS, token: token(ROLE === 'subject' ? 'subj' : 'obs'), policy: POLICY, publish: ROLE === 'subject' });
  mark('joined', j);
  if (ROLE === 'observer') {
    await sleep(OBSERVE_MS);
  } else {
    await sleep(8000);
    // T1 (a): 10 s full isolation, then stay passive for 30 s.
    isolate('all'); await sleep(10000); restore('all');
    for (let i = 0; i < 6; i++) { await sleep(5000); mark('T1_passive', await status()); }
    // T1b (b): driver-triggered resume on a healthy session.
    await act('resume'); await sleep(8000); mark('T1b_after', await status());
    // T2 (d): 25 s full isolation (past the server's ~20.8 s removal and our 20 s signal
    //         timeout), then 20 s passive.
    isolate('all'); await sleep(25000); restore('all');
    for (let i = 0; i < 4; i++) { await sleep(5000); mark('T2_passive', await status()); }
    // T2b: driver resume against a session the server has removed; T2c: driver full reconnect.
    await act('resume'); await sleep(6000); mark('T2b_after', await status());
    await act('full'); await sleep(8000); mark('T2c_after', await status());
    // T4 (d): media-only isolation 25 s with signalling up, so the server's LeaveRequest
    //         can actually be delivered; then 15 s passive.
    isolate('media'); await sleep(25000); restore('media');
    for (let i = 0; i < 3; i++) { await sleep(5000); mark('T4_passive', await status()); }
    // T4b: if the server ended the session (DISCONNECT passes through), rejoin fresh.
    const s = await status();
    if (s.engineClosed || s.roomState === 'disconnected') { await act('rejoin'); await sleep(8000); mark('T4b_after', await status()); }
    // T3 (b): driver full reconnect on a healthy session.
    await act('full'); await sleep(8000); mark('T3_after', await status());
    await act('leave'); await sleep(2000);
  }
} catch (e) {
  result.error = String(e && e.stack || e); mark('error', { error: result.error });
  for (const k of ['all', 'media']) { try { for (const r of RULES[k]) ipt('-D', r); } catch {} }
}
result = { ...result, marks: T, ...(await page.evaluate(() => window.SPIKE.dump())) };
fs.writeFileSync('/out/result.json', JSON.stringify(result));
mark('done', { bytes: fs.statSync('/out/result.json').size, violations: result.violations.length });
await browser.close(); server.close();
