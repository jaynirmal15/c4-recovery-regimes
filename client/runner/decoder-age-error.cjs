// Decoded-age error in healthy audio (read-only). usage, from the repository root:
//   node --max-old-space-size=6000 client/runner/decoder-age-error.cjs
// Writes logs/study/decoder/age-errors-over-125ms.json and prints the summary kept in age-error.txt.
//
// Corpus, enumerated at run time, nothing listed by name:
//   control  = every directory under control/ with a result.json whose result.valid is true, all six listening
//              directions (the bystander's stream is excluded); window = all three armed .. 0.5 s before the first
//              leaves; in h3 the mute is excluded for streams from S.
//   corpus   = every row of the dataset index logs/study/divergence-final.json (the 215), resolved to its
//              directory under study/ or study-r2/; windows = 14 s before arming .. 50 ms before isolation onset,
//              and from 8 s after both directions are healthy .. 2 s before the subject leaves.
// Error of a sample = its decoded age minus the median age of the 31 samples centred on it. Position in the chirp
// cycle = (presentation time - that median age) modulo 2 s (and 64 s), signed distance to the nearest wrap.
// Part 2 tests the 215 directly: whether any fresh-again endpoint, or the last sample the subject received before
// the stall (the input to the 2 s detection rule), is a sample that reads more than 100 ms lower than its
// neighbours; and counts healthy samples outside the fresh band as the analysis applies it (older than baseline + 250 ms).
const fs=require('fs');const rd=(d,f)=>JSON.parse(fs.readFileSync(d+'/'+f));
const A=[]; // per sample: [set, stack, dev ms, signed distance to nearest 2 s wrap ms, dist to 64 s wrap, isolated?]
const streams=[];
function scan(set,stack,id,recv,key,samples,a,b,skip){
  let s=samples.filter(x=>x.tP>a&&x.tP<b&&!(skip&&x.tP>skip[0]-1000&&x.tP<skip[1]+1500)).sort((p,q)=>p.tP-q.tP);if(s.length<40)return;
  const ages=s.map(x=>x.age);const st={set,stack,id,recv,key,n:s.length,wraps:Math.floor((s[s.length-1].tP-s[0].tP)/2000),hours:(s[s.length-1].tP-s[0].tP)/3.6e6,max:0};
  for(let i=0;i<s.length;i++){const lo=Math.max(0,i-15),hi=Math.min(s.length,i+16);const w=ages.slice(lo,hi).sort((p,q)=>p-q);const med=w[w.length>>1];const dev=s[i].age-med;
    const sender=s[i].tP-med;const ph=((sender%2000)+2000)%2000;const d2=ph>1000?ph-2000:ph;const p64=((sender%64000)+64000)%64000;const d64=p64>32000?p64-64000:p64;
    A.push({set,stack,id,recv,key,i,t:s[i].tP,dev,d2,d64,gapB:i?s[i].tP-s[i-1].tP:0,gapA:i<s.length-1?s[i+1].tP-s[i].tP:0});if(Math.abs(dev)>st.max)st.max=Math.abs(dev)}
  streams.push(st)}
for(const d of fs.readdirSync('control').filter(x=>fs.existsSync('control/'+x+'/result.json'))){const r=rd('control/'+d,'result.json');if(!r.valid)continue;const D={S:rd('control/'+d,'S.json'),O1:rd('control/'+d,'O1.json'),O2:rd('control/'+d,'O2.json')};
  const st=(X,s)=>(X.log.find(l=>l.type==='driver_state'&&l.state===s)||{}).t;const a=Math.max(...Object.values(D).map(X=>st(X,'healthy'))),b=Math.min(...Object.values(D).map(X=>st(X,'left')))-500;const mu=D.S.log.filter(l=>l.type==='ctl_mute').map(l=>l.t);
  for(const [recv,X] of Object.entries(D))for(const key of Object.keys(X.fresh))if(key!=='B')scan('control',r.stack,d,recv,key,X.fresh[key],a,b,key==='S'&&mu.length===2?mu:null)}
