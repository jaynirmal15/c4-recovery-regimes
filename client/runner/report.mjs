// Targeted-test report: analyze every trial, check each test's EXPECTED behaviour explicitly.
// usage (after `npm ci` at the repo root): node report.mjs [trialsDir] [abortsLog]
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from './analyze.mjs';

const GATE = process.argv.includes('--gate');
const dir = process.argv[2] || 'trials';
const trials = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'result.json'))).sort();
const A = trials.map((d) => analyze(path.join(dir, d)));

const has = (xs, f) => (xs || []).some(f);
const EXPECT = {
  healthy_rebuild: (a) => ({
    'trial valid': a.valid,
    'rebuild action ok, new session': has(a.subject.actions, (x) => x.kind === 'rebuild' && x.ok) && a.subject.sessions.length > 1,
    'no server-initiated terminal/request needed': !a.subject.terminals.length,
    ...(a.stack === 'livekit'
      ? { 'server evicted old sid DUPLICATE_IDENTITY': has(a.server, (x) => x.event === 'participant_left' && x.reason === 'DUPLICATE_IDENTITY'),
          'observers saw S under the new sid': Object.values(a.observers).every((ev) => has(ev, (e) => e.sid === a.subject.sessions[a.subject.sessions.length - 1] && e.state === 'ACTIVE')),
          'EXPECTATION(source reading): observers saw old sid DISCONNECTED(DUPLICATE_IDENTITY)': Object.values(a.observers).every((ev) => has(ev, (e) => e.state === 'DISCONNECTED' && e.reason === 'DUPLICATE_IDENTITY')) }
      : { 'Janus refused same feed id (436) before accepting': has(a.subject.actions, (x) => x.kind === 'rebuild' && x.refused === 'join/436'),
          'observers saw leaving then publisher again': Object.values(a.observers).every((ev) => has(ev, (e) => e.event === 'leaving') && has(ev, (e) => e.event === 'publisher')) }),
    'block-first applied before the drop': a.subject.blockFirst.length > 0 && a.subject.blockFirst.every((b) => b.ok && b.ports > 0),
    ...(a.stack === 'janus' ? { 'no goodbye leaked: observers NOT told unpublished within 1 s': Object.values(a.observers).every((ev) => !ev.some((e) => e.event === 'unpublished' && e.t >= 0 && e.t < 1)) } : {}),
    'regime R2 rebuild': a.regime === 'R2 rebuild',
  }),
  isolation: (a) => ({
    'trial valid': a.valid,
    'classifiable by the rubric': /^R[0-3] /.test(a.regime),
    'isolation held for the planned duration (±0.25 s)': a.iso && Math.abs(a.iso.actualS - a.iso.plannedS) <= 0.25,
    'observers agree': a.observerLabel && new Set(Object.values(a.observerLabel)).size === 1,
  }),
  remove_participant: (a) => ({
    'trial valid': a.valid,
    'DISCONNECT delivered (PARTICIPANT_REMOVED)': has(a.subject.terminals, (x) => x.reason === 'PARTICIPANT_REMOVED'),
    'driver went straight to rebuild': a.subject.actions.length > 0 && a.subject.actions[0].kind === 'rebuild',
    'rebuild ok, new session': has(a.subject.actions, (x) => x.kind === 'rebuild' && x.ok) && a.subject.sessions.length > 1,
    'regime R2 rebuild': a.regime === 'R2 rebuild',
  }),
  intruder: (a) => ({
    'trial valid': a.valid,
    'DISCONNECT delivered (DUPLICATE_IDENTITY)': has(a.subject.terminals, (x) => x.reason === 'DUPLICATE_IDENTITY'),
    'driver went straight to rebuild': a.subject.actions.length > 0 && a.subject.actions[0].kind === 'rebuild',
    'rebuild ok, new session': has(a.subject.actions, (x) => x.kind === 'rebuild' && x.ok) && a.subject.sessions.length > 1,
    'intruder evicted in turn (raw frames)': a.intruder && (has(a.intruder.terminals, (x) => x.reason === 'DUPLICATE_IDENTITY') || has(a.intruder.leaveFrames, (x) => x.action === 'DISCONNECT' && x.reason === 'DUPLICATE_IDENTITY')),
    'regime R2 rebuild': a.regime === 'R2 rebuild',
  }),
  kick: (a) => ({
    'trial valid': a.valid,
    'kick delivered': has(a.subject.terminals, (x) => x.reason === 'kicked'),
    'driver went straight to rebuild': a.subject.actions.length > 0 && a.subject.actions[0].kind === 'rebuild',
    'rebuild ok, new session': has(a.subject.actions, (x) => x.kind === 'rebuild' && x.ok) && a.subject.sessions.length > 1,
    'regime R2 rebuild': a.regime === 'R2 rebuild',
  }),
  rogue: (a) => ({
    'planted reconnect caught as violation': a.subject.violations.length > 0,
    'trial marked INVALID': a.valid === false,
    'invalidation cites the violation': (a.invalid || []).some((x) => x.includes('violation')),
  }),
};

