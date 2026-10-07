// C4 adapter conformance: interface, mapping coverage, and replay of captured ground truth.
// usage: node adapters/conformance.mjs            (exit 0 = all adapters pass)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADAPTERS_DIR, CANONICAL, REQUIRED_METHODS, StackAdapter } from './base.mjs';

const STATUSES = new Set(['observed', 'docs-only', 'unsupported']);
let failures = 0;
const fail = (stack, msg) => { failures++; console.log(`  FAIL [${stack}] ${msg}`); };
const ok = (stack, msg) => console.log(`  ok   [${stack}] ${msg}`);

for (const stack of fs.readdirSync(ADAPTERS_DIR).filter((d) => fs.existsSync(path.join(ADAPTERS_DIR, d, 'adapter.mjs'))).sort()) {
  console.log(`\n== ${stack}`);
  const dir = path.join(ADAPTERS_DIR, stack);
  const { default: Adapter } = await import(pathToFileURL(path.join(dir, 'adapter.mjs')));
  const a = new Adapter({});
  // 1. interface
  for (const m of REQUIRED_METHODS) {
    if (typeof a[m] !== 'function' || a[m] === StackAdapter.prototype[m]) fail(stack, `method ${m} not implemented`);
  }
  ok(stack, `interface: ${REQUIRED_METHODS.length} methods checked`);
  // 2. mapping coverage
  const mp = a.mapping.events || {};
  const counts = { observed: 0, 'docs-only': 0, unsupported: 0 };
  for (const ev of Object.keys(CANONICAL.events)) {
    const e = mp[ev];
    if (!e) { fail(stack, `mapping missing canonical event ${ev}`); continue; }
    if (!STATUSES.has(e.status)) fail(stack, `${ev}: bad status ${e.status}`);
    else counts[e.status]++;
    if (e.status === 'unsupported' && !e.reason) fail(stack, `${ev}: unsupported without reason`);
    if (e.status !== 'unsupported' && !(e.native && e.native.length && e.evidence)) fail(stack, `${ev}: needs native[] and evidence`);
  }
  for (const k of Object.keys(mp)) if (!CANONICAL.events[k]) fail(stack, `mapping has non-canonical key ${k}`);
  ok(stack, `mapping: ${JSON.stringify(counts)} of ${Object.keys(CANONICAL.events).length} canonical events`);
  // 3. replay
  const rc = JSON.parse(fs.readFileSync(path.join(dir, 'replay-cases.json'), 'utf8'));
  for (const c of rc.cases) {
    let natives = [];
    if (c.sink) for (const l of fs.readFileSync(path.join(dir, c.sink), 'utf8').split('\n').filter(Boolean)) natives.push(...a.parseSinkRecord(JSON.parse(l)));
    if (c.client) {
      const lines = fs.readFileSync(path.join(dir, c.client), 'utf8').split('\n').filter(Boolean);
      for (const l of lines) natives.push(...a.parseClientRecord(c.clientFormat === 'jsonl' ? JSON.parse(l) : l));
    }
    const got = a.normalize(natives).filter((e) => (e.observer || 'server') === c.observer);
    const proj = (e) => [e.canonical, e.participantKey == null ? null : c.keyMode === 'identity' ? e.participantKey.split('/')[0] : e.participantKey];
    const g = got.map(proj), x = c.expected;
    const same = g.length === x.length && g.every((v, i) => v[0] === x[i][0] && v[1] === x[i][1]);
    if (!same) {
      fail(stack, `replay '${c.name}': sequence mismatch`);
      const n = Math.max(g.length, x.length);
      for (let i = 0; i < n; i++) { const a1 = JSON.stringify(x[i] || null), b1 = JSON.stringify(g[i] || null); console.log(`       ${a1 === b1 ? ' ' : '!'} expected ${a1.padEnd(50)} got ${b1}`); }
    } else ok(stack, `replay '${c.name}': ${g.length} canonical events match ground truth`);
    for (const id of c.assertDistinctSessions || []) {
      const sids = new Set(got.filter((e) => e.participantKey && e.participantKey.startsWith(id + '/')).map((e) => e.participantKey));
      if (sids.size < 2) fail(stack, `${id}: expected >=2 distinct sessions, got ${sids.size}`); else ok(stack, `${id}: ${sids.size} distinct sessions (rebuild = new sid)`);
    }
  }
}
console.log(`\n${failures ? `FAILED: ${failures} problem(s)` : 'ALL ADAPTERS CONFORM'}`);
process.exit(failures ? 1 : 0);
