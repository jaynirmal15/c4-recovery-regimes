// Janus VideoRoom lifecycle probe: signalling only, no media, no browser.
// Records every message sent/received with an epoch timestamp, one JSON line each.
// Scenarios:
//   J1 clean leave          join -> leave -> detach -> destroy
//   J2 transport closed     join -> WebSocket closed without leave/destroy
//   J3 silent session       join -> no keepalives, WS left open, past session_timeout;
//                           a second connection re-joins with the same feed id before
//                           and after the timeout
//   J4 claim                join -> WS closed -> new WS -> "claim" the old session
// An observer (its own session, signalling-only publisher "observer") sits in the room
// throughout and keeps its session alive.
const URL = process.env.JANUS_WS || 'ws://janus.c4-janus.svc.cluster.local:31188';
const ROOM = Number(process.env.ROOM || 1234);
const ONLY = (process.env.SCENARIOS || 'J1,J2,J3,J4').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
let txn = 0;

class Conn {
  constructor(who) { this.who = who; this.pending = new Map(); this.session = null; this.handle = null; this.ka = null; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL, 'janus-protocol');
      this.ws.onopen = () => { log({ who: this.who, dir: 'ws', ev: 'open' }); res(); };
      this.ws.onerror = (e) => { log({ who: this.who, dir: 'ws', ev: 'error', err: String(e.message || e.type) }); rej(e); };
      this.ws.onclose = (e) => log({ who: this.who, dir: 'ws', ev: 'close', code: e.code, reason: e.reason });
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        log({ who: this.who, dir: 'recv', msg });
        const p = msg.transaction && this.pending.get(msg.transaction);
        if (!p) return;
        if (msg.janus === 'ack' && p.async) return; // wait for the plugin event
        this.pending.delete(msg.transaction); p.res(msg);
      };
    });
  }
  send(body, { async = false, timeoutMs = 10000 } = {}) {
    const transaction = `${this.who}-${++txn}`;
    const msg = { ...body, transaction };
    if (this.session && msg.session_id === undefined && body.janus !== 'create' && body.janus !== 'claim') msg.session_id = this.session;
    log({ who: this.who, dir: 'send', msg });
    this.ws.send(JSON.stringify(msg));
    return new Promise((res) => {
      this.pending.set(transaction, { res, async });
      setTimeout(() => { if (this.pending.delete(transaction)) res({ janus: 'probe_timeout', transaction }); }, timeoutMs);
    });
  }
  async create() { const r = await this.send({ janus: 'create' }); this.session = r.data && r.data.id; return r; }
  async attach() { const r = await this.send({ janus: 'attach', plugin: 'janus.plugin.videoroom' }); this.handle = r.data && r.data.id; return r; }
  message(body) { return this.send({ janus: 'message', handle_id: this.handle, body }, { async: true }); }
  keepalive(ms = 15000) { this.ka = setInterval(() => { if (this.ws.readyState === 1) this.send({ janus: 'keepalive' }); }, ms); }
  stopKeepalive() { clearInterval(this.ka); this.ka = null; }
  async joinPublisher(id, display) {
    await this.create(); await this.attach();
    return this.message({ request: 'join', ptype: 'publisher', room: ROOM, id, display });
  }
  close() { this.stopKeepalive(); this.ws.close(1000, 'probe close'); }
}

const mark = (scenario, step) => log({ who: 'probe', dir: 'mark', scenario, step });

