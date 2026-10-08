// Why some LiveKit server logs are short (read-only). usage, from the repository root: node client/runner/log-coverage.cjs
// Trial set: every directory under study/ and study-r2/ whose name starts with "livekit" and that holds a
// result.json, enumerated at run time and taken in order of trial start within each set (one lab session each).
// The runner collects the log with `kubectl logs --since-time=<trial start>`, which reads the container's current
// log file only. If the node rotates that file during a trial, the lines before the rotation are not returned.
// Test: if rotation by size is the cause, the bytes written between consecutive cut points should be constant.
// For a cut trial the bytes written before the cut are estimated as (median size of the complete logs of the same
// condition in the same set) - (bytes kept); that estimate is the only inferred quantity and is used for this test alone.
const fs=require('fs');const med=v=>{v=v.slice().sort((a,b)=>a-b);return v[v.length>>1]};const rows=[];
for(const set of ['study','study-r2'])for(const d of fs.readdirSync(set).filter(x=>x.startsWith('livekit')&&fs.existsSync(set+'/'+x+'/result.json'))){const dir=set+'/'+d;const r=JSON.parse(fs.readFileSync(dir+'/result.json'));const p=dir+'/server-livekit.log';const sz=fs.existsSync(p)?fs.statSync(p).size:-1;let first=null,startup=0;if(sz>0){const t=fs.readFileSync(p,'utf8');first=Date.parse(t.slice(0,t.indexOf('\n')).split(/\s/)[0]);startup=(t.match(/starting LiveKit server/g)||[]).length}
 rows.push({set,d,cond:r.iso.mode+'-'+r.iso.plannedS,tStart:Date.parse(r.tStart),t0:r.iso.onset.after,sz,first,startup,pod:(JSON.parse(fs.readFileSync(dir+'/preconditions.json')).placement.livekit[0]||{}).name})}
for(const set of ['study','study-r2']){const g=rows.filter(r=>r.set===set).sort((a,b)=>a.tStart-b.tStart);const norm=med(g.filter(r=>r.sz>0).map(r=>(r.first-r.tStart)/1000));
 const full=r=>r.sz>0&&(r.first-r.tStart)/1000<norm+0.8;const by={};for(const r of g.filter(full))(by[r.cond]=by[r.cond]||[]).push(r.sz);
 const cut=g.filter(r=>!full(r)&&r.sz>0),empty=g.filter(r=>r.sz<=0);
 console.log('\n'+set+': LiveKit trials',g.length,'| server pods',[...new Set(g.map(r=>r.pod))].join(', '),'| "starting LiveKit server" lines in any log:',g.reduce((n,r)=>n+r.startup,0));
 console.log('  first log line is typically',norm.toFixed(1),'s after trial start | complete',g.filter(full).length,'| head missing',cut.length,'(first line after isolation onset in',cut.filter(r=>r.first>r.t0).length+', before it in',cut.filter(r=>r.first<=r.t0).length+') | empty',empty.length);
 let cum=0;const spans=[];for(const r of g){if(full(r)){cum+=r.sz;continue}const est=med(by[r.cond]||[NaN]);const kept=Math.max(0,r.sz);spans.push((cum+Math.max(0,est-kept))/1048576);cum=kept}
 const s=spans.slice(1).filter(x=>x===x);console.log('  bytes written between consecutive cut points, MiB (n '+s.length+'): min',Math.min(...s).toFixed(2),'median',med(s).toFixed(2),'max',Math.max(...s).toFixed(2),'| between 9.9 and 11.3 MiB:',s.filter(x=>x>=9.9&&x<=11.3).length,'| others:',s.filter(x=>x<9.9||x>11.3).map(x=>x.toFixed(1)).join(', ')||'none');
 console.log('  not usable for the removal race (empty, or first line after onset):',[...empty,...cut.filter(r=>r.first>r.t0)].map(r=>r.d).sort().join(' '))}
