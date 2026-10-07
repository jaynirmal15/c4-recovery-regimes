// Receiver and sender WebRTC statistics around resumption (backlog cell). usage: node janus-backlog-stats.cjs [-v] <trialDir...>
const fs=require("fs");const V=process.argv[2]==="-v";const dirs=process.argv.slice(V?3:2);const out=[];
for(const d0 of dirs){const d=d0.replace(/\/$/,"");const r=JSON.parse(fs.readFileSync(d+"/result.json"));if(!r.valid)continue;const S=JSON.parse(fs.readFileSync(d+"/S.json"));const t0=r.iso.onset.after;const rel=t=>(t-t0)/1000;const off=(r.clock.sfu&&r.clock.sfu.offsetMs)||0;
 const E=fs.readFileSync(d+"/server-events.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.body&&e.body.type);const ts=e=>e.body.timestamp/1000-off;
 const ph=E.find(e=>e.body.type===64&&e.body.event.data&&e.body.event.data.event==="joined"&&e.body.event.data.id===101).body.handle_id;
 const up=E.filter(e=>e.body.type===32&&e.body.subtype===1&&e.body.handle_id===ph&&e.body.event.receiving===true&&ts(e)>t0+500)[0];const tu=ts(up);
 const offer=S.frames.filter(f=>f.dir==="out"&&f.text&&f.t>t0&&/"jsep"/.test(f.text)&&/"type":"offer"/.test(f.text)).map(f=>f.t)[0];
 const row={id:r.id,D:r.iso.plannedS,offer:rel(offer),rxUp:rel(tu),sender:{},obs:[]};
 // sender: outbound-rtp on the publisher PC (pc 1)
 const ob=S.stats.filter(x=>x.type==="outbound-rtp"&&x.pc===1).sort((a,b)=>a.t-b.t);const at=(arr,t)=>arr.filter(x=>x.t<=t).pop();
 const o0=at(ob,t0),oOff=at(ob,offer),oPre=at(ob,tu-300),oPost=ob.find(x=>x.t>tu+1000),oEnd=ob.find(x=>x.t>tu+6000);
 const pps=(a,b)=>(b.packetsSent-a.packetsSent)/((b.t-a.t)/1000);
 row.sender={sentOnsetToOffer:oOff.packetsSent-o0.packetsSent,secOnsetToOffer:(oOff.t-o0.t)/1000,sentOfferToResume:oPre.packetsSent-oOff.packetsSent,secOfferToResume:(oPre.t-oOff.t)/1000,sentAcrossResume:oPost.packetsSent-oPre.packetsSent,secAcrossResume:(oPost.t-oPre.t)/1000,sendDelayAcrossResume:oPost.totalPacketSendDelay-oPre.totalPacketSendDelay,sendDelayBefore:oPre.totalPacketSendDelay-o0.totalPacketSendDelay,rateAfter:pps(oPost,oEnd)};
 const cp=S.stats.filter(x=>x.type==="candidate-pair"&&x.pc===1).sort((a,b)=>a.t-b.t);const cpPre=at(cp,tu-300),cp0=at(cp,t0),cpPost=cp.filter(x=>x.t>tu+1000)[0];
 row.sender.discardOnSend=cpPre&&cp0?(cpPre.packetsDiscardedOnSend||0)-(cp0.packetsDiscardedOnSend||0):null;
 if(V){console.log("\n##",r.id,"offer",rel(offer).toFixed(2),"rxUp",rel(tu).toFixed(2));console.log(" S outbound (t: packetsSent, totalPacketSendDelay):",ob.filter(x=>x.t>t0-600&&x.t<tu+3000).filter((x,i)=>i%6==0||Math.abs(x.t-tu)<800).map(x=>rel(x.t).toFixed(1)+":"+x.packetsSent+"/"+(x.totalPacketSendDelay||0).toFixed(1)).join("  "));}
 for(const w of ["O1","O2"]){const O=JSON.parse(fs.readFileSync(d+"/"+w+".json"));const base=(O.driver.baseline||{}).S??100;
  // S's inbound stream = the receive PeerConnection whose packet count is flat during the outage (track ids are not unique on Janus)
  const pcs=[...new Set(O.stats.filter(x=>x.type==="inbound-rtp").map(x=>x.pc))];const flat=pcs.map(pc=>{const z=O.stats.filter(x=>x.type==="inbound-rtp"&&x.pc===pc&&x.t>t0+3000&&x.t<tu-1000);return {pc,d:z.length?z[z.length-1].packetsReceived-z[0].packetsReceived:1e9}}).sort((a,b)=>a.d-b.d)[0];
  const ib=O.stats.filter(x=>x.type==="inbound-rtp"&&x.pc===flat.pc).sort((a,b)=>a.t-b.t);
  const pre=at(ib,tu-300),p1=ib.find(x=>x.t>tu+1500),end=ib.find(x=>x.t>tu+20000)||ib[ib.length-1],on=at(ib,t0);
  const xs=(O.fresh.S||[]).filter(x=>x.tP>tu-300&&x.age<8000).sort((a,b)=>a.tP-b.tP);const f=xs[0];
  const dj=(a,b)=>(b.jitterBufferEmittedCount-a.jitterBufferEmittedCount)>0?(b.jitterBufferDelay-a.jitterBufferDelay)/(b.jitterBufferEmittedCount-a.jitterBufferEmittedCount):null;
  const win=ib.filter(x=>x.t>tu-300&&x.t<tu+2500);
  const live=at(ib,t0-200),live0=at(ib,t0-5200);const rate=(live.packetsReceived-live0.packetsReceived)/((live.t-live0.t)/1000);
  const o={w,resid:(f.age-base)/1000,burstPk:Math.round((p1.packetsReceived-pre.packetsReceived)-rate*(p1.t-tu)/1000),rxBurstPk:p1.packetsReceived-pre.packetsReceived,rxBurstSec:(p1.t-pre.t)/1000,lost:p1.packetsLost-pre.packetsLost,discarded:p1.packetsDiscarded-pre.packetsDiscarded,discardedLater:end.packetsDiscarded-p1.packetsDiscarded,
   samplesRx:(p1.totalSamplesReceived-pre.totalSamplesReceived)/48000,concealed:(p1.concealedSamples-pre.concealedSamples)/48000,accelRemovedBurst:(p1.removedSamplesForAcceleration-pre.removedSamplesForAcceleration)/48000,accelRemovedLater:(end.removedSamplesForAcceleration-p1.removedSamplesForAcceleration)/48000,
   jbDelayAfter:dj(p1,ib.find(x=>x.t>p1.t+1000)||end),jbTargetAfter:p1.jitterBufferTargetDelay!==undefined?null:null,jbDelayBefore:dj(at(ib,t0-3000),on),fec:p1.fecPacketsDiscarded-pre.fecPacketsDiscarded};
  row.obs.push(o);
  if(V)console.log(" "+w+" inbound S (t: pkRecv/discarded/lost | avg jb delay ms over prev interval):",win.filter((x,i)=>i%1==0).map((x,i,a)=>rel(x.t).toFixed(2)+":"+x.packetsReceived+"/"+x.packetsDiscarded+"/"+x.packetsLost+(i?"|"+((dj(a[i-1],x)||0)*1000).toFixed(0):"")).join("  ").slice(0,900));}
 out.push(row);}
fs.mkdirSync("logs/study/janus-early",{recursive:true});fs.writeFileSync("logs/study/janus-early/backlog-cell-stats.json",JSON.stringify(out));
const f=(x,d=2)=>x==null?"-":Number(x).toFixed(d);
console.log("\nSENDER (S publisher): packets sent onset→first offer | first offer→just before resume | across resume (≈1.3 s) and added send delay (s) | discardedOnSend");
for(const r of out)console.log(r.D+"s",r.id.slice(-12),"|",r.sender.sentOnsetToOffer,"in",f(r.sender.secOnsetToOffer,1)+"s","|",r.sender.sentOfferToResume,"in",f(r.sender.secOfferToResume,1)+"s","|",r.sender.sentAcrossResume,"in",f(r.sender.secAcrossResume,1)+"s, send delay +"+f(r.sender.sendDelayAcrossResume,1)+" s (before: +"+f(r.sender.sendDelayBefore,1)+")","|",r.sender.discardOnSend);
console.log("\nRECEIVERS (inbound stream from S), across resume: packets received | lost | discarded (burst / later) | samples received (s) | removed by acceleration burst/later (s) | avg jitter-buffer delay just after (s) | residual from audio clock (s)");
for(const r of out)for(const o of r.obs)console.log(r.D+"s",r.id.slice(-12),o.w,"| burst",o.burstPk,"pk ("+f(o.burstPk/50,2)+" s)","|",o.lost,"|",o.discarded,"("+f(o.discarded/50,1)+" s) /",o.discardedLater,"|",f(o.samplesRx,1),"|",f(o.accelRemovedBurst,1),"/",f(o.accelRemovedLater,1),"|",f(o.jbDelayAfter),"|",f(o.resid),"|",f((o.burstPk-o.discarded-o.lost)/50));
