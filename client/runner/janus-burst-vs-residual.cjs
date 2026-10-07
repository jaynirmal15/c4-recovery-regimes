const fs=require("fs");const out=[];
for(const d of fs.readdirSync("study").filter(x=>/^janus-iso-media-(10|30|45)s/.test(x)).map(x=>"study/"+x)){
 const r=JSON.parse(fs.readFileSync(d+"/result.json"));const S=JSON.parse(fs.readFileSync(d+"/S.json"));const t0=r.iso.onset.after,tr=r.iso.restore.after;const rel=t=>(t-t0)/1000;const off=(r.clock.sfu&&r.clock.sfu.offsetMs)||0;
 const E=fs.readFileSync(d+"/server-events.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.body&&e.body.type);const ts=e=>e.body.timestamp/1000-off;
 const ph=E.find(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="joined"&&e.body.event.data.id===101).body.handle_id;
 const sh=E.filter(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="subscribing"&&JSON.stringify(e.body.event.data.streams||"").includes('"feed_id":101')).map(e=>e.body.handle_id);
 const st=(h,k)=>E.filter(e=>e.body.type===32&&e.body.subtype===3&&e.body.handle_id===h).map(e=>({t:ts(e),n:e.body.event[k]}));
 const up=E.filter(e=>e.body.type===32&&e.body.subtype===1&&e.body.handle_id===ph&&e.body.event.receiving===true&&ts(e)>t0)[0];const tu=ts(up);
 const burst=(s)=>{const pre=s.filter(x=>x.t<t0);const rate=(pre[pre.length-1].n-pre[0].n)/((pre[pre.length-1].t-pre[0].t)/1000);const a=s.filter(x=>x.t<tu).pop(),b=s.find(x=>x.t>tu+300);return {pk:(b.n-a.n)-rate*(b.t-tu)/1000, within:(b.t-tu)/1000, aAfterOnset:(a.t-t0)/1000};};
 const pb=burst(st(ph,"packets-received"));const sb=sh.map(h=>burst(st(h,"packets-sent")));
 const acts=S.driver.actions.filter(a=>a.kind==="transport_restart");
 const row={D:r.iso.plannedS,firstRestart:rel(acts[0].tStart),rxUp:rel(tu),queueSpan:rel(tu)-rel(acts[0].tStart),burstS:pb.pk/50,burstWithin:pb.within,preStatAt:pb.aAfterOnset,fwdS:sb.map(x=>x.pk/50),obs:[]};
 for(const w of ["O1","O2"]){const O=JSON.parse(fs.readFileSync(d+"/"+w+".json"));const base=(O.driver.baseline||{}).S;const xs=(O.fresh.S||[]).filter(x=>x.tP>tu-300).sort((a,b)=>a.tP-b.tP);
  const head=xs.filter(x=>x.age>20000&&x.tP<tu+1500);const body=xs.filter(x=>x.age<20000);const f=body[0];
  // fresh start (start of validated 1 s interval) for this observer
  let fresh=null;for(let i=0;i<body.length;i++){if(body[i].age>base+250)continue;let j=i+1,good=true;while(j<body.length&&body[j].tP<=body[i].tP+1000){if(body[j].age>base+250||body[j].tP-body[j-1].tP>300){good=false;break}j++}if(good&&j<body.length){fresh=body[i].tP;break}}
  const p1=body.find(x=>x.age<=2000),p2=body.find(x=>x.age<=600);
  row.obs.push({w,base,firstAfter:(f.tP-tu)/1000,resid:(f.age-base)/1000,oldHead:head.length?head[0].age/1000:null,freshLag:fresh?(fresh-tu)/1000:null,drain:f.age>2000&&p1&&p2?(p1.age-p2.age)/(p2.tP-p1.tP):null});}
 out.push(row);}
out.sort((a,b)=>a.D-b.D);const f=(x,d=2)=>x==null?"-":x.toFixed(d);
console.log("D | first restart | rx resumes | restart→resume span | burst received (s of audio; stat taken Xs after) | burst forwarded to O1,O2 subs | per observer: first sample after resume, residual delay (age−baseline), [very old sample], kept-vs-burst: (burst−resid) and /4.0 | fresh lag after rx resume | drain s/s");
for(const r of out)console.log([r.D,"|",f(r.firstRestart),"|",f(r.rxUp),"|",f(r.queueSpan),"|",f(r.burstS)+" ("+f(r.burstWithin,1)+"s)","|",r.fwdS.map(x=>f(x)).join(","),"|",r.obs.map(o=>o.w+" +"+f(o.firstAfter)+"s resid "+f(o.resid)+(o.oldHead?" [old "+f(o.oldHead,1)+"s]":"")+" disc "+f(r.burstS-o.resid)+" = "+f((r.burstS-o.resid)/4,2)+"×4s | lag "+f(o.freshLag)+" drain "+f(o.drain,2)).join("  ;  ")].join(" "));
fs.writeFileSync("logs/study/janus-early/burst-vs-residual.json",JSON.stringify(out));
const all=out.flatMap(r=>r.obs.map(o=>({D:r.D,k:(r.burstS-o.resid)/4,resid:o.resid,lag:o.freshLag,drain:o.drain,burst:r.burstS})));
for(const D of [10,30,45]){const g=all.filter(x=>x.D==D);const rg=k=>Math.min(...g.map(x=>x[k]).filter(x=>x!=null)).toFixed(2)+".."+Math.max(...g.map(x=>x[k]).filter(x=>x!=null)).toFixed(2);console.log("D="+D,"burst",rg("burst"),"resid",rg("resid"),"k=(burst−resid)/4",rg("k"),"freshLag",rg("lag"),D<45?"drain "+rg("drain"):"")}
// does lag ≈ resid/drain ?
console.log("lag vs resid/drain (D=10,30):",all.filter(x=>x.drain).map(x=>x.lag.toFixed(1)+"~"+((x.resid-0.25)/x.drain).toFixed(1)).join(" "));
