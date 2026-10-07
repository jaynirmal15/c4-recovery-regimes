// Aggregate shakedown trials per cell. usage (after `npm ci` at the repo root): node cells.mjs <dir>
import fs from 'node:fs'; import path from 'node:path'; import { analyze } from './analyze.mjs';
const dir = process.argv[2]; const A = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'result.json'))).map((d) => analyze(path.join(dir, d))).filter((a) => a.test === 'isolation');
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const rng = (xs) => { const s = xs.filter((x) => x != null); return s.length ? `${Math.min(...s).toFixed(1)}–${Math.max(...s).toFixed(1)}` : '—'; };
const cells = {};
for (const a of A) { const k = `${a.stack}|${a.iso.mode}|${a.iso.plannedS}|${a.arm}`; (cells[k] = cells[k] || []).push(a); }
console.log('stack   | mode  |  D  | arm | n | regime(s)            | fresh-from-restore s (range) | stale@obs s (median) | server      | observers        | actual D s');
for (const k of Object.keys(cells).sort()) {
  const xs = cells[k]; const [stack, mode, D, arm] = k.split('|');
  const reg = Object.entries(xs.reduce((m, a) => (m[a.regime.slice(0, 2)] = (m[a.regime.slice(0, 2)] || 0) + 1, m), {})).map(([r, n]) => `${r}×${n}`).join(' ');
  console.log(`${stack.padEnd(7)} | ${mode.padEnd(5)} | ${D.padStart(2)}s | ${arm}   | ${xs.length} | ${reg.padEnd(20)} | ${rng(xs.map((a) => a.freshness.recovered_from_restore)).padEnd(28)} | ${String(med(xs.map((a) => Math.max(...a.freshness.staleMsAtObservers) / 1000))).padEnd(20)} | ${[...new Set(xs.map((a) => a.serverLabel))].join('/').padEnd(11)} | ${[...new Set(xs.flatMap((a) => Object.values(a.observerLabel)))].join('/').padEnd(16)} | ${rng(xs.map((a) => a.iso.actualS))}`);
}
console.log(`\nvalid ${A.filter((a) => a.valid).length}/${A.length}; violations ${A.reduce((n, a) => n + a.subject.violations.length, 0)}; detection s: ${rng(A.map((a) => a.subject.detected))}; server requests seen (LiveKit): ${A.filter((a) => a.subject.serverRequests.length).length} trials`);
