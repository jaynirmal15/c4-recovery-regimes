// Can the regime be classified from RAW SIGNALLING FRAMES alone? (2026-10-02 analysis)
// usage (after `npm ci` at the repo root): node classify-raw.mjs <divergence rows.json> <trialsDir...>
//
// Three independent classifiers, each restricted to one evidence source. None reads driver
// state, media measurements, server events or the state API. All see only frames between
// isolation onset and 0.5 s before the trial's own teardown.
//   toSubject   : frames the SERVER sent to S           ("what the server told the client")
//   toObservers : frames the SERVER sent to O1 and O2    ("what the server told third parties")
//   fromSubject : frames S sent to the server, and the URLs of sockets it opened
//                 ("what the server was told"; not something the server said)
// Output label: R0 continues | R1 transport restart | R2 rebuild | R3 gone, or a set when the
// source cannot tell two apart (e.g. "R0|R1").
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const lkIn = (D, a, b) => D.frames.filter((f) => f.dir === 'in' && f.b64 && f.t > a && f.t < b).map((f) => { try { return { t: f.t, m: P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message }; } catch { return null; } }).filter(Boolean);
const jIn = (D, a, b) => D.frames.filter((f) => f.dir === 'in' && f.text && f.t > a && f.t < b).map((f) => { try { return JSON.parse(f.text); } catch { return null; } }).filter(Boolean);
const jOut = (D, a, b) => D.frames.filter((f) => f.dir === 'out' && f.text && f.t > a && f.t < b).map((f) => { try { return JSON.parse(f.text); } catch { return null; } }).filter(Boolean);

