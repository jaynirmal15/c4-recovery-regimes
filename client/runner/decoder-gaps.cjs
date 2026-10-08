// Decode gaps in healthy audio (read-only). usage, from the repository root: node client/runner/decoder-gaps.cjs
// Writes logs/study/decoder/gaps.json (every interval of 200 ms or more) and prints the summary kept in gaps.txt.
//
// Corpus, enumerated at run time, nothing listed by name:
//   control  = every directory under control/ with a result.json whose result.valid is true; window = all three
//              participants armed .. 0.5 s before the first leaves; in h3 the mute is excluded for streams from S.
//   corpus   = every row of the dataset index logs/study/divergence-final.json (the 215), each resolved to its
//              directory under study/ or study-r2/; windows = armed .. isolation onset ("pre"), and from 3 s after
//              both directions are healthy .. 2 s before the subject leaves ("post").
// An interval "spans a wrap" if the sender timestamps of the samples either side fall in different 2 s (or 64 s)
// periods of the chirp. "age change" is the decoded age after the interval minus the age before it.
const fs=require('fs');const rd=(d,f)=>JSON.parse(fs.readFileSync(d+'/'+f));
const out=[];let wraps64=0,streamSeconds=0,nIntervals=0;
function scan(tag,cond,recv,key,samples,a,b,skip){ // skip: [t0,t1] excluded (mute)
  const s=samples.filter(x=>x.tP>a&&x.tP<b).sort((p,q)=>p.tP-q.tP);if(s.length<2)return;
  streamSeconds+=(s[s.length-1].tP-s[0].tP)/1000;
  wraps64+=Math.floor(s[s.length-1].tS/64000)-Math.floor(s[0].tS/64000);
  for(let i=1;i<s.length;i++){const len=s[i].tP-s[i-1].tP;nIntervals++;if(len<200)continue;if(skip&&s[i-1].tP<skip[1]+500&&s[i].tP>skip[0]-500)continue;
    const w64=Math.floor(s[i].tS/64000)!==Math.floor(s[i-1].tS/64000);const w2=Math.floor(s[i].tS/2000)!==Math.floor(s[i-1].tS/2000);
    const near64=Math.min(...[s[i-1].tS,s[i].tS].map(t=>{const m=((t%64000)+64000)%64000;return Math.min(m,64000-m)}));
    out.push({tag,cond,recv,key,len:Math.round(len),cls:Math.round(len/128)*128,t:s[i-1].tP,rel:+((s[i-1].tP-a)/1000).toFixed(2),w64,w2,near64:Math.round(near64),dAge:Math.round(s[i].age-s[i-1].age)})}}
// control
for(const d of fs.readdirSync('control').filter(x=>fs.existsSync('control/'+x+'/result.json'))){const r=rd('control/'+d,'result.json');if(!r.valid)continue;const D={S:rd('control/'+d,'S.json'),O1:rd('control/'+d,'O1.json'),O2:rd('control/'+d,'O2.json')};
  const st=(X,s)=>(X.log.find(l=>l.type==='driver_state'&&l.state===s)||{}).t;const a=Math.max(...Object.values(D).map(X=>st(X,'healthy'))),b=Math.min(...Object.values(D).map(X=>st(X,'left')))-500;
  const mu=D.S.log.filter(l=>l.type==='ctl_mute').map(l=>l.t);
  for(const [recv,X] of Object.entries(D))for(const key of Object.keys(X.fresh))scan('control:'+d,r.control.condition,recv,key,X.fresh[key],a,b,key==='S'&&mu.length===2?mu:null)}
const cs=streamSeconds,cw=wraps64,ci=nIntervals;streamSeconds=0;wraps64=0;nIntervals=0;
// corpus healthy windows
const R=JSON.parse(fs.readFileSync('logs/study/divergence-final.json'));
for(const row of R){const dir=['study','study-r2'].map(s=>s+'/'+row.dir).find(x=>fs.existsSync(x+'/result.json'));const r=rd(dir,'result.json');const D={S:rd(dir,'S.json'),O1:rd(dir,'O1.json'),O2:rd(dir,'O2.json')};
  const arm=Math.max(...r.marks.filter(m=>/^arm_/.test(m.step)).map(m=>m.t));const t0=r.iso.onset.before??r.iso.onset.after;const left=D.S.log.filter(l=>l.type==='driver_state'&&l.state==='left').map(l=>l.t)[0];
  const fresh=r.iso.onset.after+row.truth.up*1000;const lastH=Math.max(0,...D.S.log.filter(l=>l.type==='driver_state'&&l.state==='healthy').map(l=>l.t));
  for(const [recv,X] of Object.entries(D))for(const key of Object.keys(X.fresh)){scan('corpus-pre:'+row.id,row.stack+'/'+row.regime+'/'+row.mode+'/'+row.D,recv,key,X.fresh[key],arm,t0);scan('corpus-post:'+row.id,row.stack+'/'+row.regime+'/'+row.mode+'/'+row.D,recv,key,X.fresh[key],Math.max(fresh,lastH)+3000,left-2000)}}