const rows = [];
for (const a of A) {
  const checks = EXPECT[a.test] ? EXPECT[a.test](a) : {};
  // EXPECTATION(...) checks are server-behaviour predictions: a mismatch is a FINDING, not a harness failure.
  const pass = Object.entries(checks).filter(([k]) => !k.startsWith('EXPECTATION')).every(([, v]) => Boolean(v));
  rows.push({ a, checks, pass });
  console.log(`\n=== ${a.id}  ${pass ? 'PASS' : 'FAIL'}`);
  for (const [k, v] of Object.entries(checks)) console.log(`   ${v ? 'ok  ' : k.startsWith('EXPECTATION') ? 'DIFF' : 'FAIL'} ${k}`);
  console.log(`   regime: ${a.regime} | sessions: ${a.subject.sessions.join(' -> ')}`);
  console.log(`   actions: ${a.subject.actions.map((x) => `${x.kind}@${x.t}s ${x.ok ? 'ok' : x.refused || x.detail || 'fail'} (${x.dur}s)`).join(' ; ') || 'none'}`);
  if (a.subject.terminals.length) console.log(`   terminals: ${JSON.stringify(a.subject.terminals)}`);
  if (a.subject.violations.length) console.log(`   violations: ${JSON.stringify(a.subject.violations)}`);
  if (a.iso) console.log(`   isolation: ${a.iso.mode} planned ${a.iso.plannedS}s actual ${a.iso.actualS}s | detected@${a.subject.detected}s | gaveUp=${a.subject.gaveUp} | server=${a.serverLabel} | observers=${JSON.stringify(a.observerLabel)} | requests=${JSON.stringify(a.subject.serverRequests)}`);
  if (a.freshness) console.log(`   freshness: fromRestore=${a.freshness.recovered_from_restore}s recovered_t=${a.freshness.recovered_t}s observersFreshAgain=${JSON.stringify(a.freshness.observersFreshAgain)} staleMs@obs=${JSON.stringify(a.freshness.staleMsAtObservers)} subjectFreshFrom=${JSON.stringify(a.freshness.subjectFreshFrom)}`);
  console.log(`   server: ${JSON.stringify(a.server).slice(0, 400)}`);
  for (const [k, ev] of Object.entries(a.observers)) console.log(`   ${k} saw: ${JSON.stringify(ev).slice(0, 400)}`);
  if (a.intruder) console.log(`   intruder: ${JSON.stringify(a.intruder)}`);
  if (!a.valid) console.log(`   invalid: ${JSON.stringify(a.invalid)}`);
}
console.log('\n=== SUMMARY');
const by = {};
for (const r of rows) { const k = `${r.a.stack}/${r.a.test}`; by[k] = by[k] || { n: 0, pass: 0 }; by[k].n++; if (r.pass) by[k].pass++; }
for (const [k, v] of Object.entries(by)) console.log(`   ${k.padEnd(32)} ${v.pass}/${v.n} pass`);
const ab = process.argv[3] && fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
console.log(`   aborts logged: ${ab.length}${ab.length ? ' -> ' + ab.map((x) => `${x.trial}: ${x.failed.join('; ')}`).join(' || ') : ''}`);
// ---- shakedown cell table (isolation trials) ----
const iso = rows.filter((r) => r.a.test === 'isolation');
if (iso.length) {
  console.log('\n=== SHAKEDOWN CELLS (stack | arm | mode | D | regime | detect | recovered-from-restore | stale@obs | server | observers | actions)');
  for (const { a } of iso.sort((x, y) => `${x.a.stack}${x.a.arm}${x.a.iso.mode}${String(x.a.iso.plannedS).padStart(3)}`.localeCompare(`${y.a.stack}${y.a.arm}${y.a.iso.mode}${String(y.a.iso.plannedS).padStart(3)}`)))
    console.log(`   ${a.stack.padEnd(8)} ${a.arm} ${a.iso.mode.padEnd(5)} ${String(a.iso.plannedS).padStart(2)}s | ${(a.valid ? a.regime : 'INVALID').padEnd(22)} | ${String(a.subject.detected).padStart(6)} | ${String(a.freshness ? a.freshness.recovered_from_restore : null).padStart(7)} | ${JSON.stringify(a.freshness ? a.freshness.staleMsAtObservers : null).padEnd(15)} | ${String(a.serverLabel).padEnd(11)} | ${[...new Set(Object.values(a.observerLabel || {}))].join('/').padEnd(16)} | ${a.subject.actions.map((x) => `${x.kind === 'rebuild' ? 'RB' : 'TR'}@${x.t}${x.ok ? '+' : x.refused ? '!' + x.refused : '-'}`).join(' ')}${a.valid ? '' : ' || ' + a.invalid.join('; ').slice(0, 120)}`);
}
if (GATE) { const bad = rows.filter((r) => !r.pass); console.log(`\nGATE: ${bad.length ? 'FAIL (' + bad.map((r) => r.a.id).join(', ') + ')' : 'PASS'}`); process.exit(bad.length ? 1 : 0); }
