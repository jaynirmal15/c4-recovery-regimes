// Substitution error in operator units (read-only). usage, from the repository root: node client/runner/substitution.cjs
// Trial set: every row of the dataset index logs/study/divergence-final.json (the 215), as written by
// divergence.mjs and final-dataset.mjs. Nothing is listed by name. One participant (S) per trial.
// Unit: a second of receiver-defined interruption of S, i.e. first stale at either observer to fresh again at
// both (truth.down .. truth.up). Each rule below is the minimal rule a documented use of the surface implies;
// none is a vendor-published alerting rule, and rule 3 has no documented basis at all.
//   1  alert on a membership event about S (layer A_membership)
//   2  count S as present while the participant-state API lists it present, active and publishing (A_state)
//   3  downtime = from S's departure to its return, in membership events (A_membership down .. up)
//   4  Janus only: downtime = from "not receiving" to "receiving" on S's publisher handle (A_media down .. up)
//   5  LiveKit only, client-facing: the connection-quality interval (B_obs_quality down .. up)
const fs=require('fs');const R=JSON.parse(fs.readFileSync('logs/study/divergence-final.json','utf8'));
const sum=v=>v.reduce((a,b)=>a+b,0);const rng=v=>v.length?Math.min(...v).toFixed(1)+'–'+Math.max(...v).toFixed(1):'–';const med=v=>{v=v.slice().sort((a,b)=>a-b);return v[Math.floor((v.length-1)/2)]};
const out=r=>r.truth.up-r.truth.down;const dur=l=>l.down!=null&&l.up!=null?l.up-l.down:0;
console.log('trials',R.length,'| receiver-defined interruption, total s:',sum(R.map(out)).toFixed(0));
for(const st of ['livekit','janus','both']){const g=R.filter(r=>st==='both'||r.stack===st);const surv=g.filter(r=>r.regime!=='R2'),reb=g.filter(r=>r.regime==='R2');const tot=sum(g.map(out));
 console.log('\n== '+st+': trials',g.length,'| survived',surv.length,'| rebuilt',reb.length,'| interruption total',tot.toFixed(0),'s');
 console.log(' rule 1: no membership event in',surv.filter(r=>r.layers.A_membership.kind==='nothing').length,'of',surv.length,'surviving interruptions ('+rng(surv.map(out))+' s each, total',sum(surv.map(out)).toFixed(0),'s; lasting 15 s or more:',surv.filter(r=>out(r)>=15).length+', 30 s or more:',surv.filter(r=>out(r)>=30).length+')');
 if(reb.length)console.log('         rebuilds: event',rng(reb.map(r=>r.layers.A_membership.onsetDelay)),'s after first stale (median',med(reb.map(r=>r.layers.A_membership.onsetDelay)).toFixed(1)+'), after',rng(reb.map(r=>100*r.layers.A_membership.blindFrac)),'% of the interruption; return reported',rng(reb.map(r=>r.layers.A_membership.upError)),'s relative to fresh again');
 const pres=g.map(r=>{const l=r.layers.A_state;const end=l.down!=null?Math.min(l.down,r.truth.up):r.truth.up;return Math.max(0,end-r.truth.down)});
 console.log(' rule 2: S listed present for',sum(pres).toFixed(0),'of',tot.toFixed(0),'s of interruption =',(100*sum(pres)/tot).toFixed(1)+'%');
 const md=g.map(r=>dur(r.layers.A_membership));console.log(' rule 3: downtime from membership events',sum(md).toFixed(0),'of',tot.toFixed(0),'s =',(100*sum(md)/tot).toFixed(1)+'% | trials with any:',md.filter(x=>x>0).length,'of',g.length);
 if(st!=='livekit'){const j=g.filter(r=>r.stack==='janus');const jt=sum(j.map(out));const mt=j.map(r=>dur(r.layers.A_media));console.log(' rule 4 (Janus): events in',j.filter(r=>r.layers.A_media.kind!=='nothing').length,'of',j.length,'| downtime from reception events',sum(mt).toFixed(0),'of',jt.toFixed(0),'s =',(100*sum(mt)/jt).toFixed(1)+'%');
  for(const mo of ['all','media']){const h=j.filter(r=>r.mode===mo);const hm=h.map(r=>dur(r.layers.A_media));console.log('         '+(mo==='all'?'full':'media-only')+':',sum(hm).toFixed(0),'of',sum(h.map(out)).toFixed(0),'s =',(100*sum(hm)/sum(h.map(out))).toFixed(1)+'% | per-trial shortfall',rng(h.map((r,i)=>out(r)-hm[i])),'s')}
  console.log('         no event:',j.filter(r=>r.layers.A_media.kind==='nothing').map(r=>(r.mode==='all'?'full':'media-only')+' '+r.D+' s').join(', '))}
 if(st!=='janus'){const l=g.filter(r=>r.stack==='livekit');const lt=sum(l.map(out));const q=l.map(r=>dur(r.layers.B_obs_quality));const d=l.map((r,i)=>q[i]-out(r));console.log(' rule 5 (LiveKit, client-facing): quality interval',sum(q).toFixed(0),'of',lt.toFixed(0),'s =',(100*sum(q)/lt).toFixed(1)+'% | per trial, interval minus interruption',rng(d),'s | differs by more than 5 s in',d.filter(x=>Math.abs(x)>5).length,'of',l.length)}}