function classify(dir) {
  const r = rd(dir, 'result.json'), S = rd(dir, 'S.json'), O = [rd(dir, 'O1.json'), rd(dir, 'O2.json')];
  const t0 = r.iso.onset.after; const left = (S.driver.history.find((h) => h.state === 'left') || {}).t; const t1 = (left || Infinity) - 500;
  const out = {}; const ev = {};
  if (r.stack === 'livekit') {
    // --- server -> subject
    const fs_ = lkIn(S, t0, t1); const cases = fs_.map((x) => x.m.case);
    const leave = fs_.filter((x) => x.m.case === 'leave').map((x) => `leave{${P.LeaveRequest_Action[x.m.value.action]},${P.DisconnectReason[x.m.value.reason]}}`);
    out.toSubject = cases.includes('join') ? 'R2' : cases.includes('reconnect') ? 'R1' : 'R0';
    ev.toSubject = [cases.includes('join') && 'JoinResponse', cases.includes('reconnect') && `ReconnectResponse×${cases.filter((c) => c === 'reconnect').length}`, ...new Set(leave)].filter(Boolean);
    // --- server -> observers: participant updates for identity S
    const res = O.map((D) => {
      const before = lkIn(D, 0, t0).flatMap((x) => (x.m.case === 'update' ? x.m.value.participants : x.m.case === 'join' ? x.m.value.otherParticipants || [] : [])).filter((p) => p.identity === 'S').map((p) => p.sid);
      const sid0 = before[before.length - 1];
      const ups = lkIn(D, t0, t1).flatMap((x) => (x.m.case === 'update' ? x.m.value.participants.filter((p) => p.identity === 'S') : []));
      const gone = ups.some((p) => p.state === 3), newSid = ups.some((p) => p.state !== 3 && p.sid !== sid0);
      const q = lkIn(D, t0, t1).flatMap((x) => (x.m.case === 'connectionQuality' ? x.m.value.updates.filter((u) => u.participantSid === sid0 && u.quality !== P.ConnectionQuality.EXCELLENT) : [])).length;
      return { label: newSid ? 'R2' : gone ? 'R3' : 'R0|R1', e: [gone && 'ParticipantUpdate{DISCONNECTED}', newSid && 'ParticipantUpdate{new sid}', q && `ConnectionQualityUpdate≠EXCELLENT×${q}`].filter(Boolean) };
    });
    out.toObservers = res.every((x) => x.label === res[0].label) ? res[0].label : `disagree(${res.map((x) => x.label).join(',')})`;
    ev.toObservers = [...new Set(res.flatMap((x) => x.e.map((s) => s.replace(/×\d+$/, ''))))];
    // --- subject -> server: the sockets S opened
    const opens = S.frames.filter((f) => f.dir === 'open' && f.t > t0 && f.t < t1).map((f) => f.url || '');
    // protocol 17: the reconnect flag travels inside the gzip'd JoinRequest in the URL's join_request parameter
    const isRec = (u) => { try { const w = P.WrappedJoinRequest.fromBinary(Buffer.from(new URL(u).searchParams.get('join_request'), 'base64')); let b = Buffer.from(w.joinRequest); if (b[0] === 0x1f) b = zlib.gunzipSync(b); return P.JoinRequest.fromBinary(b).reconnect; } catch { return /[?&]reconnect=(1|true)/.test(u); } };
    const rec = opens.filter(isRec).length, fresh = opens.length - rec;
    out.fromSubject = fresh ? 'R2' : rec ? 'R1' : 'R0';
    ev.fromSubject = [rec && `socket opened, JoinRequest{reconnect:true, participantSid} ×${rec}`, fresh && `socket opened, JoinRequest{reconnect:false} ×${fresh}`].filter(Boolean);
  } else {
    // --- server -> subject
    const ms = jIn(S, t0, t1);
    const created = ms.some((m) => m.janus === 'success' && m.data && m.data.id && m.session_id === undefined);
    const joined = ms.some((m) => m.plugindata && m.plugindata.data && m.plugindata.data.videoroom === 'joined');
    const claimOk = ms.some((m) => m.janus === 'success' && m.session_id !== undefined && !m.data && !m.plugindata);
    const answer = ms.some((m) => m.jsep && m.jsep.type === 'answer');
    const subOffer = ms.some((m) => m.jsep && m.jsep.type === 'offer');
    const errs = [...new Set(ms.filter((m) => m.janus === 'error').map((m) => `error ${m.error && m.error.code}`))];
    const media = ms.filter((m) => m.janus === 'media' && m.receiving === false).length;
    out.toSubject = created || joined ? 'R2' : claimOk || answer || subOffer ? 'R1' : 'R0';
    ev.toSubject = [created && 'success{data.id} (create reply)', joined && 'event{videoroom:joined}', claimOk && 'success{session_id} (claim reply)', answer && 'event{configured, jsep answer}', subOffer && 'event{jsep offer} (subscriber)', media && 'media{receiving:false}', ...errs].filter(Boolean);
    // --- server -> observers: VideoRoom events about feed 101
    const res = O.map((D) => {
      const pd = jIn(D, t0, t1).map((m) => m.plugindata && m.plugindata.data).filter(Boolean);
      const gone = pd.some((d) => [d.leaving, d.unpublished, d.kicked].includes(101));
      const pubs = pd.filter((d) => Array.isArray(d.publishers) && d.publishers.some((p) => p.id === 101)).length;
      return { label: gone ? (pubs ? 'R2' : 'R3') : pubs ? 'R1' : 'R0', e: [gone && 'event{unpublished|leaving:101}', pubs && 'event{publishers:[101]}'].filter(Boolean) };
    });
    out.toObservers = res.every((x) => x.label === res[0].label) ? res[0].label : `disagree(${res.map((x) => x.label).join(',')})`;
    ev.toObservers = [...new Set(res.flatMap((x) => x.e))];
    // --- subject -> server
    const os = jOut(S, t0, t1);
    const create = os.some((m) => m.janus === 'create'), claim = os.some((m) => m.janus === 'claim'), restart = os.some((m) => m.janus === 'message' && ((m.jsep && m.jsep.type === 'offer') || (m.body && m.body.restart)));
    out.fromSubject = create ? 'R2' : claim || restart ? 'R1' : 'R0';
    ev.fromSubject = [create && 'create', claim && 'claim', restart && 'configure{jsep offer | restart:true}'].filter(Boolean);
  }
  // --- the server's own standard event surface, read alone (webhooks / event handler)
  const sv = path.join(dir, 'server-events.jsonl');
  if (fs.existsSync(sv)) {
    const E = fs.readFileSync(sv, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.path !== '/c4-marker' && e.body);
    if (r.stack === 'livekit') {
      const mine = E.filter((e) => e.t > t0 && e.t < t1 && e.body.participant && e.body.participant.identity === 'S').map((e) => e.body.event);
      const gone = mine.includes('participant_left'), back = mine.includes('participant_joined');
      out.serverSurface = gone ? (back ? 'R2' : 'R3') : 'R0|R1'; ev.serverSurface = [...new Set(mine)];
    } else {
      const ts = (e) => e.body.timestamp / 1000;
      const joins = E.filter((e) => e.body.type === 64 && e.body.event.data && e.body.event.data.event === 'joined' && e.body.event.data.id === 101 && e.body.event.data.room === r.room);
      const sess0 = joins.filter((e) => ts(e) <= t0).map((e) => e.body.session_id)[0];
      const rejoin = joins.some((e) => ts(e) > t0 && ts(e) < t1);
      const mine = E.filter((e) => e.body.session_id === sess0 && ts(e) > t0 && ts(e) < t1);
      const jsep = mine.filter((e) => e.body.type === 8).length, claimed = mine.some((e) => e.body.type === 128 || (e.body.type === 2 && e.body.event.name === 'attached'));
      const ice = mine.filter((e) => e.body.type === 16 && e.body.subtype === 1).length, timeout = mine.some((e) => e.body.type === 1 && /timeout|destroyed/.test(e.body.event.name));
      const media = mine.filter((e) => e.body.type === 32 && e.body.event.receiving === false).length;
      out.serverSurface = rejoin ? 'R2' : timeout ? 'R3' : jsep ? 'R1' : 'R0';
      ev.serverSurface = [rejoin && 'plugin joined (new session)', timeout && 'session timeout', jsep && 'jsep events (type 8)', ice && 'ICE state events (type 16)', claimed && 'handle attached (type 2)', media && 'media receiving=false (type 32)'].filter(Boolean);
    }
  } else { out.serverSurface = 'n/a'; ev.serverSurface = []; }
  return { id: r.id, out, ev };
}

