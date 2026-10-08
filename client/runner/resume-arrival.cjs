// When the client's resumption request reached the server, relative to when the client opened the connection
// (read-only). usage, from the repository root: node client/runner/resume-arrival.cjs
// Input: logs/study/removal-race/livekit.json and janus.json, the per-trial rows written by removal-race.mjs,
// which enumerates study/ and study-r2/ from the filesystem. Retained trials only; LiveKit rows whose server
// log does not cover the interval are left out and counted. Times are seconds after isolation onset.
const fs=require('fs');const rng=v=>v.length?Math.min(...v).toFixed(2)+'–'+Math.max(...v).toFixed(2):'–';
const all=JSON.parse(fs.readFileSync('logs/study/removal-race/livekit.json','utf8')).filter(r=>r.cohort==='retained'&&r.mode==='all');
const L=all.filter(r=>!r.log.flags.length&&r.log.resumes&&r.log.resumes.length&&r.log.client.attempts.length);
console.log('LiveKit, full isolation, retained:',all.length,'trials |',L.length,'with a usable server log and at least one resume request |',all.length-L.length,'left out');
console.log('\n| D (s) | Trials | Client opens its first connection | Restore | First resume received, after that open | Answer |\n|---|---|---|---|---|---|');
const by={};for(const r of L)(by[r.D]=by[r.D]||[]).push(r);
for(const D of Object.keys(by).sort((a,b)=>a-b)){const g=by[D];const d=g.map(r=>r.log.resumes[0].t-r.log.client.attempts[0].t);const ans={};for(const r of g)ans[r.log.resumes[0].answer]=(ans[r.log.resumes[0].answer]||0)+1;
 console.log('| '+[D,g.length,rng(g.map(r=>r.log.client.attempts[0].t)),rng(g.map(r=>r.restore)),rng(d),Object.entries(ans).map(([k,v])=>k+' '+v).join(', ')].join(' | ')+' |')}
const race=L.filter(r=>r.verdict==='as predicted');const sv=race.filter(r=>r.regime!=='R2'),rb=race.filter(r=>r.regime==='R2');
const lag=sv.map(r=>r.log.resumes.find(q=>q.answer==='accepted').t-r.log.client.attempts[0].t);
console.log('\nsurvivors with a race:',sv.length,'| accepted resume received',rng(lag),'s after the client opened the connection, at',rng(sv.map(r=>r.log.resumes.find(q=>q.answer==='accepted').t)),'s after onset');
const point=Math.min(...lag);const rule=r=>r.restore<r.log.client.attempts[0].t+point;
console.log('rule "restore precedes (first open + '+point.toFixed(2)+' s)": true in',sv.filter(rule).length,'of',sv.length,'survivors and',rb.filter(rule).length,'of',rb.length,'rebuilds');
console.log('rebuilds: connections the client opened before the removal:',rng(rb.map(r=>r.log.client.attempts.filter(a=>a.t<r.log.removal.t).length)),'| first attempt ends',rng(rb.map(r=>r.log.client.actions[0].end)),'| second begins',rng(rb.map(r=>r.log.client.actions[1].t)),'| removal',rng(rb.map(r=>r.log.removal.t)));
console.log('rebuilds: a second attempt begun 2 s after the first ended would begin before the removal in',rb.filter(r=>r.log.client.actions[0].end+2<r.log.removal.t).length,'of',rb.length);
const J=JSON.parse(fs.readFileSync('logs/study/removal-race/janus.json','utf8')).filter(r=>r.verdict==='as predicted'&&r.regime!=='R2');const jb={};
for(const r of J){const c=r.log.claims.find(c=>c.reply==='success');const o=r.log.client.wsOpens.filter(t=>t<=c.t+0.01).pop();(jb[r.D]=jb[r.D]||[]).push(c.t-o)}
console.log('\nJanus, survivors with a claim ('+J.length+'): successful claim sent, after the websocket carrying it was opened, by D:',Object.keys(jb).sort((a,b)=>a-b).map(D=>D+' s: '+rng(jb[D])).join(' | '));
