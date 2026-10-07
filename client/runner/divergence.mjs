// C4 divergence analysis: what each channel reported about the subject's outage, against what
// observers actually experienced (STAGE-A-SPEC §5.5).
// usage (after `npm ci` at the repo root): node divergence.mjs [--json] <trialsDir...>
//
// Truth (channel 3, observer experience): [tDown, tUp] = S's media first stale at an observer ..
// fresh again at both (rubric §5.1), seconds after isolation onset.
// Each reporting layer is reduced to: down = first report that something is wrong with S,
// up = first report after `down` that S is back, kind = what sort of report it was.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { analyze } from './analyze.mjs';
const require = createRequire(import.meta.url);
const P = require('@livekit/protocol');
const rd = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const txt = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

function oldSink(raw) { // pre-2026-10-01 echo-sink container logs -> [{t, body}]
  const out = []; const dec = (s) => { try { return JSON.parse(s); } catch { return s; } };
  let buf = '', t0 = null;
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^(\S+Z) ?(.*)$/); const ts = m ? m[1] : null, x = m ? m[2] : ln;
    if (!buf && x.startsWith('{')) t0 = ts;
    if (buf || x.startsWith('{')) { buf += x + '\n'; try { const o = JSON.parse(buf); buf = ''; if (o.body !== undefined) { const b = dec(o.body); for (const e of Array.isArray(b) ? b : [b]) out.push({ t: Date.parse(t0), body: e }); } } catch {} }
  }
  return out;
}
function serverEvents(dir, stack) {
  const p = path.join(dir, 'server-events.jsonl');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.path !== '/c4-marker');
  return oldSink(txt(dir, stack === 'livekit' ? 'server-webhooks.log' : 'server-janus-events.log'));
}
const lkFrames = (dump) => dump.frames.filter((f) => f.dir === 'in' && f.b64).map((f) => { try { return { t: f.t, m: P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message }; } catch { return null; } }).filter(Boolean);
const jFrames = (dump) => dump.frames.filter((f) => f.dir === 'in' && f.text).map((f) => { try { return { t: f.t, m: JSON.parse(f.text) }; } catch { return null; } }).filter(Boolean);

/** reduce a time-ordered list of {t, s:'down'|'up', kind} to one layer record */
function layer(reports, t0, tCut) {
  const xs = reports.filter((r) => r.t > t0 && r.t < tCut).sort((a, b) => a.t - b.t);
  const down = xs.find((r) => r.s === 'down');
  const up = down ? xs.find((r) => r.s === 'up' && r.t > down.t) : null;
  const rel = (t) => +((t - t0) / 1000).toFixed(2);
  return { kind: down ? down.kind : 'nothing', down: down ? rel(down.t) : null, up: up ? rel(up.t) : null, upKind: up ? up.kind : null };
}

