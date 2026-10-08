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

// ---- do the arrival times fit the kernel's SYN retransmission schedule?
// Linux v6.18 Documentation/networking/ip-sysctl.rst, tcp_syn_linear_timeouts (default 4): "With an initial RTO of 1 ...
// we would expect SYN RTOs to be: 1, 1, 1, 1, 1, 2, 4, ..." i.e. a connection attempt sends its SYN at 0, 1, 2, 3, 4, 5, 7,
// 11, 19, ... times the initial RTO after it starts. Prediction for each connection opened while the path was blocked: the
// request arrives at the first of those points that falls after restore. The unit is estimated from the data, once.
{const pts=[0,1,2,3,4,5,7,11,19,35];const obs=[];
 for(const r of L){const o=r.log.client.attempts[0],q=r.log.resumes[0];if(o.serverReceipt==null&&q.t-o.t>15.5)continue;obs.push({stack:'LiveKit',D:r.D,gap:r.restore-o.t,lag:q.t-o.t})}
 for(const r of J){const c=r.log.claims.find(c=>c.reply==='success');const o=r.log.client.wsOpens.filter(t=>t<=c.t+0.01).pop();obs.push({stack:'Janus',D:r.D,gap:r.restore-o,lag:c.t-o})}
 const blocked=obs.filter(x=>x.gap>0);const unit=blocked.filter(x=>x.lag>10).map(x=>x.lag/11);const u=unit.reduce((a,b)=>a+b,0)/unit.length;
 const pred=x=>x.gap<=0?0:pts.find(p=>p*u>x.gap)*u;const res=obs.map(x=>({...x,pred:pred(x),res:x.lag-pred(x)}));
 console.log('\nSYN schedule fit: unit (initial RTO) estimated from the '+unit.length+' arrivals over 10 s as lag/11 =',u.toFixed(3),'s');
 console.log('connections opened while the path was blocked:',blocked.length,'| opened after restore:',obs.length-blocked.length);
 const by={};for(const x of res){const k=x.stack+' '+x.D+' s';(by[k]=by[k]||[]).push(x)}
 for(const k of Object.keys(by).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){const g=by[k];console.log('  '+k+': n',g.length,'| restore − open',rng(g.map(x=>x.gap)),'| predicted point',[...new Set(g.map(x=>(x.pred/u).toFixed(0)))].join(' or '),'× unit | observed − predicted',rng(g.map(x=>x.res)),'s')}
 console.log('all',res.length,'arrivals: observed − predicted',rng(res.map(x=>x.res)),'s | within 0.1 s:',res.filter(x=>Math.abs(x.res)<0.1).length,'| the others:',res.filter(x=>Math.abs(x.res)>=0.1).map(x=>x.stack+' '+x.D+' s, restore − open '+x.gap.toFixed(2)+' s, arrived at '+(x.lag/u).toFixed(2)+' units').join('; ')||'none');
 console.log('(restore is the time the runner confirmed the rules removed; they are removed up to about 0.16 s before that, which is the size of the gap in the cases listed)');}