async function main() {
  log({ who: 'probe', dir: 'meta', url: URL, room: ROOM, scenarios: ONLY, node: process.version });
  const obs = new Conn('observer'); await obs.open();
  await obs.joinPublisher(9001, 'observer'); obs.keepalive();
  await obs.message({ request: 'listparticipants', room: ROOM });

  if (ONLY.includes('J1')) {
    mark('J1', 'start');
    const p = new Conn('p1'); await p.open();
    await p.joinPublisher(1001, 'p1'); p.keepalive(); await sleep(3000);
    await obs.message({ request: 'listparticipants', room: ROOM });
    mark('J1', 'leave'); await p.message({ request: 'leave' }); await sleep(2000);
    mark('J1', 'detach'); await p.send({ janus: 'detach', handle_id: p.handle }); await sleep(1000);
    mark('J1', 'destroy'); await p.send({ janus: 'destroy' }); await sleep(1000);
    p.close(); await sleep(3000);
    await obs.message({ request: 'listparticipants', room: ROOM }); mark('J1', 'end');
  }

  if (ONLY.includes('J2')) {
    mark('J2', 'start');
    const p = new Conn('p2'); await p.open();
    await p.joinPublisher(1002, 'p2'); p.keepalive(); await sleep(3000);
    mark('J2', 'ws_close_without_leave'); p.close(); await sleep(5000);
    await obs.message({ request: 'listparticipants', room: ROOM }); mark('J2', 'end');
  }

  if (ONLY.includes('J3')) {
    mark('J3', 'start');
    const p = new Conn('p3'); await p.open();
    await p.joinPublisher(1003, 'p3');
    mark('J3', 'silent_begin'); // no keepalive from here on; WS stays open
    await sleep(10000);
    mark('J3', 'rejoin_same_id_before_timeout');
    const q = new Conn('p3b'); await q.open(); await q.joinPublisher(1003, 'p3-again'); q.keepalive();
    await obs.message({ request: 'listparticipants', room: ROOM });
    await sleep(60000);
    await obs.message({ request: 'listparticipants', room: ROOM });
    mark('J3', 'rejoin_same_id_after_timeout');
    await q.message({ request: 'join', ptype: 'publisher', room: ROOM, id: 1003, display: 'p3-again' });
    await sleep(2000);
    await obs.message({ request: 'listparticipants', room: ROOM });
    mark('J3', 'cleanup'); await q.message({ request: 'leave' }); await q.send({ janus: 'destroy' }); q.close(); p.close();
    await sleep(2000); mark('J3', 'end');
  }

  if (ONLY.includes('J4')) {
    mark('J4', 'start');
    const p = new Conn('p4'); await p.open();
    await p.joinPublisher(1004, 'p4'); p.keepalive(); await sleep(3000);
    const sid = p.session;
    mark('J4', 'ws_close'); p.close(); await sleep(500);
    const p2 = new Conn('p4-claim'); await p2.open();
    mark('J4', 'claim'); const r = await p2.send({ janus: 'claim', session_id: sid });
    if (r.janus === 'success') { p2.session = sid; p2.handle = p.handle; p2.keepalive(); await sleep(3000); await p2.message({ request: 'leave' }); await p2.send({ janus: 'destroy' }); }
    await sleep(2000); p2.close();
    await obs.message({ request: 'listparticipants', room: ROOM }); mark('J4', 'end');
  }

  if (ONLY.includes('J5')) {
    // DC-4 check: WS closed, NO claim. When does the session die relative to its last
    // request (reclaim window counted from last activity, per source)? Then a late claim.
    mark('J5', 'start');
    const p = new Conn('p5'); await p.open();
    await p.joinPublisher(1005, 'p5'); await sleep(5000);
    mark('J5', 'last_request'); await p.send({ janus: 'keepalive' });
    await sleep(8000);
    const sid = p.session;
    mark('J5', 'ws_close_no_claim'); p.close();
    await sleep(40000);
    await obs.message({ request: 'listparticipants', room: ROOM });
    const late = new Conn('p5-lateclaim'); await late.open();
    mark('J5', 'late_claim'); await late.send({ janus: 'claim', session_id: sid });
    await sleep(1000); late.close(); mark('J5', 'end');
  }

  await obs.message({ request: 'leave' }); await obs.send({ janus: 'destroy' }); obs.close();
  await sleep(1000); log({ who: 'probe', dir: 'meta', done: true });
  process.exit(0);
}
main().catch((e) => { log({ who: 'probe', dir: 'fatal', err: String(e && e.stack || e) }); process.exit(1); });