fs.mkdirSync('logs/study/decoder',{recursive:true});fs.writeFileSync('logs/study/decoder/gaps.json',JSON.stringify(out));console.log('enumerated: control valid sessions',fs.readdirSync('control').filter(x=>fs.existsSync('control/'+x+'/result.json')&&rd('control/'+x,'result.json').valid).length,'| dataset index rows',R.length);
const rep=(name,g,secs,wr,ni)=>{console.log('\n=== '+name+': stream-hours',(secs/3600).toFixed(1),'| intervals',ni,'| 64 s wraps crossed',wr,'| intervals >=200 ms:',g.length);
  const by={};for(const x of g){const k=x.cls;by[k]=by[k]||{n:0,w2:0,w64:0,near:[]};by[k].n++;if(x.w2)by[k].w2++;if(x.w64)by[k].w64++;}
  for(const k of Object.keys(by).sort((a,b)=>a-b))console.log('  ',k,'ms: n',by[k].n,'('+(100*by[k].n/ni).toFixed(2)+'% of intervals) | spans a 2 s wrap',by[k].w2,'| spans a 64 s wrap',by[k].w64);
  const big=g.filter(x=>x.len>300);console.log('  gaps >300 ms:',big.length,'| span a 64 s wrap:',big.filter(x=>x.w64).length,'| not:',big.filter(x=>!x.w64).length);
  console.log('  64 s wraps that produced a >300 ms gap:',big.filter(x=>x.w64).length,'of',wr,'| produced any >=200 ms interval:',g.filter(x=>x.w64).length);
  return big};
const C=out.filter(x=>x.tag.startsWith('control'));const bigC=rep('CONTROL (80 valid sessions)',C,cs,cw,ci);
console.log('  by condition:',JSON.stringify(bigC.reduce((m,x)=>(m[x.cond]=(m[x.cond]||0)+1,m),{})),'| by receiver:',JSON.stringify(bigC.reduce((m,x)=>(m[x.recv]=(m[x.recv]||0)+1,m),{})),'| by stream:',JSON.stringify(bigC.reduce((m,x)=>(m[x.recv+'<-'+x.key]=(m[x.recv+'<-'+x.key]||0)+1,m),{})));
for(const x of bigC)console.log('   ',x.tag.slice(8,40),x.cond,x.recv+'<-'+x.key,'len',x.len,'at',x.rel,'s | 64s-wrap',x.w64,'nearest wrap ms',x.near64,'| age change ms',x.dAge);
const K=out.filter(x=>x.tag.startsWith('corpus'));const bigK=rep('CORPUS healthy windows (215 trials; pre-onset armed, and post-recovery from 3 s after both directions healthy)',K,streamSeconds,wraps64,nIntervals);
console.log('  by stack:',JSON.stringify(bigK.reduce((m,x)=>{const k=x.cond.split('/')[0]+' '+x.tag.split(':')[0];m[k]=(m[k]||0)+1;return m},{})),'| by stream:',JSON.stringify(bigK.reduce((m,x)=>(m[x.recv+'<-'+x.key]=(m[x.recv+'<-'+x.key]||0)+1,m),{})));
for(const x of bigK.slice(0,30))console.log('   ',x.tag.slice(0,46),x.cond,x.recv+'<-'+x.key,'len',x.len,'at',x.rel,'| 64s-wrap',x.w64,'nearest',x.near64,'| dAge',x.dAge);
// playout-delay steps: every gap over 300 ms on a measured (non-bystander) stream, with the age change across it
const meas=out.filter(x=>x.len>300&&x.key!=='B');console.log('\ngaps >300 ms on measured streams:',meas.length,'| with an age change of 8 ms or more:',meas.filter(x=>Math.abs(x.dAge)>=8).length,'| age changes (ms):',JSON.stringify(meas.map(x=>x.dAge)));
// exposure with three streams decoded (bystander present in h2-livekit), from the bystander's own joined/left log
let h3=0,evt=new Set();for(const d of fs.readdirSync('control').filter(x=>x.startsWith('livekit-h2')&&fs.existsSync('control/'+x+'/result.json'))){const r=rd('control/'+d,'result.json');if(!r.valid)continue;const B=rd('control/'+d,'B.json');const j=(B.log.find(l=>l.type==='lk_joined')||{}).t,l=(B.log.find(l=>l.type==='driver_state'&&l.state==='left')||{}).t;if(j&&l)h3+=3*(l-j)/3.6e6}
for(const x of meas.filter(x=>x.tag.startsWith('control')))evt.add(x.tag+'|'+x.recv+'|'+Math.round(x.t/500));
console.log('h2-livekit receiver-hours with the bystander present (three streams decoded):',h3.toFixed(2),'| gap events on measured streams in control (receiver, instant):',evt.size);
