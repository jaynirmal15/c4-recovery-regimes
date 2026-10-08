// Control arm (healthy sessions): what each layer reported and what the receivers measured, per session.
// usage (after `npm ci` at the repo root): node control-analyze.mjs [--json] <dir...>      e.g. ../../control
//
// Same definitions as the 215 (divergence.mjs, analyze.mjs), applied over the whole armed window because there
// is no isolation onset to anchor on:
//   window   = all three participants armed .. 0.5 s before the first participant leaves (the session's own
//              teardown is not a report; on LiveKit the observers renegotiate when S leaves)
//   stale    = received-audio age more than 1 s, or more than 300 ms without a decoded sample
//   band     = within 250 ms of the baseline recorded at arming
//   membership, state API, Janus media events, LiveKit quality: the extraction rules of divergence.mjs
// Conditions are per stack (result.control.condition); nothing here pools h3-livekit with h3-janus.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const rd = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const r2 = (x) => +x.toFixed(2);

function clock(samples, base, a, b, rel) {
  const s = (samples || []).filter((x) => x.tP > a && x.tP < b).sort((p, q) => p.tP - q.tP);
  const dev = s.map((x) => x.age - base); const abs = dev.map(Math.abs).sort((p, q) => p - q);
  const stale = []; // receiver-defined stale intervals: [from, to, seconds]
  let prev = a; let open = null;
  for (const x of s) {
    if (x.tP - prev > 300) stale.push([rel(prev), rel(x.tP), r2((x.tP - prev) / 1000)]);
    if (x.age > 1000) { if (open == null) open = x.tP; } else if (open != null) { stale.push([rel(open), rel(x.tP), r2((x.tP - open) / 1000)]); open = null; }
    prev = x.tP;
  }
  if (b - prev > 300) stale.push([rel(prev), rel(b), r2((b - prev) / 1000)]);
  if (open != null) stale.push([rel(open), rel(b), r2((b - open) / 1000)]);
  return { n: s.length, baselineMs: r2(base), medianDevMs: abs.length ? r2(dev.slice().sort((p, q) => p - q)[dev.length >> 1]) : null, medianAbsDevMs: abs.length ? r2(abs[abs.length >> 1]) : null, p95AbsDevMs: abs.length ? r2(abs[Math.floor(abs.length * 0.95)]) : null, maxAbsDevMs: abs.length ? r2(abs[abs.length - 1]) : null, outOfBand: dev.filter((x) => Math.abs(x) > 250).length, over2s: s.filter((x) => x.age > 2000).length, stale };
}

