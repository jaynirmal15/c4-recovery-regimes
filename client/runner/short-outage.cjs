// What the detection rule saw, and how the audio was behaving, in the short-outage conditions (read-only).
// usage, from the repository root: node client/runner/short-outage.cjs
// Trial set: every row of the dataset index logs/study/divergence-final.json (the 215) with an outage of 5 s or
// less, each resolved to its directory under study/ or study-r2/. Nothing is listed by name.
// "Rule age" is what the client's 2 s rule reads: now minus the sender timestamp of the latest decoded sample,
// the larger of the two streams the subject receives, evaluated every 50 ms from onset to the first action
// (or to 12 s if no action was taken). "Excess" is decoded age minus the baseline recorded at arming.
// The straight-line time to the band extrapolates the last 3 s before the restart; it is an extrapolation of
// what was recorded, not a statement of what would have happened without the restart.
const fs=require('fs');const rng=v=>v.length?Math.min(...v).toFixed(2)+'–'+Math.max(...v).toFixed(2):'–';const rd=(d,f)=>JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));
const R=JSON.parse(fs.readFileSync('logs/study/divergence-final.json','utf8')).filter(r=>r.D<=5);const cells={};
for(const row of R){const dir=['study','study-r2'].map(s=>s+'/'+row.dir).find(x=>fs.existsSync(x+'/result.json'));const r=rd(dir,'result.json'),S=rd(dir,'S.json');const t0=r.iso.onset.after,tr=r.iso.restore.after;const rel=t=>(t-t0)/1000;
 const k=`${row.stack==='livekit'?'LiveKit':'Janus'} ${row.mode==='all'?'full':'media-only'} ${row.D} s`;const c=cells[k]=cells[k]||{n:0,acted:0,det:[],sigOk:0,pcsOk:0,act:[],actEnd:[],rule:[],over4:0,ice:0,noInbound:0,inAt:[],inSlope:[],obsFirst:[],obsLast:[],obsSlope:[],toBand:[],fresh:[]};c.n++;
 const a=S.driver.actions[0];const tA=a?a.tStart:null;const end=tA??t0+12000;const det=S.log.find(l=>l.type==='driver_state'&&l.state==='detected'&&l.t>t0-1000);
 if(det){c.det.push(rel(det.t));if(det.signalOk)c.sigOk++;if(det.pcsOk)c.pcsOk++}
 const streams=['O1','O2'].map(q=>(S.fresh[q]||[]).slice().sort((x,y)=>x.tP-y.tP));let mx=0;for(let t=t0;t<end;t+=50)for(const s of streams){let last=null;for(const x of s){if(x.tP<=t)last=x;else break}if(last)mx=Math.max(mx,t-last.tS)}
 c.rule.push(mx/1000);if(mx>4000)c.over4++;if(S.log.some(l=>l.type==='pc_ice'&&l.state==='disconnected'&&l.t>t0&&l.t<end))c.ice++;c.fresh.push(row.truth.up);
 if(!tA)continue;c.acted++;c.act.push(rel(tA));c.actEnd.push(rel(a.tEnd));
 const w=streams[0].filter(x=>x.tP>tr+200&&x.tP<tA);if(w.length<4)c.noInbound++;else{const b=S.driver.baseline.O1;c.inAt.push((w[w.length-1].age-b)/1000);c.inSlope.push((w[w.length-1].age-w[0].age)/(w[w.length-1].tP-w[0].tP))}
 for(const o of ['O1','O2']){const O=rd(dir,o+'.json');const b=O.driver.baseline.S;const xs=(O.fresh.S||[]).filter(x=>x.tP>tr+300&&x.tP<tA).sort((x,y)=>x.tP-y.tP);if(xs.length<8)continue;const w3=xs.filter(x=>x.tP>tA-3000);let sx=0,sy=0,sxx=0,sxy=0;for(const x of w3){const X=rel(x.tP),Y=(x.age-b)/1000;sx+=X;sy+=Y;sxx+=X*X;sxy+=X*Y}const n=w3.length;const sl=(n*sxy-sx*sy)/(n*sxx-sx*sx);const ex=(xs[xs.length-1].age-b)/1000;
  c.obsFirst.push((xs[0].age-b)/1000);c.obsLast.push(ex);c.obsSlope.push(sl);if(sl<0&&ex>0.25)c.toBand.push(rel(xs[xs.length-1].tP)+(ex-0.25)/(-sl))}}
for(const [k,c] of Object.entries(cells).sort()){console.log('\n'+k+': trials',c.n,'| detection at',rng(c.det),'s (signalling healthy in',c.sigOk+', connections healthy in',c.pcsOk+') | client ICE disconnected before any action:',c.ice,'| largest rule age before acting',rng(c.rule),'s; over 4 s in',c.over4,'| restart taken in',c.acted,'| fresh-again at',rng(c.fresh),'s');
 if(c.acted)console.log('   restart begins',rng(c.act),'ends',rng(c.actEnd),'| subject inbound between restore and the restart: no samples in',c.noInbound,'trials; else excess at the restart',rng(c.inAt),'s, slope',rng(c.inSlope),'s/s');
 if(c.obsLast.length)console.log('   observers hearing S ('+c.obsLast.length+' streams): excess just after restore',rng(c.obsFirst),'s | just before the restart',rng(c.obsLast),'s | slope over the last 3 s',rng(c.obsSlope),'s/s | straight-line time to the band',rng(c.toBand),'s after onset')}