const R=JSON.parse(fs.readFileSync('logs/study/divergence-final.json'));
for(const row of R){const dir=['study','study-r2'].map(s=>s+'/'+row.dir).find(x=>fs.existsSync(x+'/result.json'));const r=rd(dir,'result.json');const D={S:rd(dir,'S.json'),O1:rd(dir,'O1.json'),O2:rd(dir,'O2.json')};
  const arm=Math.max(...r.marks.filter(m=>/^arm_/.test(m.step)).map(m=>m.t));const t0=r.iso.onset.before??r.iso.onset.after;const left=D.S.log.filter(l=>l.type==='driver_state'&&l.state==='left').map(l=>l.t)[0];
  const fresh=r.iso.onset.after+row.truth.up*1000;const lastH=Math.max(0,...D.S.log.filter(l=>l.type==='driver_state'&&l.state==='healthy').map(l=>l.t));
  for(const [recv,X] of Object.entries(D))for(const key of Object.keys(X.fresh)){scan('corpus-pre',row.stack,row.id,recv,key,X.fresh[key],arm-14000,t0-50);scan('corpus-post',row.stack,row.id,recv,key,X.fresh[key],Math.max(fresh,lastH)+8000,left-2000)}}
const q=(v,p)=>{v=v.slice().sort((a,b)=>a-b);return v.length?v[Math.min(v.length-1,Math.floor(v.length*p))]:NaN};
console.log('samples',A.length,'| streams',streams.length,'| stream-hours',streams.reduce((s,x)=>s+x.hours,0).toFixed(1),'| 2 s wraps crossed',streams.reduce((s,x)=>s+x.wraps,0));
for(const stack of ['livekit','janus']){const g=A.filter(x=>x.stack===stack);const near=g.filter(x=>Math.abs(x.d2)<=60),far=g.filter(x=>Math.abs(x.d2)>60);const ab=v=>v.map(x=>Math.abs(x.dev));
  console.log('\n== '+stack+': samples',g.length,'| within 60 ms of a 2 s wrap:',near.length,'('+(100*near.length/g.length).toFixed(1)+'%)');
  console.log('  |error| away from a wrap: median',q(ab(far),.5).toFixed(1),'p99',q(ab(far),.99).toFixed(1),'p99.9',q(ab(far),.999).toFixed(1),'max',ab(far).reduce((m,v)=>v>m?v:m,0).toFixed(0),'ms');
  console.log('  |error| within 60 ms of a wrap: median',q(ab(near),.5).toFixed(1),'p90',q(ab(near),.9).toFixed(1),'p99',q(ab(near),.99).toFixed(1),'max',ab(near).reduce((m,v)=>v>m?v:m,0).toFixed(0),'ms');
  for(const th of [30,60,125,250,300,500,1000]){const big=g.filter(x=>Math.abs(x.dev)>th);console.log('  |error| >',th,'ms:',big.length,'samples ('+(1e6*big.length/g.length).toFixed(0)+' per million) | within 60 ms of a 2 s wrap:',big.filter(x=>Math.abs(x.d2)<=60).length,'| within 150 ms of a 64 s wrap:',big.filter(x=>Math.abs(x.d64)<=150).length)}
  const big=g.filter(x=>Math.abs(x.dev)>60&&Math.abs(x.d2)<=60);const hist={};for(const x of big){const k=Math.round(x.d2/10)*10;hist[k]=(hist[k]||0)+1}console.log('  position of >60 ms errors relative to the wrap (ms: count):',JSON.stringify(Object.fromEntries(Object.entries(hist).sort((a,b)=>a[0]-b[0]))));
  console.log('  sign of >60 ms errors at a wrap: negative',big.filter(x=>x.dev<0).length,'positive',big.filter(x=>x.dev>0).length,'| range',Math.min(...big.map(x=>x.dev)).toFixed(0),'to',Math.max(...big.map(x=>x.dev)).toFixed(0));
  // consecutive errors
  const idx=new Map();for(const x of g)idx.set(x.id+x.set+x.recv+x.key+':'+x.i,x);let consec=0;for(const x of g.filter(x=>Math.abs(x.dev)>125)){const n=idx.get(x.id+x.set+x.recv+x.key+':'+(x.i+1));if(n&&Math.abs(n.dev)>125)consec++}
  console.log('  errors >125 ms followed immediately by another:',consec,'| errors >60 ms NOT near a 2 s wrap:',g.filter(x=>Math.abs(x.dev)>60&&Math.abs(x.d2)>60).length,'of',g.filter(x=>Math.abs(x.dev)>60).length);
  const w=streams.filter(s=>s.stack===stack).reduce((s,x)=>s+x.wraps,0);console.log('  per 2 s wrap (',w,'wraps): sample with error >60 ms',(100*big.length/w).toFixed(2)+'%','| >125 ms',(100*g.filter(x=>Math.abs(x.dev)>125&&Math.abs(x.d2)<=60).length/w).toFixed(2)+'%','| >250 ms',(100*g.filter(x=>Math.abs(x.dev)>250&&Math.abs(x.d2)<=60).length/w).toFixed(3)+'%','| a 256 ms interval',(100*g.filter(x=>x.gapB>200&&x.gapB<300&&Math.abs(x.d2)<200).length/w).toFixed(1)+'%');
  const ext=g.filter(x=>Math.abs(x.dev)>250).sort((a,b)=>Math.abs(b.dev)-Math.abs(a.dev)).slice(0,6);console.log('  largest:',ext.map(x=>x.dev.toFixed(0)+'ms@wrap'+x.d2.toFixed(0)+'/'+x.set).join('  '));}