export function analyzeControl(dir) {
  const r = rd(dir, 'result.json'); if (!r || !r.control) return null;
  const S = rd(dir, 'S.json'), O1 = rd(dir, 'O1.json'), O2 = rd(dir, 'O2.json'), B = rd(dir, 'B.json');
  const st = (D, state) => (D.log.find((l) => l.type === 'driver_state' && l.state === state) || {}).t;
  const a = Math.max(...[S, O1, O2].map((D) => st(D, 'healthy'))); const b = Math.min(...[S, O1, O2].map((D) => st(D, 'left') ?? Infinity)) - 500;
  const inW = (t) => t > a && t < b; const rel = (t) => r2((t - a) / 1000);
  const clk = r.clock || {}; const sinkOff = (clk.sink && clk.sink.offsetMs) || 0, sfuOff = (clk.sfu && clk.sfu.offsetMs) || 0;
  const ev = fs.readFileSync(path.join(dir, 'server-events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.path !== '/c4-marker');
  const out = { id: r.id, stack: r.stack, test: r.test, condition: r.control.condition, valid: r.valid, windowS: r2((b - a) / 1000), events: {} };
  // the benign events, on the pod clock, from the participants' own logs
  const lg = (D, type) => (D ? D.log.filter((l) => l.type === type && inW(l.t)).map((l) => rel(l.t)) : []);
  if (r.test === 'h3') { out.events.mute = S.log.filter((l) => l.type === 'ctl_mute').map((l) => ({ t: rel(l.t), muted: l.muted })); out.mute = r.control.mute; }
  if (B) out.events.bystander = { joined: lg(B, 'lk_joined').concat(lg(B, 'janus_webrtcup'), lg(B, 'ctl_bystander_joined'))[0] ?? null, left: (B.log.filter((l) => (l.type === 'driver_state' && l.state === 'left') || l.type === 'ctl_bystander_left').map((l) => rel(l.t))[0]) ?? null };

  const L = out.layers = {};
  if (r.stack === 'livekit') {
    const hooks = ev.filter((e) => e.body && e.body.event && inW(e.t - sinkOff)).map((e) => ({ t: rel(e.t - sinkOff), event: e.body.event, identity: (e.body.participant || {}).identity || null }));
    L.membershipS = hooks.filter((h) => h.identity === 'S' && /left|unpublished/.test(h.event)); L.membershipRoom = hooks;
    const sp = (rd(dir, 'state-poll.json').samples || []).filter((x) => !x.error && inW(x.t2));
    const sOf = (x) => x.parts.find((q) => q.identity === 'S');
    L.stateApi = { samples: sp.length, sAbnormal: sp.filter((x) => { const p = sOf(x); return !p || p.state !== 'ACTIVE' || !p.tracks; }).length, participantCounts: [...new Set(sp.map((x) => x.parts.length))], sMutedSamples: sp.filter((x) => /true/.test(JSON.stringify((sOf(x) || {}).muted))).map((x) => rel(x.t2)) };
    const sidS = (S.log.find((l) => l.type === 'lk_joined') || {}).sid;
    L.quality = []; L.participantUpdates = []; L.renegotiations = {};
    for (const [who, D] of [['S', S], ['O1', O1], ['O2', O2]]) {
      const msgs = D.frames.filter((f) => f.b64 && inW(f.t)).map((f) => { try { return { t: f.t, dir: f.dir, m: (f.dir === 'in' ? P.SignalResponse : P.SignalRequest).fromBinary(Buffer.from(f.b64, 'base64')).message }; } catch { return null; } }).filter(Boolean);
      for (const { t, dir, m } of msgs) {
        if (dir === 'in' && m.case === 'connectionQuality') for (const u of m.value.updates) L.quality.push({ t: rel(t), seenBy: who, aboutS: u.participantSid === sidS, sid: u.participantSid, quality: P.ConnectionQuality[u.quality] });
        if (dir === 'in' && m.case === 'update') for (const p of m.value.participants) L.participantUpdates.push({ t: rel(t), seenBy: who, identity: p.identity, state: P.ParticipantInfo_State[p.state], muted: p.tracks.map((x) => x.muted) });
      }
      L.renegotiations[who] = msgs.filter((x) => x.dir === 'out' && x.m.case === 'offer' && msgs.some((y) => y.dir === 'in' && y.m.case === 'answer' && y.t >= x.t && y.t - x.t < 2000)).map((x) => rel(x.t));
    }
    L.qualityNonExcellent = L.quality.filter((q) => q.quality !== 'EXCELLENT');
  } else {
    const jt = (e) => e.body.timestamp / 1000 - sfuOff; const E = ev.filter((e) => e.body && e.body.type);
    const feedOf = {}; for (const e of E) if (e.body.type === 64 && e.body.event && e.body.event.data && e.body.event.data.event === 'joined' && e.body.event.data.room === r.room) feedOf[e.body.handle_id] = e.body.event.data.id;
    const name = { 101: 'S', 102: 'O1', 103: 'O2', 104: 'B' };
    const plug = E.filter((e) => e.body.type === 64 && e.body.event && e.body.event.data && inW(jt(e))).map((e) => ({ t: rel(jt(e)), event: e.body.event.data.event, identity: name[feedOf[e.body.handle_id]] || name[e.body.event.data.id] || null }));
    // session events of the participants only: the state poller's own Janus session is the instrument's, not a participant's
    const partSess = new Set(E.filter((e) => feedOf[e.body.handle_id]).map((e) => e.body.session_id));
    const sess = E.filter((e) => e.body.type === 1 && partSess.has(e.body.session_id) && inW(jt(e))).map((e) => ({ t: rel(jt(e)), event: `session ${e.body.event.name}`, identity: null }));
    L.membershipS = plug.filter((p) => p.identity === 'S' && ['leaving', 'kicked', 'unpublished'].includes(p.event)); L.membershipRoom = plug.filter((p) => ['joined', 'leaving', 'kicked', 'unpublished', 'published'].includes(p.event)).concat(sess);
    const sp = (rd(dir, 'state-poll.json').samples || []).filter((x) => !x.error && inW(x.t2));
    L.stateApi = { samples: sp.length, sAbnormal: sp.filter((x) => { const p = x.parts.find((q) => q.id === 101); return !p || !p.publisher; }).length, participantCounts: [...new Set(sp.map((x) => x.parts.length))] };
    const media = E.filter((e) => e.body.type === 32 && e.body.event && typeof e.body.event.receiving === 'boolean' && inW(jt(e))).map((e) => ({ t: rel(jt(e)), receiving: e.body.event.receiving, handle: feedOf[e.body.handle_id] ? `publisher ${name[feedOf[e.body.handle_id]]}` : 'subscriber', media: e.body.event.media || e.body.event.mid || null }));
    L.mediaEvents = media; L.mediaNotReceivingS = media.filter((m) => !m.receiving && m.handle === 'publisher S'); L.mediaNotReceivingAny = media.filter((m) => !m.receiving);
    L.slowLink = [['S', S], ['O1', O1], ['O2', O2]].flatMap(([who, D]) => D.log.filter((l) => l.type === 'janus_slowlink' && inW(l.t)).map((l) => ({ t: rel(l.t), at: who })));
    L.clientMediaFalse = [['S', S], ['O1', O1], ['O2', O2]].flatMap(([who, D]) => D.log.filter((l) => l.type === 'janus_media' && l.receiving === false && inW(l.t)).map((l) => ({ t: rel(l.t), at: who })));
    // server statistics for S's publisher handle: did the server keep receiving packets? (5 s cadence)
    const sh = Number(Object.keys(feedOf).find((h) => feedOf[h] === 101)); const stats = E.filter((e) => e.body.type === 32 && e.body.subtype === 3 && e.body.handle_id === sh && inW(jt(e))).map((e) => ({ t: rel(jt(e)), rx: e.body.event['packets-received'] }));
    L.serverRxRateS = stats.slice(1).map((x, i) => ({ from: stats[i].t, to: x.t, packetsPerS: r2((x.rx - stats[i].rx) / (x.t - stats[i].t)) }));
  }
  // client
  out.client = { sDetections: S.log.filter((l) => l.type === 'driver_state' && inW(l.t) && !['healthy', 'left', 'joined'].includes(l.state)).map((l) => ({ t: rel(l.t), state: l.state })), sActions: S.driver.actions.length, sViolations: S.violations.length,
    observerDetections: [['O1', O1], ['O2', O2]].filter(([, D]) => D.driver.observerDetected).map(([who, D]) => ({ who, t: rel(D.driver.observerDetected.t) })) };
  // receivers: the in-band clock, each direction
  out.clock = { O1_hears_S: clock(O1.fresh.S, O1.driver.baseline.S, a, b, rel), O2_hears_S: clock(O2.fresh.S, O2.driver.baseline.S, a, b, rel), S_hears_O1: clock(S.fresh.O1, S.driver.baseline.O1, a, b, rel), S_hears_O2: clock(S.fresh.O2, S.driver.baseline.O2, a, b, rel), O1_hears_O2: clock(O1.fresh.O2, O1.driver.baseline.O2, a, b, rel), O2_hears_O1: clock(O2.fresh.O1, O2.driver.baseline.O1, a, b, rel) };
  // the two observers against each other (the bystander shares O2's pod in h1 and h2)
  const c1 = out.clock.O1_hears_S, c2 = out.clock.O2_hears_S; const tot = (c) => r2(c.stale.reduce((s, x) => s + x[2], 0));
  out.observerPair = { medianDevMs: [c1.medianDevMs, c2.medianDevMs], p95AbsDevMs: [c1.p95AbsDevMs, c2.p95AbsDevMs], maxAbsDevMs: [c1.maxAbsDevMs, c2.maxAbsDevMs], outOfBand: [c1.outOfBand, c2.outOfBand], staleIntervals: [c1.stale.length, c2.stale.length], staleS: [tot(c1), tot(c2)], samples: [c1.n, c2.n],
    staleEdgeDiffS: c1.stale.length === c2.stale.length ? c1.stale.map((x, i) => [r2(x[0] - c2.stale[i][0]), r2(x[1] - c2.stale[i][1])]) : 'interval counts differ' };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const json = args[0] === '--json'; if (json) args.shift();
  const rows = [];
  for (const top of args) for (const d of fs.readdirSync(top).sort()) { const p = path.join(top, d); if (!fs.existsSync(path.join(p, 'result.json'))) continue; try { const x = analyzeControl(p); if (x) rows.push({ ...x, set: path.basename(top) }); } catch (e) { console.error(`${p}: ${e.message}`); } }
  if (json) console.log(JSON.stringify(rows));
  else for (const x of rows) {
    const L = x.layers; const c = x.clock;
    console.log([x.set, x.condition, x.valid ? 'valid' : 'INVALID', `window ${x.windowS}s`, `events ${JSON.stringify(x.events)}`,
      `memb(S) ${L.membershipS.length}`, `memb(room) ${L.membershipRoom.map((m) => `${m.event}[${m.identity || ''}]@${m.t}`).join(',') || 0}`, `stateAPI S abnormal ${L.stateApi.sAbnormal}/${L.stateApi.samples} counts ${JSON.stringify(L.stateApi.participantCounts)}${L.stateApi.sMutedSamples ? ` muted@${L.stateApi.sMutedSamples.length ? `${L.stateApi.sMutedSamples[0]}..${L.stateApi.sMutedSamples.at(-1)} (${L.stateApi.sMutedSamples.length})` : '-'}` : ''}`,
      x.stack === 'livekit' ? `quality updates ${L.quality.length}, non-excellent ${L.qualityNonExcellent.map((q) => `${q.quality}${q.aboutS ? '(S)' : ''}@${q.t}→${q.seenBy}`).join(',') || 0}; renegotiations ${JSON.stringify(L.renegotiations)}` : `media not-receiving S ${L.mediaNotReceivingS.map((m) => m.t).join(',') || 0}, any ${L.mediaNotReceivingAny.map((m) => `${m.handle}@${m.t}`).join(',') || 0}; slowlink ${L.slowLink.length}; client media=false ${L.clientMediaFalse.length}`,
      `client: S detections ${x.client.sDetections.length} actions ${x.client.sActions} violations ${x.client.sViolations} observer detections ${x.client.observerDetections.length}`,
      `stale O1←S ${JSON.stringify(c.O1_hears_S.stale)} O2←S ${JSON.stringify(c.O2_hears_S.stale)} S←O1 ${JSON.stringify(c.S_hears_O1.stale)} S←O2 ${JSON.stringify(c.S_hears_O2.stale)}`,
      `observers O1|O2: median dev ${x.observerPair.medianDevMs.join('|')} ms, p95 ${x.observerPair.p95AbsDevMs.join('|')}, max ${x.observerPair.maxAbsDevMs.join('|')}, out-of-band ${x.observerPair.outOfBand.join('|')}`].join(' | '));
  }
}
