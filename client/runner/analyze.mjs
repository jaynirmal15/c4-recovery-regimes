// C4 trial analysis (STAGE-A-SPEC §5). Pod clocks only (all clients share one node).
// usage (after `npm ci` at the repo root): node analyze.mjs <trialDir...>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('@livekit/protocol');
const STATE = ['JOINING', 'JOINED', 'ACTIVE', 'DISCONNECTED'];
const rd = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const txt = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

function sinkBodies(raw) { // mendhak echo logs -> [{t, body}]
  const out = []; const dec = (s) => { try { return JSON.parse(s); } catch { return s; } };
  let buf = '', t0 = null;
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^(\S+Z) ?(.*)$/); const ts = m ? m[1] : null, x = m ? m[2] : ln;
    if (!buf && x.startsWith('{')) t0 = ts;
    if (buf || x.startsWith('{')) { buf += x + '\n'; try { const o = JSON.parse(buf); buf = ''; if (o.body !== undefined) { const b = dec(o.body); for (const e of Array.isArray(b) ? b : [b]) out.push({ t: Date.parse(t0), body: e }); } } catch {} }
  }
  return out;
}

// New sink (2026-10-01): events stored by the sink itself, one JSON per line {seq,t,path,body}.
// Returns null when the trial predates it (fall back to the echo-sink container logs).
function sinkEvents(dir) {
  const p = path.join(dir, 'server-events.jsonl'); if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((e) => ({ t: e.t, path: e.path, body: e.body }));
}

function observerView(dump, stack, subjectFeed) {
  const ev = [];
  for (const f of dump.frames) {
    if (f.dir !== 'in') continue;
    if (stack === 'livekit' && f.b64) {
      let m; try { m = P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message; } catch { continue; }
      if (m.case === 'update') for (const p of m.value.participants) if (p.identity === 'S') ev.push({ t: f.t, sid: p.sid, state: STATE[p.state], reason: p.disconnectReason ? P.DisconnectReason[p.disconnectReason] : null });
      if (m.case === 'join') for (const p of m.value.otherParticipants || []) if (p.identity === 'S') ev.push({ t: f.t, sid: p.sid, state: STATE[p.state], reason: null, via: 'join' });
    } else if (stack === 'janus' && f.text) {
      let m; try { m = JSON.parse(f.text); } catch { continue; }
      const d = m.plugindata && m.plugindata.data; if (!d) continue;
      if (d.leaving === subjectFeed) ev.push({ t: f.t, event: 'leaving', feed: subjectFeed });
      if (d.unpublished === subjectFeed) ev.push({ t: f.t, event: 'unpublished', feed: subjectFeed });
      if (d.kicked === subjectFeed) ev.push({ t: f.t, event: 'kicked', feed: subjectFeed });
      if (d.joining && d.joining.id === subjectFeed) ev.push({ t: f.t, event: 'joining', feed: subjectFeed });
      for (const p of d.publishers || []) if (p.id === subjectFeed) ev.push({ t: f.t, event: 'publisher', feed: subjectFeed });
    }
  }
  // collapse exact repeats
  return ev.filter((e, i) => i === 0 || JSON.stringify({ ...e, t: 0 }) !== JSON.stringify({ ...ev[i - 1], t: 0 }));
}

const GAP = 300; // ms without a decoded sample = nothing fresh being presented
function freshAt(samples, base, t0) { // first t >= t0 where age <= base+250 CONTINUOUSLY for 1 s (gaps count as not fresh)
  const xs = samples.filter((s) => s.tP >= t0);
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].age > base + 250) continue;
    let j = i + 1, good = true;
    while (j < xs.length && xs[j].tP <= xs[i].tP + 1000) { if (xs[j].age > base + 250 || xs[j].tP - xs[j - 1].tP > GAP) { good = false; break; } j++; }
    if (good && j < xs.length && xs[j].tP - xs[j - 1].tP <= GAP) return xs[i].tP;
  }
  return null;
}
function staleMs(samples, t0, t1) { // time presenting media older than 1 s, or nothing, within [t0,t1]
  let stale = 0, prev = t0;
  for (const s of samples.filter((x) => x.tP >= t0 && x.tP <= t1)) { const gap = s.tP - prev; if (gap > 300) stale += gap; else if (s.age > 1000) stale += gap; prev = s.tP; }
  return stale + Math.max(0, t1 - prev - 300);
}