fs.mkdirSync('logs/study/decoder',{recursive:true});const B=A.filter(x=>Math.abs(x.dev)>125);fs.writeFileSync('logs/study/decoder/age-errors-over-125ms.json',JSON.stringify(B));console.log('\nenumerated: control valid sessions',fs.readdirSync('control').filter(x=>fs.existsSync('control/'+x+'/result.json')&&rd('control/'+x,'result.json').valid).length,'| dataset index rows',R.length);
// ---- errors over 125 ms: sign, size, position in the 2 s cycle, spread over streams and trials
console.log('\nerrors >125 ms:',B.length,'| reading too young',B.filter(x=>x.dev<0).length,'| too old',B.filter(x=>x.dev>0).length,'| most negative',Math.min(...B.map(x=>x.dev)).toFixed(0),'| most positive',Math.max(...B.map(x=>x.dev)).toFixed(0),'| below -250:',B.filter(x=>x.dev<-250).length,'| above +250:',B.filter(x=>x.dev>250).length);
{const h={};for(const x of B){const k=Math.round(x.d2/100)*100;h[k]=(h[k]||0)+1}console.log('position relative to the 2 s wrap, 100 ms bins:',JSON.stringify(Object.fromEntries(Object.entries(h).sort((a,b)=>a[0]-b[0]))));
 console.log('by stack',JSON.stringify(B.reduce((a,x)=>(a[x.stack]=(a[x.stack]||0)+1,a),{})),'| by direction',JSON.stringify(B.reduce((a,x)=>(a[x.recv+'<-'+x.key]=(a[x.recv+'<-'+x.key]||0)+1,a),{})),'| trials or sessions with any:',new Set(B.map(x=>x.set.split('-')[0]+':'+x.id)).size,'of LiveKit',new Set(A.filter(x=>x.stack==='livekit').map(x=>x.set.split('-')[0]+':'+x.id)).size);}
