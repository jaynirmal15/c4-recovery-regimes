// Server-log mining for the removal race, and the cohort accounting (read-only).
// usage (from the repository root, after `npm ci`): node client/runner/removal-race.mjs [outDir]
//
// Trial set: enumerated from the filesystem. Every directory under study/ and study-r2/ that holds a
// result.json is read; nothing is listed by name here. Each is then looked up in the dataset index
// (logs/study/divergence-final.json = the 215 retained; logs/study/divergence-all.json = run 1 as run).
//
// For each trial the script extracts, per stack, the timestamps the removal race needs, as logged:
//   LiveKit (server-livekit.log, the server's own millisecond timestamp, less the measured clock offset):
//     ICE disconnected / failed on S's publisher transport; every `leave` the server sent S; "participant
//     closing" for S's original participant ID (the removal); every reconnecting signal connection the
//     server started for S (receipt of a resume request) and how it was answered (reconnect = accepted,
//     leave = refused, with reason and action); the new participant's session start (the rebuild).
//   Janus (server-janus.log with the container runtime's timestamp; server-events.jsonl less the offset):
//     "Timeout expired for session" for S's original session (the removal); "Couldn't find any session"
//     (a request for a session that no longer exists); and from the client's own frames, each `claim`
//     and the reply to it. Janus does not log receipt of an accepted claim.
// Nothing is inferred: a timestamp that is not in the log is null, a log that does not cover the
// interval is flagged, and a trial whose records cannot settle the order is reported as such.
import fs from 'node:fs'; import path from 'node:path';
const outDir = process.argv[2] || 'logs/study/removal-race'; fs.mkdirSync(outDir, { recursive: true });
const rd = (d, f) => { const p = path.join(d, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const r3 = (x) => (x == null ? null : +x.toFixed(3));
const SETS = ['study', 'study-r2'];
const final = new Map(JSON.parse(fs.readFileSync('logs/study/divergence-final.json', 'utf8')).map((r) => [`${r.set}/${r.dir}`, r]));
const run1 = new Map(JSON.parse(fs.readFileSync('logs/study/divergence-all.json', 'utf8')).map((r) => [`${r.set || 'study'}/${r.dir}`, r]));

function livekit(dir, r, S, t0) {
  const off = (r.clock && r.clock.sfu && r.clock.sfu.offsetMs) || 0; const rel = (t) => r3((t - t0) / 1000);
  const p = path.join(dir, 'server-livekit.log'); const flags = [];
  if (!fs.existsSync(p)) return { flags: ['server log missing'] };
  let unparsed = 0, skew = 0; const rows = [];
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l) continue; const m = l.match(/^(\S+)\s+(\S+)\t(\w+)\t(\S+)\t(\S+)\t([^\t]*)\t?(.*)$/); if (!m) { unparsed++; continue; }
    let j = null; try { j = JSON.parse(m[7]); } catch { unparsed++; continue; }
    const tk = Date.parse(m[1]), tz = Date.parse(m[2]); if (Math.abs(tk - tz) > 1000) skew++; rows.push({ t: tz - off, msg: m[6], j }); }
  if (!rows.length) return { flags: ['server log empty'] };
  const first = rows[0].t, last = rows[rows.length - 1].t;
  const sRows = rows.filter((x) => x.j.participant === 'S');
  const pid0 = (S.log.filter((l) => l.type === 'lk_joined' && l.t < t0).pop() || {}).sid || null;
  // coverage: the log must start before isolation onset and run past the end of the client's last action
  const lastAct = Math.max(t0, ...S.driver.actions.map((a) => a.tEnd || a.tStart));
  if (first > t0) flags.push(`server log starts ${rel(first)} s after onset: earlier lines are not in the record`);
  if (last < lastAct) flags.push(`server log ends ${r3((lastAct - last) / 1000)} s before the client's last action ended`);
  if (skew) flags.push(`${skew} lines whose two timestamps differ by more than 1 s`);
  if (!pid0) flags.push('original participant ID not found in the client log');
  const after = sRows.filter((x) => x.t > t0);
  const ice = (st) => { const x = after.find((x) => x.msg === 'ice connection state change' && x.j.transport === 'PUBLISHER' && x.j.state === st && x.j.participantID === pid0); return x ? rel(x.t) : null; };
  const fails = after.filter((x) => x.msg === 'ice connection state change' && x.j.transport === 'PUBLISHER' && x.j.state === 'failed' && x.j.participantID === pid0).map((x) => rel(x.t));
  const leaves = after.filter((x) => x.msg === 'sending signal response' && x.j.response && x.j.response.leave).map((x) => ({ t: rel(x.t), reason: x.j.response.leave.reason, action: x.j.response.leave.action, conn: x.j.connID, pid: x.j.participantID }));
  const closings = after.filter((x) => x.msg === 'participant closing' && x.j.participantID === pid0).map((x) => ({ t: rel(x.t), reason: x.j.reason, isExpectedToResume: x.j.isExpectedToResume }));
  const removal = closings.find((c) => c.reason !== 'CLIENT_REQUEST_LEAVE') || null;
  const resumes = after.filter((x) => x.msg === 'starting signal connection' && x.j.participantInit && x.j.participantInit.Reconnect === true).map((x) => {
    const init = rows.find((y) => y.msg === 'sending initial response' && y.j.connID === x.j.connID); const err = rows.find((y) => y.msg === 'could not handle new participant' && y.j.connID === x.j.connID);
    const resp = init && init.j.response ? Object.keys(init.j.response)[0] : null;
    return { t: rel(x.t), conn: x.j.connID, reconnectReason: x.j.participantInit.ReconnectReason, answered: init ? rel(init.t) : null, answer: resp === 'reconnect' ? 'accepted' : resp === 'leave' ? 'refused' : resp || (err ? 'refused' : null), leave: resp === 'leave' ? init.j.response.leave : null, error: err ? err.j.error : null };
  });
  const rejoin = after.find((x) => x.msg === 'starting RTC session' && x.j.participantID && x.j.participantID !== pid0); const hooks = after.filter((x) => x.msg === 'sent webhook' && x.j.participantID === pid0 && x.j.event === 'participant_left').map((x) => rel(x.t));
  const cli = {
    // every signalling connection the client opened after onset, and the server's "starting signal connection" for it, if any within 1 s
    attempts: S.frames.filter((f) => f.dir === 'open' && f.t > t0).map((f) => { const srv = after.find((x) => x.msg === 'starting signal connection' && x.t >= f.t - 50 && x.t <= f.t + 1000); return { t: rel(f.t), serverReceipt: srv ? rel(srv.t) : null, reconnect: srv ? srv.j.participantInit.Reconnect : null }; }),
    actions: S.driver.actions.map((a) => ({ kind: a.kind, t: rel(a.tStart), end: a.tEnd ? rel(a.tEnd) : null, ok: !!(a.result && a.result.ok), refused: (a.result && a.result.refused) || null, detail: (a.result && a.result.detail) || null })),
    leaveFrames: S.log.filter((l) => l.type === 'lk_leave_frame' && l.t > t0).map((l) => ({ t: rel(l.t), action: l.action, reason: l.reason })),
  };
  return { flags, coverage: { first: rel(first), last: rel(last), lines: rows.length, unparsed }, pid0, iceDisconnected: ice('disconnected'), iceFailed: fails, leavesSent: leaves, removal, closings, resumes, rejoin: rejoin ? { t: rel(rejoin.t), pid: rejoin.j.participantID } : null, participantLeftWebhook: hooks, client: cli };
}

