// Janus: server reception vs forwarding vs observer playout, per trial (read-only analysis of study/)
const fs=require("fs"),path=require("path");
const rows=[];
for(const d of fs.readdirSync("study").filter(x=>x.startsWith("janus-iso")).map(x=>"study/"+x)){
 const r=JSON.parse(fs.readFileSync(d+"/result.json"));if(!r.valid)continue;const S=JSON.parse(fs.readFileSync(d+"/S.json"));
 const t0=r.iso.onset.after,tr=r.iso.restore.after;const rel=t=>(t-t0)/1000;const off=(r.clock.sfu&&r.clock.sfu.offsetMs)||0;
 const E=fs.readFileSync(d+"/server-events.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.body&&e.body.type&&e.path!=="/c4-marker");
 const ts=e=>e.body.timestamp/1000-off;
 const pubH=new Set(E.filter(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="joined"&&e.body.event.data.id===101).map(e=>e.body.handle_id));
 const subH=new Set(E.filter(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="subscribing"&&JSON.stringify(e.body.event.data.streams||"").includes('"feed_id":101')).map(e=>e.body.handle_id));
 const med=E.filter(e=>e.body.type===32&&e.body.subtype===1&&pubH.has(e.body.handle_id)&&ts(e)>t0);
 const rxDown=med.find(e=>e.body.event.receiving===false),rxUp=rxDown&&med.find(e=>e.body.event.receiving===true&&ts(e)>ts(rxDown));
 const stats=h=>E.filter(e=>e.body.type===32&&e.body.subtype===3&&e.body.handle_id===h).map(e=>({t:ts(e),rx:e.body.event["packets-received"],tx:e.body.event["packets-sent"]})).sort((a,b)=>a.t-b.t);
 // publisher: rate before onset, and "lost seconds" = elapsed - packets/rate between last pre-onset stat and a stat >= 20 s after rx resume
 const lostSec=(st,key,tEnd)=>{const pre=st.filter(x=>x.t<t0);if(pre.length<3)return null;const a=pre[0],b=pre[pre.length-1];const rate=(b[key]-a[key])/((b.t-a.t)/1000);const post=st.filter(x=>x.t>tEnd);if(!post.length||!rate)return null;const c=post[0];return {lost:(c.t-b.t)/1000-(c[key]-b[key])/rate,rate};};
 const ph=[...pubH][0];const pst=stats(ph);const act=S.driver.actions.filter(a=>a.kind==="transport_restart");
 const okAct=act.find(a=>a.result.ok);
 const pc1=S.log.filter(l=>l.type==="pc_ice"&&l.pc===1&&l.state==="connected"&&l.t>t0).map(l=>l.t)[0];
 const tEnd=(rxUp?ts(rxUp):tr)+15000;
 const pl=lostSec(pst,"rx",tEnd);
 const fw=[...subH].map(h=>lostSec(stats(h),"tx",tEnd)).filter(Boolean);
 const row={id:r.id,mode:r.iso.mode,D:r.iso.plannedS,restore:rel(tr),nRestarts:act.length,okStart:okAct?rel(okAct.tStart):null,pc1Conn:pc1?rel(pc1):null,restartToConn:okAct&&pc1?(pc1-okAct.tStart)/1000:null,
  rxDown:rxDown?rel(ts(rxDown)):null,rxUp:rxUp?rel(ts(rxUp)):null,rate:pl&&pl.rate,rxLostSec:pl&&pl.lost,fwLostSec:fw.map(x=>x.lost),obs:{}};
 for(const w of ["O1","O2"]){const O=JSON.parse(fs.readFileSync(d+"/"+w+".json"));const xs=(O.fresh.S||[]).slice().sort((a,b)=>a.tP-b.tP);const base=(O.driver.baseline||{}).S??100;
  const after=xs.filter(x=>x.tP>=Math.min(tr,rxUp?ts(rxUp):tr)-200&&x.age<35000);const first=after[0];
  // fresh-start: first sample from which age<=base+250 holds continuously for 1 s (start of interval), and fresh-end = start+1 s
  let fs0=null;const all=xs.filter(x=>x.tP>=t0);for(let i=0;i<all.length;i++){if(all[i].age>base+250)continue;let j=i+1,good=true;while(j<all.length&&all[j].tP<=all[i].tP+1000){if(all[j].age>base+250||all[j].tP-all[j-1].tP>300){good=false;break}j++}if(good&&j<all.length){fs0=all[i].tP;break}}
  // disturbed?
  let dist=null,prev=t0;for(const s of all){if(s.tP-prev>300||s.age>1000){dist=prev;break}prev=s.tP}
  let fresh=null;if(dist!=null){const a2=xs.filter(x=>x.tP>=dist);for(let i=0;i<a2.length;i++){if(a2[i].age>base+250)continue;let j=i+1,good=true;while(j<a2.length&&a2[j].tP<=a2[i].tP+1000){if(a2[j].age>base+250||a2[j].tP-a2[j-1].tP>300){good=false;break}j++}if(good&&j<a2.length){fresh=a2[i].tP;break}}}
  // drain rate between age crossing 2000 and 500
  const p1=after.find(x=>x.age<=2000),p2=after.find(x=>x.age<=500);
  row.obs[w]={base,firstT:first?rel(first.tP):null,firstAge:first?first.age:null,fresh:fresh?rel(fresh):null,drain:p1&&p2&&p2.tP>p1.tP&&first.age>2000?(p1.age-p2.age)/(p2.tP-p1.tP):null};}
 rows.push(row);}
fs.writeFileSync("logs/study/janus-early/janus-reception-vs-playout.json",JSON.stringify(rows));
const f=(x,d=2)=>x==null?"-":Number(x).toFixed(d);
rows.sort((a,b)=>a.mode.localeCompare(b.mode)||a.D-b.D);
console.log("mode D | restore | restarts okStart pc1Conn restart→conn | srv rx stop→resume | rx lost s (D−lost=burst s) | fwd lost s (2 subs) | O1 first t/age  fresh  lag vs rxUp | O2 first t/age fresh lag | drain ms/s");
for(const r of rows){const burst=r.rxLostSec!=null?r.D-r.rxLostSec:null;console.log([r.mode.padEnd(5),String(r.D).padStart(2),"|",f(r.restore),"|",r.nRestarts,f(r.okStart),f(r.pc1Conn),f(r.restartToConn),"|",f(r.rxDown),"→",f(r.rxUp),"|",f(r.rxLostSec),"("+f(burst)+")","|",r.fwLostSec.map(x=>f(x)).join(","),"|",f(r.obs.O1.firstT),"/",f(r.obs.O1.firstAge,0),f(r.obs.O1.fresh),f(r.obs.O1.fresh!=null&&r.rxUp!=null?r.obs.O1.fresh-r.rxUp:null),"|",f(r.obs.O2.firstT),"/",f(r.obs.O2.firstAge,0),f(r.obs.O2.fresh),f(r.obs.O2.fresh!=null&&r.rxUp!=null?r.obs.O2.fresh-r.rxUp:null),"|",f(r.obs.O1.drain?r.obs.O1.drain*1000:null,0)].join(" "))}