export function divergence(dir) {
  const a = analyze(dir); const r = rd(dir, 'result.json');
  if (!a.freshness || !r.iso) return null;
  const S = rd(dir, 'S.json'), O1 = rd(dir, 'O1.json'), O2 = rd(dir, 'O2.json');
  const t0 = r.iso.onset.after; const abs = (s) => t0 + s * 1000;
  const tCut = a.teardownAt != null ? abs(a.teardownAt - 0.5) : Infinity; // the trial's own leave is not a report
  const clk = r.clock || {}; const sinkOff = (clk.sink && clk.sink.offsetMs) || 0, sfuOff = (clk.sfu && clk.sfu.offsetMs) || 0;
  const dist = a.freshness.disturbed.filter((x) => x != null);
  const truth = { down: dist.length ? Math.min(...dist) : null, up: a.freshness.recovered_t, staleS: +(Math.max(...a.freshness.staleMsAtObservers) / 1000).toFixed(1) };
  const ev = serverEvents(dir, r.stack);
  const L = {}; let serverComplete = !(r.invalid || []).some((x) => /server-event/.test(x));
  if (r.stack === 'livekit') {
    const sids = new Set(a.subject.sessions);
    // A. standard surface: webhooks
    L.A_membership = layer(ev.filter((e) => e.body && e.body.participant && e.body.participant.identity === 'S').map((e) => ({ t: e.t - sinkOff, s: /left|unpublished/.test(e.body.event) ? 'down' : 'up', kind: e.body.event })), t0, tCut);
    L.A_media = { kind: 'no such surface', down: null, up: null };
    // B. raw protocol to observers
    const of = [O1, O2].filter(Boolean).flatMap(lkFrames);
    L.B_obs_membership = layer(of.flatMap(({ t, m }) => (m.case === 'update' ? m.value.participants.filter((p) => p.identity === 'S').map((p) => ({ t, s: p.state === 3 ? 'down' : 'up', kind: p.state === 3 ? `update DISCONNECTED/${P.DisconnectReason[p.disconnectReason]}` : 'update ACTIVE (new sid)', sid: p.sid })) : [])).filter((x) => x.s === 'down' || x.sid !== a.subject.sessions[0]), t0, tCut);
    L.B_obs_quality = layer(of.flatMap(({ t, m }) => (m.case === 'connectionQuality' ? m.value.updates.filter((u) => sids.has(u.participantSid)).map((u) => ({ t, s: u.quality === P.ConnectionQuality.EXCELLENT ? 'up' : 'down', kind: `quality ${P.ConnectionQuality[u.quality]}` })) : [])), t0, tCut);
    L.B_subject = layer(lkFrames(S).flatMap(({ t, m }) => (m.case === 'leave' ? [{ t, s: 'down', kind: `leave ${P.LeaveRequest_Action[m.value.action]}/${P.DisconnectReason[m.value.reason]}` }] : m.case === 'reconnect' ? [{ t, s: 'up', kind: 'reconnect response' }] : m.case === 'join' ? [{ t, s: 'up', kind: 'join response' }] : [])), t0, tCut);
  } else {
    serverComplete = serverComplete && ev.some((e) => e.body && e.body.type === 64 && e.body.event && e.body.event.data && e.body.event.data.event === 'joined' && e.body.event.data.room === r.room);
    const jt = (e) => e.body.timestamp / 1000 - sfuOff;
    const sess = new Set(a.subject.sessions.map(String));
    const mine = ev.filter((e) => e.body && sess.has(String(e.body.session_id)));
    const pubHandles = new Set(mine.filter((e) => e.body.type === 64 && e.body.event.data && e.body.event.data.id === 101).map((e) => e.body.handle_id));
    L.A_membership = layer(mine.filter((e) => e.body.type === 64 && pubHandles.has(e.body.handle_id) && ['leaving', 'kicked', 'unpublished', 'joined', 'published'].includes(e.body.event.data.event)).map((e) => ({ t: jt(e), s: ['joined', 'published'].includes(e.body.event.data.event) ? 'up' : 'down', kind: `plugin ${e.body.event.data.event}` }))
      .concat(mine.filter((e) => e.body.type === 1).map((e) => ({ t: jt(e), s: e.body.event.name === 'created' ? 'up' : 'down', kind: `session ${e.body.event.name}` }))), t0, tCut);
    L.A_media = layer(mine.filter((e) => e.body.type === 32 && pubHandles.has(e.body.handle_id) && typeof e.body.event.receiving === 'boolean').map((e) => ({ t: jt(e), s: e.body.event.receiving ? 'up' : 'down', kind: `media receiving=${e.body.event.receiving}` })), t0, tCut);
    const of = [O1, O2].filter(Boolean).flatMap(jFrames);
    L.B_obs_membership = layer(of.flatMap(({ t, m }) => { const pd = m.plugindata && m.plugindata.data; if (!pd) return []; const gone = [pd.leaving, pd.unpublished, pd.kicked].includes(101); const back = Array.isArray(pd.publishers) && pd.publishers.some((p) => p.id === 101); return gone ? [{ t, s: 'down', kind: pd.leaving === 101 ? 'leaving' : pd.kicked === 101 ? 'kicked' : 'unpublished' }] : back ? [{ t, s: 'up', kind: 'publishers' }] : []; }), t0, tCut);
    L.B_obs_quality = { kind: 'no such message', down: null, up: null };
    const sPub = new Set(S.frames.filter((f) => f.dir === 'out' && f.text && /"ptype":"publisher"/.test(f.text)).map((f) => JSON.parse(f.text).handle_id));
    L.B_subject = layer(jFrames(S).flatMap(({ t, m }) => (m.janus === 'media' && sPub.has(m.sender) ? [{ t, s: m.receiving ? 'up' : 'down', kind: `media receiving=${m.receiving}` }] : m.janus === 'timeout' ? [{ t, s: 'down', kind: 'timeout' }] : [])), t0, tCut);
  }
  // A_state: the participant-state API, polled at 1 s from an observer pod (same clock as S)
  const sp = rd(dir, 'state-poll.json');
  if (sp && sp.samples) {
    const first = a.subject.sessions[0];
    L.A_state = layer(sp.samples.filter((x) => !x.error).map((x) => {
      if (r.stack === 'livekit') { const p = x.parts.find((q) => q.identity === 'S'); return !p ? { t: x.t2, s: 'down', kind: 'absent' } : p.state !== 'ACTIVE' ? { t: x.t2, s: 'down', kind: `state ${p.state}` } : !p.tracks ? { t: x.t2, s: 'down', kind: 'no tracks' } : { t: x.t2, s: 'up', kind: p.sid === first ? 'ACTIVE (same sid)' : 'ACTIVE (new sid)' }; }
      const p = x.parts.find((q) => q.id === 101); return !p ? { t: x.t2, s: 'down', kind: 'absent' } : !p.publisher ? { t: x.t2, s: 'down', kind: 'not publishing' } : { t: x.t2, s: 'up', kind: 'publishing' };
    }), t0, tCut);
  } else L.A_state = { kind: 'not captured', down: null, up: null };
  // divergence per layer, against truth
  const D = {};
  for (const [k, l] of Object.entries(L)) {
    const out = truth.down != null && truth.up != null ? truth.up - truth.down : null;
    const blind = truth.down == null ? null : l.down == null ? out : Math.max(0, Math.min(l.down, truth.up ?? Infinity) - truth.down);
    D[k] = { ...l,
      onsetDelay: l.down != null && truth.down != null ? +(l.down - truth.down).toFixed(2) : null, // s from first stale media to first report
      blindS: blind != null ? +blind.toFixed(2) : null, //                                            stale time with no report yet
      blindFrac: blind != null && out ? +(blind / out).toFixed(2) : null,
      upError: l.up != null && truth.up != null ? +(l.up - truth.up).toFixed(2) : null, //            <0: reported back before media was fresh
    };
  }
  return { id: r.id, dir: path.basename(path.dirname(path.resolve(dir, 'x'))), stack: r.stack, mode: r.iso.mode, D: r.iso.plannedS, arm: r.arm, valid: r.valid, serverComplete, regime: a.regime.split(' ')[0], truth, layers: D };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const json = args[0] === '--json'; if (json) args.shift();
  const rows = [];
  for (const top of args) for (const d of fs.readdirSync(top).sort()) { const p = path.join(top, d); if (!fs.existsSync(path.join(p, 'result.json'))) continue; try { const x = divergence(p); if (x) rows.push({ ...x, set: path.basename(top) }); } catch (e) { console.error(`${p}: ${e.message}`); } }
  if (json) { console.log(JSON.stringify(rows)); } else {
    const f = (l) => (l.kind === 'nothing' ? 'nothing' : /^no such|^not captured/.test(l.kind) ? '-' : `${l.kind}@${l.down}${l.up != null ? `→${l.up}` : ''} blind=${l.blindS}${l.upError != null ? ` upErr=${l.upError}` : ''}`);
    for (const r of rows) console.log([r.set, r.stack, r.mode, `${r.D}s`, r.arm, r.regime, `truth ${r.truth.down}→${r.truth.up} stale=${r.truth.staleS}`, `A.memb: ${f(r.layers.A_membership)}`, `A.media: ${f(r.layers.A_media)}`, `A.state: ${f(r.layers.A_state)}`, `B.obs: ${f(r.layers.B_obs_membership)}`, `B.qual: ${f(r.layers.B_obs_quality)}`, `B.subj: ${f(r.layers.B_subject)}`, r.valid && r.serverComplete ? '' : 'EXCLUDE'].join(' | '));
  }
}