function janus(dir, r, S, t0) {
  const off = (r.clock && r.clock.sfu && r.clock.sfu.offsetMs) || 0; const rel = (t) => r3((t - t0) / 1000); const flags = [];
  const p = path.join(dir, 'server-janus.log'); if (!fs.existsSync(p)) return { flags: ['server log missing'] };
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { const m = l.match(/^(\S+)\s(.*)$/); return m ? { t: Date.parse(m[1]), s: m[2].replace(/\x1b\[[0-9;]*m/g, '') } : null; }).filter(Boolean);
  if (!lines.length) return { flags: ['server log empty'] };
  const sid0 = String((S.log.filter((l) => l.type === 'janus_session' && l.t < t0).pop() || {}).sid || '') || null;
  const lastAct = Math.max(t0, ...S.driver.actions.map((a) => a.tEnd || a.tStart));
  if (lines[0].t > t0) flags.push(`server log starts ${rel(lines[0].t)} s after onset: earlier lines are not in the record`);
  if (lines[lines.length - 1].t < lastAct) flags.push(`server log ends ${r3((lastAct - lines[lines.length - 1].t) / 1000)} s before the client's last action ended`);
  if (!sid0) flags.push('original session ID not found in the client log');
  const E = fs.readFileSync(path.join(dir, 'server-events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.body && e.body.type); const jt = (e) => e.body.timestamp / 1000 - off;
  const tl = lines.find((x) => x.t > t0 && x.s.includes(`Timeout expired for session ${sid0}`)); const te = E.find((e) => e.body.type === 1 && String(e.body.session_id) === sid0 && e.body.event.name === 'timeout' && jt(e) > t0);
  if (!!tl !== !!te) flags.push(`session timeout is in ${tl ? 'the log' : 'the events'} but not in ${tl ? 'the events' : 'the log'}`);
  if (tl && te && Math.abs(tl.t - jt(te)) > 250) flags.push(`session timeout: log and event timestamps differ by ${Math.round(Math.abs(tl.t - jt(te)))} ms`);
  const notFound = lines.filter((x) => x.t > t0 && x.s.includes(`Couldn't find any session ${sid0}`)).map((x) => rel(x.t));
  const fr = S.frames.filter((f) => f.text).map((f) => { try { return { t: f.t, dir: f.dir, m: JSON.parse(f.text) }; } catch { return null; } }).filter(Boolean);
  const reply = (tx, t) => fr.find((f) => f.dir === 'in' && f.m.transaction === tx && f.t >= t && f.m.janus !== 'ack');
  const claims = fr.filter((f) => f.dir === 'out' && f.m.janus === 'claim' && f.t > t0).map((f) => { const a = reply(f.m.transaction, f.t); return { t: rel(f.t), session: String(f.m.session_id), replied: a ? rel(a.t) : null, reply: a ? a.m.janus : null, error: a && a.m.error ? a.m.error : null }; });
  const ka = fr.filter((f) => f.dir === 'out' && f.m.janus === 'keepalive' && String(f.m.session_id) === sid0); const acked = ka.filter((f) => fr.some((g) => g.dir === 'in' && g.m.janus === 'ack' && g.m.transaction === f.m.transaction));
  const firstClaimT = (fr.find((f) => f.dir === 'out' && f.m.janus === 'claim' && f.t > t0) || {}).t ?? Infinity; const lastAckBefore = acked.filter((f) => f.t < Math.min(te ? jt(te) : Infinity, firstClaimT)).pop(); const kaDuring = acked.filter((f) => f.t > t0 && f.t < r.iso.restore.after).length;
  const creates = fr.filter((f) => f.dir === 'out' && f.m.janus === 'create' && f.t > t0).map((f) => rel(f.t));
  const wsConn = E.filter((e) => e.body.type === 128 && e.body.event.transport === 'janus.transport.websockets' && e.body.event.data && e.body.event.data.event === 'connected' && jt(e) > t0).map((e) => rel(jt(e)));
  const memb = E.filter((e) => e.body.type === 64 && e.body.event.data && e.body.event.data.id === 101 && ['leaving', 'unpublished'].includes(e.body.event.data.event) && jt(e) > t0).map((e) => ({ t: rel(jt(e)), event: e.body.event.data.event }));
  return { flags, coverage: { first: rel(lines[0].t), last: rel(lines[lines.length - 1].t), lines: lines.length }, sid0, lastKeepaliveAckedBeforeRemovalOrClaim: lastAckBefore ? rel(lastAckBefore.t) : null, keepalivesAckedDuringIsolation: kaDuring,
    removal: tl || te ? { tLog: tl ? rel(tl.t) : null, tEvent: te ? rel(jt(te)) : null, reason: 'session timeout' } : null, sessionNotFoundLogged: notFound, claims, newSessionCreates: creates, websocketConnectedEvents: wsConn, membershipEvents: memb,
    client: { actions: S.driver.actions.map((a) => ({ kind: a.kind, t: rel(a.tStart), end: a.tEnd ? rel(a.tEnd) : null, ok: !!(a.result && a.result.ok), refused: (a.result && a.result.refused) || null, detail: (a.result && a.result.detail) || null })), wsOpens: S.frames.filter((f) => f.dir === 'open' && f.t > t0).map((f) => rel(f.t)) } };
}

/** Order test. The race predicts: the session is rebuilt if and only if the server removed the participant
 *  before a resumption request reached it, and that request was then refused. */
function verdictLivekit(x, rebuilt) {
  const hard = x.flags.filter((f) => /missing|empty|starts .* after onset|ends .* before|not found/.test(f)); const rm = x.removal;
  if (!x.resumes || hard.length) return { verdict: 'cannot settle', why: x.flags.join('; ') + (x.resumes && rm ? ` (the part of the log that exists shows a removal at ${rm.t} s)` : '') };
  const before = rm ? x.resumes.filter((q) => q.t < rm.t) : x.resumes; const afterRm = rm ? x.resumes.filter((q) => q.t >= rm.t) : [];
  const lastFail = x.iceFailed.length ? x.iceFailed.filter((f) => !rm || f <= rm.t).pop() : null; const inWindow = rm && lastFail != null ? before.filter((q) => q.t > lastFail) : [];
  if (rebuilt) {
    if (!rm) return { verdict: hard.length ? 'cannot settle' : 'orders the other way', why: hard.length ? hard.join('; ') : 'rebuilt, but no removal of the original participant is logged' };
    if (inWindow.some((q) => q.answer === 'accepted')) return { verdict: 'orders the other way', why: `a resume was accepted at ${inWindow.find((q) => q.answer === 'accepted').t} s, after the ICE failure at ${lastFail} s, and the participant was still removed at ${rm.t} s` };
    if (afterRm.some((q) => q.answer === 'accepted')) return { verdict: 'orders the other way', why: 'a resume was accepted after the removal' };
    if (!afterRm.length) return { verdict: hard.length ? 'cannot settle' : 'as predicted, without a logged refusal', why: 'removal logged; no resume request reached the server afterwards in this log' };
    return { verdict: 'as predicted', why: `removed at ${rm.t} s (${rm.reason}); first resume request after that at ${afterRm[0].t} s, ${afterRm[0].answer}${afterRm[0].leave ? ` ${afterRm[0].leave.reason}/${afterRm[0].leave.action}` : ''}` };
  }
  if (rm) return { verdict: 'orders the other way', why: `survived, but the original participant was removed at ${rm.t} s` };
  if (hard.length) return { verdict: 'cannot settle', why: hard.join('; ') };
  if (!x.iceFailed.length) return { verdict: 'no race', why: 'the server never reported ICE failure for S, so no removal was pending' };
  const acc = x.resumes.filter((q) => q.answer === 'accepted' && q.t > x.iceFailed[x.iceFailed.length - 1]);
  if (!acc.length) return { verdict: 'orders the other way', why: 'ICE failed on the server, no resume was accepted afterwards, and the participant was not removed' };
  return { verdict: 'as predicted', why: `ICE failed at ${x.iceFailed[x.iceFailed.length - 1]} s; resume request received at ${acc[0].t} s and accepted; no removal`, margin: r3(acc[0].t - x.iceFailed[x.iceFailed.length - 1]) };
}
function verdictJanus(x, rebuilt) {
  const hard = x.flags.filter((f) => /missing|empty|starts .* after onset|ends .* before|not found|but not in/.test(f)); const rm = x.removal; const tR = rm ? (rm.tEvent ?? rm.tLog) : null;
  if (!x.claims || hard.length) return { verdict: 'cannot settle', why: x.flags.join('; ') };
  const ok = x.claims.filter((c) => c.reply === 'success'), bad = x.claims.filter((c) => c.reply === 'error');
  if (rebuilt) {
    if (!rm) return { verdict: hard.length ? 'cannot settle' : 'orders the other way', why: hard.length ? hard.join('; ') : 'rebuilt, but no session timeout is logged' };
    if (ok.some((c) => c.t < tR)) return { verdict: 'orders the other way', why: 'a claim succeeded before the session timed out, and the session was still removed' };
    if (ok.some((c) => c.t >= tR)) return { verdict: 'orders the other way', why: 'a claim succeeded after the session timed out' };
    if (!bad.length) return { verdict: hard.length ? 'cannot settle' : 'as predicted, without a logged refusal', why: 'timeout logged; no claim was answered with an error in the client frames' };
    return { verdict: 'as predicted', why: `session timed out at ${tR} s; first claim after that at ${bad[0].t} s, refused ${bad[0].error ? `${bad[0].error.code} ${bad[0].error.reason}` : ''}; server logged "Couldn't find any session" at ${x.sessionNotFoundLogged.join(', ') || 'no time'}` };
  }
  if (rm) return { verdict: 'orders the other way', why: `survived, but the original session timed out at ${tR} s` };
  if (hard.length) return { verdict: 'cannot settle', why: hard.join('; ') };
  if (!x.claims.length) return { verdict: 'no race', why: `no claim was needed: ${x.keepalivesAckedDuringIsolation} keepalives were acknowledged during the isolation, or the connection outlived it` };
  if (!ok.length) return { verdict: 'orders the other way', why: 'survived without a successful claim although claims were sent' };
  return { verdict: 'as predicted', why: `claim at ${ok[0].t} s succeeded; no session timeout`, sinceLastKeepalive: x.lastKeepaliveAckedBeforeRemovalOrClaim != null ? r3(ok[0].t - x.lastKeepaliveAckedBeforeRemovalOrClaim) : null };
}

// ---- walk the trial directories
const rows = []; const cohort = { sets: {}, rules: [
  'A trial is a directory with a result.json written by the runner. A trial is valid if the runner recorded no invalidation (result.valid).',
  'Retained = valid trials of study run 1 (study/) except the four LiveKit media-only conditions at 23, 26, 28 and 30 s, plus every valid trial of run 2 (study-r2/).',
  'Superseded = the valid run-1 trials of those four conditions: run with the client before the dropped-resume-request fix and re-run in run 2 with it.',
] };
for (const set of SETS) {
  const all = fs.readdirSync(set).filter((d) => fs.statSync(path.join(set, d)).isDirectory()).sort(); const acc = cohort.sets[set] = { directories: all.length, withResult: 0, withoutResult: [], valid: 0, invalid: [], retained: 0, superseded: 0, notInIndex: [], byStack: {} };
  for (const d of all) {
    const dir = path.join(set, d); const r = rd(dir, 'result.json'); if (!r) { acc.withoutResult.push(d); continue; }
    acc.withResult++; if (r.valid) acc.valid++; else acc.invalid.push({ id: r.id, why: r.invalid });
    const key = `${set}/${d}`; const idx = final.get(key) || null; const idx1 = run1.get(key) || null; const cls = idx ? 'retained' : idx1 ? 'superseded' : 'not in index';
    if (cls === 'retained') acc.retained++; else if (cls === 'superseded') acc.superseded++; else acc.notInIndex.push(d);
    acc.byStack[r.stack] = acc.byStack[r.stack] || { retained: 0, superseded: 0 }; if (cls !== 'not in index') acc.byStack[r.stack][cls]++;
    if (!r.iso) continue;
    const S = rd(dir, 'S.json'); const t0 = r.iso.onset.after; const regime = (idx || idx1 || {}).regime || null; const rebuilt = regime === 'R2';
    const x = r.stack === 'livekit' ? livekit(dir, r, S, t0) : janus(dir, r, S, t0);
    const v = regime == null ? { verdict: 'cannot settle', why: 'trial is not in the dataset index, so its outcome is not classified' } : r.stack === 'livekit' ? verdictLivekit(x, rebuilt) : verdictJanus(x, rebuilt);
    rows.push({ set, dir: d, id: r.id, stack: r.stack, mode: r.iso.mode, D: r.iso.plannedS, valid: r.valid, cohort: cls, regime, restore: r3((r.iso.restore.after - t0) / 1000), ...v, log: x });
  }
}
// every other directory of records in the repository, enumerated the same way, for the accounting only
cohort.otherRecordDirectories = {};
for (const top of fs.readdirSync('.').filter((d) => !SETS.includes(d) && !d.startsWith('.') && d !== 'node_modules' && fs.statSync(d).isDirectory()).sort()) {
  const subs = fs.readdirSync(top).filter((d) => fs.existsSync(path.join(top, d, 'result.json'))); if (!subs.length) continue;
  const rs = subs.map((d) => rd(path.join(top, d), 'result.json')); const why = {}; for (const r of rs.filter((r) => !r.valid)) for (const w of r.invalid || ['(no reason recorded)']) { const k = String(w).replace(/[\d.]+ ?(ms|s)\b/g, 'N $1').replace(/\d+/g, 'N').slice(0, 90); why[k] = (why[k] || 0) + 1; }
  cohort.otherRecordDirectories[top] = { records: rs.length, valid: rs.filter((r) => r.valid).length, invalid: rs.filter((r) => !r.valid).length, isolationTrials: rs.filter((r) => r.iso).length, byStack: rs.reduce((m, r) => ((m[r.stack] = (m[r.stack] || 0) + 1), m), {}), invalidReasons: why };
}
// what the study runner itself recorded: planned order, attempts and valid trials per condition, and precondition aborts
cohort.runner = {};
for (const set of SETS) for (const fn of fs.readdirSync(set).filter((x) => /^progress-.*\.json$/.test(x))) { const p = rd(set, fn); const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const order = fs.readFileSync(path.join(set, fn.replace('progress-', 'order-').replace('.json', '.jsonl')), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  cohort.runner[`${set}/${fn}`] = { conditions: Object.keys(p.have).length, tried: sum(p.tried), valid: sum(p.have), replaced: sum(p.tried) - sum(p.have), remaining: p.remaining, launches: order.length, plannedPerLaunch: order.map((o) => o.planned.length) }; }
cohort.abortLogs = Object.fromEntries(fs.readdirSync('logs').filter((x) => /^aborts.*\.log$/.test(x)).map((x) => [x, fs.readFileSync(path.join('logs', x), 'utf8').split('\n').filter(Boolean).length]));
cohort.studyJobLogAbortLines = Object.fromEntries(fs.readdirSync('logs/study').filter((x) => /^session.*\.log$/.test(x)).map((x) => [x, fs.readFileSync(path.join('logs/study', x), 'utf8').split('\n').filter((l) => /abort/i.test(l)).length]));
for (const stack of ['livekit', 'janus']) fs.writeFileSync(path.join(outDir, `${stack}.json`), JSON.stringify(rows.filter((r) => r.stack === stack), null, 1));
fs.writeFileSync(path.join(outDir, 'cohort.json'), JSON.stringify(cohort, null, 1));

// ---- report
const rng = (v) => (v.length ? `${Math.min(...v)}–${Math.max(...v)}` : '–'); const out = [];
const tally = (xs, key) => JSON.stringify(xs.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {}));
out.push('# Removal race from the server logs, and cohort accounting', '', `Generated by client/runner/removal-race.mjs. Trial set enumerated from the directories ${SETS.join(' and ')}.`, '');
out.push('## Cohort', ''); for (const [set, a] of Object.entries(cohort.sets)) out.push(`- ${set}: ${a.directories} directories, ${a.withResult} with a result.json (${a.withoutResult.length} without), ${a.valid} valid, ${a.invalid.length} invalid; ${a.retained} retained, ${a.superseded} superseded, ${a.notInIndex.length} not in the index; by stack ${JSON.stringify(a.byStack)}`);
out.push('', 'Rules: ' + cohort.rules.join(' '), '', '| Runner record | Conditions | Tried | Valid | Replaced | Remaining | Launches |', '|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(cohort.runner)) out.push(`| ${k} | ${v.conditions} | ${v.tried} | ${v.valid} | ${v.replaced} | ${v.remaining} | ${v.launches} (${v.plannedPerLaunch.join(', ')} planned) |`);
out.push('', `Precondition aborts in the study job logs: ${JSON.stringify(cohort.studyJobLogAbortLines)}. Abort logs elsewhere (development runs): ${JSON.stringify(cohort.abortLogs)}.`, '', 'Other record directories (not part of the 215):', '', '| Directory | Records | Valid | Invalid | Isolation trials | By stack |', '|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(cohort.otherRecordDirectories)) out.push(`| ${k}/ | ${v.records} | ${v.valid} | ${v.invalid} | ${v.isolationTrials} | ${JSON.stringify(v.byStack)} |`);
for (const stack of ['livekit', 'janus']) {
  const g = rows.filter((r) => r.stack === stack);
  out.push('', `## ${stack === 'livekit' ? 'LiveKit' : 'Janus'}`, '');
  for (const cls of ['retained', 'superseded']) {
    const h = g.filter((r) => r.cohort === cls); if (!h.length) continue;
    out.push(`### ${cls} (${h.length} trials)`, '', '| Outcome | Trials | as predicted | as predicted, no logged refusal | no race | orders the other way | cannot settle |', '|---|---|---|---|---|---|---|');
    for (const [name, f] of [['rebuilt', (r) => r.regime === 'R2'], ['survived', (r) => r.regime !== 'R2']]) { const k = h.filter(f); const c = (v) => k.filter((r) => r.verdict === v).length; out.push(`| ${name} | ${k.length} | ${c('as predicted')} | ${c('as predicted, without a logged refusal')} | ${c('no race')} | ${c('orders the other way')} | ${c('cannot settle')} |`); }
    out.push('');
    const reb = h.filter((r) => r.regime === 'R2' && r.log.removal);
    if (stack === 'livekit') {
      const d1 = reb.map((r) => { const f = r.log.iceFailed.filter((t) => t <= r.log.removal.t).pop(); return f != null ? r3(r.log.removal.t - f) : null; }).filter((x) => x != null);
      out.push(`- Removal in rebuilt trials: at ${rng(reb.map((r) => r.log.removal.t))} s after onset; reasons ${tally(reb, (r) => r.log.removal.reason)}; ${rng(d1)} s after the last server-side ICE failure (${d1.length} trials with both).`);
      const ref = reb.map((r) => r.log.resumes.find((q) => q.t >= r.log.removal.t)).filter(Boolean);
      out.push(`- First resume request received after the removal: ${ref.length} trials, ${rng(reb.filter((r) => r.log.resumes.some((q) => q.t >= r.log.removal.t)).map((r) => r3(r.log.resumes.find((q) => q.t >= r.log.removal.t).t - r.log.removal.t)))} s after it; answers ${tally(ref, (q) => q.answer + (q.leave ? ` ${q.leave.reason}/${q.leave.action}` : ''))}.`);
      const att = h.filter((r) => r.log.client).flatMap((r) => r.log.client.attempts.map((a) => ({ ...a, r }))); const got = att.filter((a) => a.serverReceipt != null);
      out.push(`- Client signalling connections opened after onset: ${att.length}; with a server receipt within 1 s: ${got.length} (${rng(got.map((a) => r3(a.serverReceipt - a.t)))} s later); with none: ${att.length - got.length}, of which ${att.filter((a) => a.serverReceipt == null && a.t < a.r.restore).length} were opened while the isolation was in force.`);
      const ans = h.filter((r) => r.log.resumes).flatMap((r) => r.log.resumes); out.push(`- Resume requests received by the server: ${ans.length}; answered ${tally(ans, (q) => q.answer + (q.leave ? ` ${q.leave.reason}/${q.leave.action}` : ''))}; receipt to answer ${rng(ans.filter((q) => q.answered != null).map((q) => r3(q.answered - q.t)))} s.`);
      const sv = h.filter((r) => r.regime !== 'R2' && r.verdict === 'as predicted'); out.push(`- Survived with a race: resume received ${rng(sv.map((r) => r.margin))} s after the last server-side ICE failure (${sv.length} trials).`);
    } else {
      out.push(`- Session timeout in rebuilt trials: at ${rng(reb.map((r) => r.log.removal.tEvent ?? r.log.removal.tLog))} s after onset; ${rng(reb.filter((r) => r.log.lastKeepaliveAckedBeforeRemovalOrClaim != null).map((r) => r3((r.log.removal.tEvent ?? r.log.removal.tLog) - r.log.lastKeepaliveAckedBeforeRemovalOrClaim)))} s after the last acknowledged keepalive.`);
      const ref = reb.map((r) => r.log.claims.find((c) => c.reply === 'error')).filter(Boolean); out.push(`- First refused claim: ${ref.length} trials; errors ${tally(ref, (c) => (c.error ? `${c.error.code} ${c.error.reason.replace(/\d{6,}/, '<session>')}` : 'none'))}.`);
      const cl = h.flatMap((r) => r.log.claims.map((c) => ({ ...c, r }))); out.push(`- Claims sent by the client: ${cl.length}; replies ${tally(cl, (c) => c.reply || 'none')}; sent to reply ${rng(cl.filter((c) => c.replied != null).map((c) => r3(c.replied - c.t)))} s. Client websocket opens after onset: ${h.reduce((n, r) => n + r.log.client.wsOpens.length, 0)}, of which ${h.reduce((n, r) => n + r.log.client.wsOpens.filter((t) => t < r.restore).length, 0)} while the isolation was in force.`);
      const sv = h.filter((r) => r.regime !== 'R2' && r.verdict === 'as predicted'); out.push(`- Survived with a claim: claim sent ${rng(sv.map((r) => r.sinceLastKeepalive).filter((x) => x != null))} s after the last acknowledged keepalive (${sv.length} trials).`);
    }
    out.push('');
    for (const v of ['orders the other way', 'cannot settle', 'as predicted, without a logged refusal']) { const k = h.filter((r) => r.verdict === v); if (!k.length) continue; out.push(`**${v}: ${k.length}**`, ''); for (const r of k) out.push(`- \`${r.set}/${r.dir}\` (${r.mode === 'all' ? 'full' : 'media-only'} ${r.D} s, ${r.regime === 'R2' ? 'rebuilt' : 'survived'}): ${r.why}`); out.push(''); }
    const fl = h.filter((r) => r.log.flags.length); out.push(`Flags raised on ${fl.length} of ${h.length} trials: ${tally(fl.flatMap((r) => r.log.flags.map((f) => f.replace(/[\d.]+ s/g, 'N s').replace(/\d+ lines/, 'N lines'))), (f) => f)}`, '');
    const cell = {}; for (const r of h) { const k = `${r.mode === 'all' ? 'full' : 'media-only'} ${r.D} s`; cell[k] = cell[k] || {}; cell[k][r.verdict] = (cell[k][r.verdict] || 0) + 1; }
    out.push('By condition: ' + Object.entries(cell).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => `${k}: ${Object.entries(v).map(([a, n]) => `${a} ${n}`).join(', ')}`).join(' | '), '');
  }
}
fs.writeFileSync(path.join(outDir, 'REPORT.md'), out.join('\n') + '\n'); console.log(out.join('\n'));