const [rowsFile, ...tops] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8')).filter((x) => x.valid && x.serverComplete);
const dirOf = new Map(); for (const top of tops) for (const d of fs.readdirSync(top)) if (fs.existsSync(path.join(top, d, 'result.json'))) dirOf.set(d, path.join(top, d));
const res = rows.filter((x) => dirOf.has(x.id)).map((x) => ({ ...x, silent: x.layers.A_membership.kind === 'nothing' && x.layers.B_obs_membership.kind === 'nothing' && (!x.layers.A_state || ['nothing', 'not captured'].includes(x.layers.A_state.kind)), c: classify(dirOf.get(x.id)) }));
fs.writeFileSync(rowsFile.replace(/\.json$/, '') + '-rawclass.json', JSON.stringify(res.map((x) => ({ id: x.id, stack: x.stack, mode: x.mode, D: x.D, regime: x.regime, silent: x.silent, ...x.c }))));
const cnt = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort().map(([a, b]) => `${a}×${b}`).join('  ');
for (const stack of ['livekit', 'janus']) for (const scope of ['membership-silent', 'all']) {
  const rs = res.filter((x) => x.stack === stack && (scope === 'all' || x.silent)); if (!rs.length) continue;
  console.log(`\n=== ${stack}, ${scope} trials: n=${rs.length}  (true regimes: ${cnt(rs.map((x) => x.regime))})`);
  for (const src of ['toSubject', 'toObservers', 'fromSubject', 'serverSurface']) {
    const ok = rs.filter((x) => x.c.out[src] === x.regime);
    console.log(`  ${src.padEnd(12)} correct ${ok.length}/${rs.length}`);
    for (const reg of [...new Set(rs.map((x) => x.regime))].sort()) { const g = rs.filter((x) => x.regime === reg); console.log(`     true ${reg} (n=${g.length}) -> ${cnt(g.map((x) => x.c.out[src]))}   evidence: ${cnt(g.flatMap((x) => (x.c.ev[src].length ? x.c.ev[src] : ['(no frame at all)'])).map((s) => s.replace(/ ×\d+$/, '')))}`); }
    const bad = rs.filter((x) => x.c.out[src] !== x.regime && !/\|/.test(x.c.out[src]));
    for (const x of bad.slice(0, 12)) console.log(`     MISS ${x.id}: true ${x.regime}, got ${x.c.out[src]} [${x.c.ev[src].join('; ')}]`);
  }
}
