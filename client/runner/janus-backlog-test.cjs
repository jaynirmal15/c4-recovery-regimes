// Per-trial test of the Janus backlog explanation (read-only). usage: node client/runner/janus-backlog-test.cjs <trialDir...>
const fs=require("fs");
function one(d){
 const r=JSON.parse(fs.readFileSync(d+"/result.json"));if(!r.iso)return null;const S=JSON.parse(fs.readFileSync(d+"/S.json"));const t0=r.iso.onset.after,tr=r.iso.restore.after;const rel=t=>(t-t0)/1000;const off=(r.clock&&r.clock.sfu&&r.clock.sfu.offsetMs)||0;
 if(!fs.existsSync(d+"/server-events.jsonl"))return null;
 const E=fs.readFileSync(d+"/server-events.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.body&&e.body.type);const ts=e=>e.body.timestamp/1000-off;
 const pj=E.find(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="joined"&&e.body.event.data.id===101);if(!pj)return null;const ph=pj.body.handle_id;
 const sh=E.filter(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="subscribing"&&ts(e)<t0&&JSON.stringify(e.body.event.data.streams||"").includes('"feed_id":101')).map(e=>e.body.handle_id);
 const st=(h)=>E.filter(e=>e.body.type===32&&e.body.subtype===3&&e.body.handle_id===h).map(e=>({t:ts(e),...e.body.event}));
 const up=E.filter(e=>e.body.type===32&&e.body.subtype===1&&e.body.handle_id===ph&&e.body.event.receiving===true&&ts(e)>t0+500)[0];if(!up)return null;const tu=ts(up);
 const burst=(s,k)=>{const pre=s.filter(x=>x.t<t0);if(pre.length<2)return null;const rate=(pre[pre.length-1][k]-pre[0][k])/((pre[pre.length-1].t-pre[0].t)/1000);const a=s.filter(x=>x.t<tu).pop(),b=s.find(x=>x.t>tu+300);if(!a||!b)return null;return ((b[k]-a[k])-rate*(b.t-tu)/1000)/rate;};
 const p=st(ph);const B=burst(p,"packets-received");
 const acts=S.driver.actions.filter(a=>a.kind==="transport_restart");
 // first ICE restart actually executed on the publisher PC = first out frame carrying a jsep offer after onset
 const offers=S.frames.filter(f=>f.dir==="out"&&f.text&&f.t>t0&&/"jsep"/.test(f.text)&&/"type":"offer"/.test(f.text)).map(f=>f.t);
 const iceDisc=S.log.filter(l=>l.type==="pc_ice"&&l.pc===1&&l.state==="disconnected"&&l.t>t0).map(l=>l.t)[0];
 const row={id:r.id,set:d.split("/")[0],mode:r.iso.mode,D:r.iso.plannedS,valid:r.valid,firstAction:acts[0]?rel(acts[0].tStart):null,firstOffer:offers[0]?rel(offers[0]):null,iceDisc:iceDisc?rel(iceDisc):null,rxUp:rel(tu),burst:B,obs:[],sub:[]};
 for(const h of sh){const s=st(h);const pre=s.filter(x=>x.t<tu).pop(),post=s.filter(x=>x.t>tu+300);const last=post[Math.min(post.length-1,3)];row.sub.push({fwd:burst(s,"packets-sent"),lostByRemote:last&&pre?last["lost-by-remote"]-pre["lost-by-remote"]:null,nacks:last&&pre?last["nacks-received"]-pre["nacks-received"]:null});}
 for(const w of ["O1","O2"]){const O=JSON.parse(fs.readFileSync(d+"/"+w+".json"));const base=(O.driver.baseline||{}).S??100;const xs=(O.fresh.S||[]).filter(x=>x.tP>tu-300).sort((a,b)=>a.tP-b.tP);
  const early=xs.filter(x=>x.tP<tu+1500);const head=early.filter(x=>x.age>8000);const body=xs.filter(x=>x.age<8000);const f=body[0];
  row.obs.push({w,resid:(f.age-base)/1000,firstAfter:(f.tP-tu)/1000,headAges:head.map(x=>+(x.age/1000).toFixed(2)),headAt:head.map(x=>+((x.tP-tu)/1000).toFixed(2))});}
 return row;}
const rows=process.argv.slice(2).map(d=>{try{return one(d.replace(/\/$/,""))}catch(e){return null}}).filter(Boolean);
fs.mkdirSync("logs/study/janus-early",{recursive:true});fs.writeFileSync("logs/study/janus-early/backlog-test-"+(process.env.TAG||"out")+".json",JSON.stringify(rows));
const f=(x,d=2)=>x==null?"-":Number(x).toFixed(d);
console.log("set id | D | first action / first offer sent / ICE disconnected | rx resumes | burst (s) | burst−(resume−firstOffer) | per observer: observed residual; predicted (burst mod P) and error for P=4 | head samples (age@t after resume) | sub: forwarded, lost-by-remote, nacks");
for(const r of rows.sort((a,b)=>a.mode.localeCompare(b.mode)||a.D-b.D)){const span=r.firstOffer!=null?r.rxUp-r.firstOffer:null;
 console.log([r.set,r.mode,r.D+"s",r.valid?"":"INVALID","|",f(r.firstAction),"/",f(r.firstOffer),"/",f(r.iceDisc),"|",f(r.rxUp),"|",f(r.burst),"|",f(span!=null?r.burst-span:null),"|",r.obs.map(o=>{const pred=((r.burst%4)+4)%4;return o.w+" obs "+f(o.resid)+" pred "+f(pred)+" err "+f(o.resid-pred)+(o.headAges.length?" head["+o.headAges.join(",")+"@"+o.headAt.join(",")+"]":"")}).join(" ; "),"|",r.sub.map(s=>f(s.fwd)+"/"+s.lostByRemote+"/"+s.nacks).join(" ")].join(" "))}