// ---- part 2: the 215, directly
{const GAP=300;const freshAt=(xs,base,t0,skip)=>{xs=xs.filter(s=>s.tP>=t0&&s!==skip);for(let i=0;i<xs.length;i++){if(xs[i].age>base+250)continue;let j=i+1,good=true;while(j<xs.length&&xs[j].tP<=xs[i].tP+1000){if(xs[j].age>base+250||xs[j].tP-xs[j-1].tP>GAP){good=false;break}j++}if(good&&j<xs.length&&xs[j].tP-xs[j-1].tP<=GAP)return xs[i]}return null};
 let n=0,flag=0,shift=[],lastLow=0,lastN=0,holdLow=0,pre=0,preHi=0,preMax=-1e9;
 for(const row of R){const dir=['study','study-r2'].map(s=>s+'/'+row.dir).find(x=>fs.existsSync(x+'/result.json'));const r=rd(dir,'result.json');const t0=r.iso.onset.after;const arm=Math.max(...r.marks.filter(m=>/^arm_/.test(m.step)).map(m=>m.t));const tb=r.iso.onset.before??r.iso.onset.after;
  for(const o of ['O1','O2']){const D=rd(dir,o+'.json');const base=(D.driver.baseline||{}).S??100;const all=(D.fresh.S||[]).slice().sort((a,b)=>a.tP-b.tP);
   if(row.stack==='livekit')for(const x of all){if(x.tP>arm&&x.tP<tb-50){pre++;if(x.age>base+250)preHi++;if(x.age-base>preMax)preMax=x.age-base}}
   const xs=all.filter(s=>s.tP>=t0);let prev=t0,dist=null;for(const s of xs){if(s.tP-prev>GAP||s.age>1000){dist=prev;break}prev=s.tP}
   const f=freshAt(all,base,dist??t0);if(!f)continue;n++;const i=all.indexOf(f);const nxt=all.slice(i+1,i+9).map(s=>s.age).sort((a,b)=>a-b);const med=nxt[nxt.length>>1];
   if(f.age<med-100){flag++;const f2=freshAt(all,base,dist??t0,f);shift.push(f2?+((f2.tP-f.tP)/1000).toFixed(3):null)}
   holdLow+=all.slice(i+1).filter(s=>s.tP<=f.tP+1000&&s.age<med-100).length}
  const S=rd(dir,'S.json');for(const k of ['O1','O2']){const s=(S.fresh[k]||[]).filter(x=>x.tP<t0+400).sort((a,b)=>a.tP-b.tP);if(s.length<12)continue;const last=s[s.length-1];const w=s.slice(-12,-1).map(x=>x.age).sort((a,b)=>a-b);lastN++;if(last.age<w[w.length>>1]-100)lastLow++}}
 console.log('\nthe 215: observer fresh-again endpoints',n,'| endpoint sample reads >100 ms lower than the 8 after it:',flag,'| shift if that sample is ignored (s):',JSON.stringify(shift),'| low-reading samples inside a 1 s hold:',holdLow,'| last sample the subject received before the stall reads >100 ms low:',lastLow,'of',lastN,'streams');
 console.log('the 215, LiveKit, observers hearing S, armed .. onset: samples',pre,'| older than baseline + 250 ms:',preHi,'| largest excess over baseline (ms):',preMax.toFixed(0));
 let c=0,hi=0,lo=0,mx=-1e9;for(const d of fs.readdirSync('control').filter(x=>x.startsWith('livekit')&&fs.existsSync('control/'+x+'/result.json'))){const r=rd('control/'+d,'result.json');if(!r.valid)continue;const D={S:rd('control/'+d,'S.json'),O1:rd('control/'+d,'O1.json'),O2:rd('control/'+d,'O2.json')};const st=(X,s)=>(X.log.find(l=>l.type==='driver_state'&&l.state===s)||{}).t;const a=Math.max(...Object.values(D).map(X=>st(X,'healthy'))),b=Math.min(...Object.values(D).map(X=>st(X,'left')))-500;const mu=D.S.log.filter(l=>l.type==='ctl_mute').map(l=>l.t);
  for(const X of Object.values(D))for(const k of Object.keys(X.fresh)){if(k==='B')continue;const base=X.driver.baseline[k];for(const x of X.fresh[k]){if(x.tP<=a||x.tP>=b)continue;if(k==='S'&&mu.length===2&&x.tP>mu[0]-1000&&x.tP<mu[1]+1500)continue;c++;const dv=x.age-base;if(dv>250)hi++;if(dv<-250)lo++;if(dv>mx)mx=dv}}}
 console.log('control, LiveKit, all six directions: samples',c,'| older than baseline + 250 ms:',hi,'| younger than baseline - 250 ms:',lo,'| largest excess over baseline (ms):',mx.toFixed(0));}
