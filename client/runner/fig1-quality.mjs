// Connection-quality updates for S in the two trials drawn in the paper's Fig. 1, decoded from the
// observers' raw signalling frames. Output: logs/study/fig1-quality-states.json, which
// paper/fig1_reversal.py reads to check the quality sub-states it draws.
// usage (from the repository root, after `npm ci`): node client/runner/fig1-quality.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('@livekit/protocol');
const TRIALS = { before: 'study/livekit-iso-media-23s-O-20261002T053228-4', after: 'study-r2/livekit-iso-media-23s-O-20261002T161609-20' };
const out = {};
for (const [key, dir] of Object.entries(TRIALS)) {
  const res = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8')); const t0 = res.iso.onset.after;
  const S = JSON.parse(fs.readFileSync(`${dir}/S.json`, 'utf8')); const sids = [...new Set(S.log.filter((e) => e.type === 'lk_joined').map((e) => e.sid))];
  const left = (S.driver.history.find((h) => h.state === 'left') || {}).t; const tCut = left - 500;
  out[key] = { trial: dir, observers: {} };
  for (const w of ['O1', 'O2']) { const O = JSON.parse(fs.readFileSync(`${dir}/${w}.json`, 'utf8')); const ups = [];
    for (const f of O.frames) { if (f.dir !== 'in' || !f.b64 || f.t <= t0 || f.t >= tCut) continue; let m; try { m = P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message; } catch { continue; }
      if (m.case !== 'connectionQuality') continue;
      for (const u of m.value.updates) if (sids.includes(u.participantSid)) ups.push({ t: +((f.t - t0) / 1000).toFixed(2), quality: P.ConnectionQuality[u.quality], newSession: u.participantSid !== sids[0] }); }
    out[key].observers[w] = ups; }
}
fs.writeFileSync('logs/study/fig1-quality-states.json', JSON.stringify(out, null, 1) + '\n');
for (const [k, v] of Object.entries(out)) console.log(k, v.observers.O1.map((u) => `${u.t}:${u.quality}${u.newSession ? '(new session)' : ''}`).join('  '));
