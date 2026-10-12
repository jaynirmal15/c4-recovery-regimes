// Does the corrected-decoder build's reject path execute in a browser? (local test; no lab, no SFU, no network media)
// usage, from the repository root:
//   C4_PLAYWRIGHT=<path to a node_modules holding playwright 1.62.1> node client/runner/decoder-reject-livetest.mjs > logs/study/decoder/reject-livetest.txt
// It serves client/builds/common.js.corrected-decoder to headless Chromium launched as the client pods launch it, builds a
// second chirp generator from the build's own worklet, loops its track into the build's own attachRemote (the decoder under
// test), and then steps the generator's encoded sender time:
//   back by 2 s for 0.6 s (the shape of the recorded older-direction slip), then normal,
//   forward by 2 s for 0.6 s (the shape of the recorded younger-direction slip, sender time ahead of the clock), then normal,
//   back by 2 s and held for 3 s (what the build does when a backward step outlasts clause B's 1 s window),
//   FROZEN at a sender time 2 s back for 0.6 s and then for 3 s. In the recorded defect the slipped samples all carry
//   one sender time (the audio is frozen), which the stepped phases above do not reproduce; these do. The frozen
//   signal comes from a generator written for this test (same chirps, time held constant).
// The slip is SYNTHETIC: a step in the generator's time base, not the concealment audio that produces the defect in a
// trial. It shows whether each clause fires on live decoded audio in the browser, and nothing about how often the defect occurs.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { chromium } = createRequire(path.join(process.env.C4_PLAYWRIGHT || path.join(ROOT, 'node_modules'), 'x.js'))('playwright');
const BUILD = path.join(ROOT, 'client/builds/common.js.corrected-decoder'); const src = fs.readFileSync(BUILD);
const srv = http.createServer((q, r) => { if (q.url === '/common.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(src); } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><meta charset=utf-8><body><script src="/common.js"></script>'); } });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage(); await page.goto(url); await page.waitForFunction(() => window.C4X && window.C4X.attachRemote);
const out = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const C4X = window.C4X; const a = await C4X.initAudio();
  const { FINE, COARSE } = C4X.CHIRP;
  const TEST = `const FINE=${JSON.stringify(FINE)},COARSE=${JSON.stringify(COARSE)};const frac=(x)=>x-Math.floor(x);
    class T extends AudioWorkletProcessor{constructor(){super();this.p1=0;this.p2=0;this.off=null;this.hold=null;this.port.onmessage=(e)=>{if(e.data.offMs!==undefined)this.off=e.data.offMs;if(e.data.freeze!==undefined){this.hold=e.data.freeze?(currentFrame/sampleRate*1000+this.off)/1000:null;}};}
    process(_i,outs){const o=outs[0][0];if(this.off===null){o.fill(0);return true;}
      for(let i=0;i<o.length;i++){const t=this.hold!==null?this.hold:((currentFrame+i)/sampleRate*1000+this.off)/1000;
        this.p1+=2*Math.PI*(FINE.f0+FINE.bw*frac(t/FINE.period))/sampleRate;this.p2+=2*Math.PI*(COARSE.f0+COARSE.bw*frac(t/COARSE.period))/sampleRate;
        if(this.p1>1e4)this.p1%=2*Math.PI;if(this.p2>1e4)this.p2%=2*Math.PI;o[i]=0.3*Math.sin(this.p1)+0.3*Math.sin(this.p2);}return true;}}
    registerProcessor('c4-testgen',T);`;
  await a.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TEST], { type: 'text/javascript' })));
  const gen = new AudioWorkletNode(a.ctx, 'c4-testgen', { numberOfInputs: 0, outputChannelCount: [1] }); const set = (d, freeze = false) => gen.port.postMessage({ offMs: a.offMs + d, freeze });
  set(0); const dest = a.ctx.createMediaStreamDestination(); gen.connect(dest); await C4X.attachRemote('T', dest.stream.getAudioTracks()[0]);
  const phases = []; const mark = async (name, d, ms, freeze = false) => { set(d, freeze); const t = C4X.now(); await sleep(ms); phases.push({ name, shiftMs: d, from: t, to: C4X.now() }); };
  await mark('normal (warm-up)', 0, 3000); await mark('back 2 s, 0.6 s', -2000, 600); await mark('normal', 0, 2500);
  await mark('forward 2 s, 0.6 s', 2000, 600); await mark('normal', 0, 2500); await mark('back 2 s, held 3 s', -2000, 3000); await mark('normal', 0, 2500);
  await mark('frozen 2 s back, 0.6 s', -2000, 600, true); await mark('normal', 0, 2500); await mark('frozen 2 s back, held 3 s', -2000, 3000, true); await mark('normal', 0, 2500);
  return { phases, samples: C4X.FRESH.T, rejects: C4X.LOG.filter((l) => l.type === 'decoder_reject'), sampleRate: a.ctx.sampleRate, ua: navigator.userAgent };
});
await browser.close(); srv.close();
const t0 = out.phases[0].from; const rel = (t) => ((t - t0) / 1000).toFixed(2);
console.log(`build: client/builds/common.js.corrected-decoder sha256 ${crypto.createHash('sha256').update(src).digest('hex')}`);
console.log(`browser: ${out.ua} | context sample rate ${out.sampleRate}`);
console.log('The slip is synthetic (a step in the generator\'s encoded sender time, or that time held constant). Times are seconds after the test began.');
console.log('A sample\'s time is the centre of its analysis window, about 0.1 s before it is decoded, so a sample can fall just before the phase that produced it.\n');
console.log('phase | from–to | samples accepted | their age, ms (min–max) | rejected by clause F | by clause B | age of rejected samples, ms');
for (const p of out.phases) { const acc = out.samples.filter((s) => s.tP >= p.from && s.tP < p.to), rj = out.rejects.filter((r) => r.tP >= p.from && r.tP < p.to); const ages = acc.map((s) => s.age);
  console.log(`${p.name} | ${rel(p.from)}–${rel(p.to)} | ${acc.length} | ${ages.length ? Math.round(Math.min(...ages)) + '–' + Math.round(Math.max(...ages)) : '–'} | ${rj.filter((r) => r.why === 'F').length} | ${rj.filter((r) => r.why === 'B').length} | ${rj.map((r) => Math.round(r.age)).join(', ') || '–'}`); }
console.log(`\ntotals: accepted ${out.samples.length} | rejected F ${out.rejects.filter((r) => r.why === 'F').length} | rejected B ${out.rejects.filter((r) => r.why === 'B').length} | accepted samples aged 32 s or more: ${out.samples.filter((s) => s.age >= 32000).length} | accepted samples aged 1.5 to 2.5 s: ${out.samples.filter((s) => s.age >= 1500 && s.age <= 2500).length}`);
for (const r of out.rejects) console.log(`  reject ${r.why} at ${rel(r.tP)} s: age ${Math.round(r.age)} ms; last accepted ${r.lastTP ? ((r.tP - r.lastTP)).toFixed(0) + ' ms earlier, sender time ' + (r.lastTS - r.tS).toFixed(0) + ' ms later' : 'none'}`);