export function analyze(dir) {
  const r = rd(dir, 'result.json'); const S = rd(dir, 'S.json'), O1 = rd(dir, 'O1.json'), O2 = rd(dir, 'O2.json'), I = rd(dir, 'INTRUDER.json');
  for (const d of [S, O1, O2, I]) if (d && d.fresh) for (const k of Object.keys(d.fresh)) d.fresh[k].sort((a, b) => a.tP - b.tP);
  const out = { id: r.id, stack: r.stack, test: r.test, arm: r.arm, valid: r.valid, invalid: r.invalid };
  if (!S) return { ...out, error: 'no subject dump' };
  const L = S.log; const find = (type, f = () => true) => L.find((e) => e.type === type && f(e));
  // trigger time in POD clock
  const trig = { healthy_rebuild: find('driver_action_begin'), remove_participant: find('server_terminal'), kick: find('server_terminal'), intruder: find('server_terminal'), rogue: find('rogue_planted'), isolation: r.iso ? { t: r.iso.onset.after } : null }[r.test];
  const t0 = trig ? trig.t : null; out.tTrigger = t0;
  const tRestore = r.iso ? r.iso.restore.after : null;
  if (r.iso) out.iso = { mode: r.iso.mode, plannedS: r.iso.plannedS, actualS: +r.iso.actualS.toFixed(2) };
  const rel = (t) => (t == null || t0 == null ? null : +((t - t0) / 1000).toFixed(3));
  out.subject = {
    actions: S.driver.actions.map((a) => ({ kind: a.kind, t: rel(a.tStart), dur: +((a.tEnd - a.tStart) / 1000).toFixed(3), ok: a.result && a.result.ok, refused: a.result && a.result.refused, detail: a.result && a.result.detail, sid0: a.sid0, sid1: a.sid1 })),
    terminals: S.driver.terminals.map((x) => ({ t: rel(x.t), reason: x.reason })),
    serverRequests: S.driver.serverRequests.map((x) => ({ t: rel(x.t), kind: x.kind })),
    violations: S.violations.map((v) => ({ t: rel(v.t), where: v.where })),
    states: S.driver.history.filter((h) => t0 == null || h.t >= t0 - 1000).map((h) => `${rel(h.t)}:${h.state}`),
    sessions: [...new Set(S.log.filter((e) => ['lk_joined', 'janus_session'].includes(e.type)).map((e) => e.sid))],
    detected: (() => { const d = S.driver.history.find((h) => h.state === 'detected' && (t0 == null || h.t >= t0)); return d ? rel(d.t) : null; })(),
    gaveUp: S.driver.history.some((h) => h.state === 'gaveup'),
    blockFirst: S.log.filter((e) => e.type === 'block_first').map((e) => ({ t: rel(e.t), ports: e.ports.length, ok: !!(e.blocked && e.blocked.ok) })),
  };
  // freshness (rubric §5.1)
  if (t0 != null) {
    const b = (d, k) => (d.driver.baseline || {})[k] ?? 100;
    const oFresh = ['O1', 'O2'].map((o) => { const d = o === 'O1' ? O1 : O2; return d ? freshAt(d.fresh.S || [], b(d, 'S'), t0) : null; });
    const sFresh = ['O1', 'O2'].map((k) => freshAt(S.fresh[k] || [], b(S, k), t0));
    // "recovered" requires fresh S media at BOTH observers after S's media was ever disturbed
    const disturbedAt = (d) => { const xs = (d.fresh.S || []).filter((s) => s.tP >= t0); let prev = t0; for (const s of xs) { if (s.tP - prev > GAP || s.age > 1000) return prev; prev = s.tP; } return null; };
    const dist = [O1, O2].map((d) => d && disturbedAt(d));
    const recov = [O1, O2].map((d, i) => d && dist[i] != null ? freshAt(d.fresh.S || [], b(d, 'S'), dist[i]) : oFresh[i]);
    // stale time runs to the trial's teardown, not to the last decoded sample (a never-recovering subject has none)
    const teardown = (S.driver.history.find((h) => h.state === 'left') || {}).t;
    const tEnd = teardown != null ? teardown - 500 : Math.max(...[O1, O2].filter(Boolean).map((d) => Math.max(t0, ...(d.fresh.S || []).map((s) => s.tP))));
    out.freshness = {
      baselineMs: { O1_sees_S: O1 && b(O1, 'S'), O2_sees_S: O2 && b(O2, 'S') },
      disturbed: dist.map(rel),
      observersFreshAgain: recov.map(rel),
      subjectFreshFrom: sFresh.map(rel),
      recovered_t: recov.every((x) => x != null) ? rel(Math.max(...recov)) : null,
      recovered_from_restore: tRestore != null && recov.every((x) => x != null) ? +((Math.max(...recov) - tRestore) / 1000).toFixed(3) : null,
      everDisturbed: dist.some((x) => x != null),
      staleMsAtObservers: [O1, O2].map((d) => d && Math.round(staleMs(d.fresh.S || [], t0, tEnd))),
    };
  }
  // client-experienced regime (§5.2)
  const acts = out.subject.actions, lastOk = [...acts].reverse().find((a) => a.ok);
  const newSid = out.subject.sessions.length > 1;
  out.regime = !out.freshness ? 'unclassified (no trigger time, freshness not measured)' : out.freshness.recovered_t == null ? 'R3 never recovers'
    : !acts.length ? 'R0 continues' : lastOk && lastOk.kind === 'rebuild' && newSid ? 'R2 rebuild' : lastOk && lastOk.kind === 'transport_restart' ? 'R1 transport restart' : 'unclassified';
  // server-reported view (§5.3)
  if (r.stack === 'livekit') {
    // server times are moved onto the client clock with the measured offsets (spec §3.1.5)
    const off = (r.clock && r.clock.sink && r.clock.sink.offsetMs) || 0;
    out.server = (sinkEvents(dir) || sinkBodies(txt(dir, 'server-webhooks.log'))).map((x) => ({ ...x, t: x.t - off })).filter((x) => x.body && x.body.participant && x.body.participant.identity === 'S').map((x) => ({ t: rel(x.t), event: x.body.event, sid: x.body.participant.sid, reason: x.body.participant.disconnectReason || null }));
  } else {
    const off = (r.clock && r.clock.sfu && r.clock.sfu.offsetMs) || 0; // Janus stamps its own events
    const ev = (sinkEvents(dir) || sinkBodies(txt(dir, 'server-janus-events.log'))).map((x) => (x.body && x.body.timestamp ? { ...x, body: { ...x.body, timestamp: x.body.timestamp - off * 1000 } } : x));
    out.server = ev.filter((x) => x.body && x.body.type === 64 && x.body.event && x.body.event.data && x.body.event.data.id === 101 && x.body.event.data.room === r.room).map((x) => ({ t: rel(x.body.timestamp / 1000), event: x.body.event.data.event }))
      .concat(ev.filter((x) => x.body && x.body.type === 1 && out.subject.sessions.map(Number).includes(x.body.session_id)).map((x) => ({ t: rel(x.body.timestamp / 1000), event: `session.${x.body.event.name}`, session: String(x.body.session_id) })))
      .sort((a, b) => a.t - b.t);
  }
  // other-participant view (§5.4)
  out.observers = Object.fromEntries([['O1', O1], ['O2', O2]].filter(([, d]) => d).map(([k, d]) => [k, observerView(d, r.stack, 101).filter((e) => t0 == null || e.t >= t0 - 2000).map((e) => ({ ...e, t: rel(e.t) }))]));
  // Labels cover onset .. teardown only: the trial's own end-of-trial leave is not a server/observer event of interest.
  const leftAt = (S.driver.history.find((h) => h.state === 'left') || {}).t;
  const tCut = leftAt != null ? rel(leftAt) - 0.5 : Infinity;
  out.teardownAt = leftAt != null ? rel(leftAt) : null;
  const after = (xs) => (xs || []).filter((e) => e.t != null && e.t >= 0 && e.t < tCut);
  if (r.stack === 'livekit') {
    const sv = after(out.server); const left = sv.some((e) => e.event === 'participant_left'), joined = sv.some((e) => e.event === 'participant_joined');
    out.serverLabel = left && joined ? 'S-replaced' : left ? 'S-removed' : 'S-silent';
    out.observerLabel = Object.fromEntries(Object.entries(out.observers).map(([k, ev]) => { const e = after(ev); const sids = new Set(e.filter((x) => x.state === 'ACTIVE').map((x) => x.sid)); const gone = e.some((x) => x.state === 'DISCONNECTED'); const newSid = [...sids].some((x) => x !== out.subject.sessions[0]); return [k, newSid ? 'O-left+returned' : gone ? 'O-left' : 'O-nothing']; }));
  } else {
    const sv = after(out.server); const left = sv.some((e) => e.event === 'leaving' || e.event === 'kicked'), joined = sv.some((e) => e.event === 'joined');
    out.serverLabel = left && joined ? 'S-replaced' : left ? 'S-removed' : sv.some((e) => e.event === 'unpublished') ? 'S-unpublished' : 'S-silent';
    out.observerLabel = Object.fromEntries(Object.entries(out.observers).map(([k, ev]) => { const e = after(ev); const gone = e.some((x) => x.event === 'leaving' || x.event === 'kicked'), back = e.some((x) => x.event === 'publisher' || x.event === 'joining'), unpub = e.some((x) => x.event === 'unpublished'); return [k, gone && back ? 'O-left+returned' : gone ? 'O-left' : unpub && back ? 'O-unpublished+republished' : unpub ? 'O-unpublished' : back ? 'O-republished' : 'O-nothing']; }));
  }
  if (I) out.intruder = { terminals: I.driver.terminals.map((x) => ({ t: rel(x.t), reason: x.reason })), leaveFrames: I.log.filter((e) => e.type === 'lk_leave_frame').map((e) => ({ t: rel(e.t), action: e.action, reason: e.reason })), sessions: [...new Set(I.log.filter((e) => e.type === 'lk_joined').map((e) => e.sid))] };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const d of process.argv.slice(2)) console.log(JSON.stringify(analyze(d), null, 1));
}
