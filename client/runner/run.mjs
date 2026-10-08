// C4 Stage B runner (Mac side). Drives client pods via `kubectl exec`, enforces the
// STAGE-A-SPEC §3.1 hard preconditions (abort => one line in logs/aborts.log, NO record),
// runs trials, collects client + server evidence, marks invalidations (§3.3).
//   node run.mjs setup | switch <stack> | targeted <stack> <test> <n> [arm] | placement-selftest <stack>
//   C4_CONTROL=1 C4_CLIENT_BUILD=pre-sampler node run.mjs control <stack>   (healthy-session control arm)
//   C4_CONTROL=1 C4_CLIENT_BUILD=pre-sampler node run.mjs threshold livekit (R2: detection threshold, REGISTRATION-R2-detection-threshold.md)
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NS = 'c4-clients';
const TRIALS = process.env.C4_TRIALS || 'trials'; // output directory under ROOT
const IMG = 'mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'; // v1.62.1-noble
const PIN = { livekitImage: 'sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3', janusImage: 'sha256:ec3fa4e0b2987ae47be353f56854191e300261915470e40165b1c906d22a65db', janusVersion: '1.4.1', reclaim: 30, sessionTimeout: 60, lkClient: '2.22.3', playwright: '1.62.1' };
const PODS = { S: 'c4-s', O1: 'c4-o1', O2: 'c4-o2' };
const FEED = { S: 101, O1: 102, O2: 103, B: 104 };
// Control arm (healthy sessions, approved 2026-10-07). No isolation; 180 s of armed observation.
//   h0 idle | h1 a non-publishing bystander joins and leaves | h2 a publishing bystander joins and leaves | h3 S muted for 10 s
const CONTROL = process.env.C4_CONTROL === '1';
const CONTROL_TESTS = ['h0', 'h1', 'h2', 'h3'];
const CONTROL_OBSERVE_S = 180;
// Node software of the three study sessions and the follow-up cell (`kubectl get nodes -o wide` in their job logs).
const NODE_PIN = { kubeletVersion: 'v1.36.4-eks-f4fc4f1', osImage: 'Amazon Linux 2023.12.20260918', kernelVersion: '6.18.48-109.150.amzn2023.aarch64', containerRuntimeVersion: 'containerd://2.2.7+unknown' };
/** Client page files as deployed. C4_CLIENT_BUILD=pre-sampler takes common.js and driver.js as
 *  saved just before the statistics sampler was added (2026-10-06), i.e. the build of the 215. */
function wwwSources() {
  const www = path.join(ROOT, 'client/www'); const early = path.join(ROOT, 'logs/study/janus-early');
  const src = Object.fromEntries(['common.js', 'lkproto.js', 'lk.js', 'janus.js', 'driver.js'].map((f) => [f, path.join(www, f)]));
  if (process.env.C4_CLIENT_BUILD === 'pre-sampler') { src['common.js'] = path.join(early, 'common.js.before-stats'); src['driver.js'] = path.join(early, 'driver.js.before-stats'); }
  if (CONTROL) src['control-arm.js'] = path.join(www, 'control-arm.js');
  return src;
}
const wwwHashes = () => Object.fromEntries(Object.entries(wwwSources()).sort().map(([f, p]) => [f, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const SINK = { livekit: 'http://event-sink.c4-livekit.svc.cluster.local:8080', janus: 'http://event-sink.c4-janus.svc.cluster.local:8080' };
const CLOCK_UNC_BOUND_MS = 10; // spec §3.1.5: a probe with larger uncertainty invalidates the trial
const sinkCall = (stack, route, method = 'GET', body) => pod(PODS.S, 'POST', '/fetch', { url: `${SINK[stack]}${route}`, method, body });

/** Server-event channel completeness (spec §3.3), checked AT THE TRIAL, not in later analysis. */
function checkServerEvents(stack, room, id, head0, head1, range) {
  const bad = [];
  if (!head0 || !head1 || !range) return ['server-event channel: sink unreachable'];
  if (head0.bootId !== head1.bootId || range.bootId !== head0.bootId) bad.push('server-event channel: sink restarted during the trial (bootId changed)');
  const ev = range.events || [];
  const want = head1.seq - head0.seq;
  if (ev.length !== want) bad.push(`server-event channel: expected ${want} events (seq ${head0.seq + 1}..${head1.seq}), got ${ev.length}`);
  for (let i = 0; i < ev.length; i++) if (ev[i].seq !== head0.seq + 1 + i) { bad.push(`server-event channel: sequence gap at ${ev[i].seq}`); break; }
  const markers = ev.filter((e) => e.path === '/c4-marker' && e.body && e.body.trial === id).map((e) => e.body.phase);
  for (const ph of ['start', 'end']) if (!markers.includes(ph)) bad.push(`server-event channel: ${ph} marker missing`);
  const n = stack === 'livekit'
    ? ev.filter((e) => e.path === '/livekit-webhook' && e.body && e.body.event === 'participant_joined' && e.body.room && e.body.room.name === room).length
    : ev.filter((e) => e.path === '/janus-events' && e.body && e.body.type === 64 && e.body.event && e.body.event.data && e.body.event.data.event === 'joined' && e.body.event.data.room === room).length;
  if (n < 3) bad.push(`server-event channel: only ${n} of 3 participant-joined events for this room`);
  return bad;
}

/** Client<->SFU clock offset from evidence the trial already produced (spec §3.1.5).
 *  offset = server clock - client clock; uncertainty = half the round trip. */
function sfuClock(stack, S, events) {
  const xs = [];
  if (stack === 'livekit') {
    const P = createRequire(import.meta.url)('@livekit/protocol');
    for (const f of S.frames) {
      if (f.dir !== 'in' || !f.b64) continue;
      let m; try { m = P.SignalResponse.fromBinary(Buffer.from(f.b64, 'base64')).message; } catch { continue; }
      if (m.case !== 'pongResp') continue;
      const sent = Number(m.value.lastPingTimestamp), srv = Number(m.value.timestamp);
      if (sent > 0 && srv > 0 && f.t >= sent) xs.push({ offsetMs: srv - (sent + f.t) / 2, uncMs: (f.t - sent) / 2 });
    }
    if (!xs.length) return null;
    const best = xs.reduce((a, b) => (b.uncMs < a.uncMs ? b : a));
    return { method: 'livekit ping/pong (pongResp.timestamp)', ...best, n: xs.length, resolutionMs: 1 };
  }
  // Janus: client create/attach round trip vs the event handler's own timestamp for the same id
  const out = new Map(); // transaction -> t
  for (const f of S.frames) { if (!f.text) continue; let m; try { m = JSON.parse(f.text); } catch { continue; }
    if (f.dir === 'out' && (m.janus === 'create' || m.janus === 'attach')) out.set(`${f.ws}:${m.transaction}`, f.t);
    if (f.dir === 'in' && m.janus === 'success' && m.data && m.data.id && out.has(`${f.ws}:${m.transaction}`)) {
      const id = m.data.id, t1 = out.get(`${f.ws}:${m.transaction}`), t2 = f.t;
      const e = events.find((x) => x.path === '/janus-events' && x.body && ((x.body.type === 1 && x.body.session_id === id && x.body.event.name === 'created') || (x.body.type === 2 && x.body.handle_id === id && x.body.event.name === 'attached')));
      if (e) xs.push({ offsetMs: e.body.timestamp / 1000 - (t1 + t2) / 2, uncMs: (t2 - t1) / 2 });
    } }
  if (!xs.length) return null;
  const best = xs.reduce((a, b) => (b.uncMs < a.uncMs ? b : a));
  return { method: 'janus create/attach vs event-handler timestamp', ...best, n: xs.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[${nowIso().slice(11, 23)}]`, ...a);

const kc = (args, opts = {}) => execFileSync('kubectl', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
const kjson = (args) => JSON.parse(kc([...args, '-o', 'json']));

/** Call the pod's control server through `kubectl exec` + node (no curl, no stdin: an empty
 *  stdin over `exec -i` never delivered EOF and hung for minutes). Body travels as base64 argv. */
function pod(podName, method, route, body) {
  const script = `(async()=>{try{const b=process.argv[1]?Buffer.from(process.argv[1],'base64').toString():undefined;const r=await fetch('http://127.0.0.1:9000'+process.argv[2],{method:process.argv[3],headers:{'content-type':'application/json'},body:process.argv[3]==='GET'?undefined:(b||'{}')});process.stdout.write(await r.text())}catch(e){process.stdout.write(JSON.stringify({error:String(e)}))}})()`;
  const b64 = body ? Buffer.from(JSON.stringify(body)).toString('base64') : '';
  const out = kc(['exec', '-n', NS, podName, '--', 'node', '-e', script, b64, route, method], { timeout: 180000 });
  const j = JSON.parse(out);
  if (j && j.error) throw new Error(`${podName} ${route}: ${String(j.error).slice(0, 600)}`);
  return j;
}

// ---------------------------------------------------------------- setup ----
function setup() {
  kc(['create', 'namespace', NS, '--dry-run=client', '-o', 'yaml']) && execFileSync('sh', ['-c', `kubectl create namespace ${NS} --dry-run=client -o yaml | kubectl apply -f - >/dev/null`]);
  const key = Buffer.from(kc(['-n', 'c4-livekit', 'get', 'secret', 'lk-cli-env', '-o', 'jsonpath={.data.LIVEKIT_API_KEY}']), 'base64').toString();
  const sec = Buffer.from(kc(['-n', 'c4-livekit', 'get', 'secret', 'lk-cli-env', '-o', 'jsonpath={.data.LIVEKIT_API_SECRET}']), 'base64').toString();
  execFileSync('sh', ['-c', `kubectl -n ${NS} create secret generic c4-lk --from-literal=LIVEKIT_API_KEY="$K" --from-literal=LIVEKIT_API_SECRET="$S" --dry-run=client -o yaml | kubectl apply -f - >/dev/null`], { env: { ...process.env, K: key, S: sec } });
  log('setup', 'client build', process.env.C4_CLIENT_BUILD || 'current', JSON.stringify(wwwHashes()));
  execFileSync('sh', ['-c', `kubectl -n ${NS} create configmap c4-www ${Object.entries(wwwSources()).map(([f, p]) => `--from-file=${f}=${p}`).join(' ')} --dry-run=client -o yaml | kubectl apply -f - >/dev/null`]);
  execFileSync('sh', ['-c', `kubectl -n ${NS} create configmap c4-pod --from-file=${ROOT}/client/pod/control.mjs --dry-run=client -o yaml | kubectl apply -f - >/dev/null`]);
  for (const [role, name] of Object.entries(PODS)) {
    const netadmin = role === 'S';
    const manifest = {
      apiVersion: 'v1', kind: 'Pod',
      metadata: { name, namespace: NS, labels: { app: 'c4client', 'c4.role': 'client', 'c4.participant': role } },
      spec: {
        restartPolicy: 'Never', terminationGracePeriodSeconds: 5,
        affinity: {
          podAntiAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [
            { topologyKey: 'kubernetes.io/hostname', namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'coturn' } }, labelSelector: { matchLabels: { 'app.kubernetes.io/name': 'coturn' } } },
            { topologyKey: 'kubernetes.io/hostname', namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'c4-livekit' } }, labelSelector: { matchLabels: { 'app.kubernetes.io/name': 'livekit-server' } } },
            { topologyKey: 'kubernetes.io/hostname', namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'c4-janus' } }, labelSelector: { matchLabels: { app: 'janus' } } },
          ] },
          // all clients on ONE node: one clock (spec §3.1.5)
          podAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{ topologyKey: 'kubernetes.io/hostname', labelSelector: { matchLabels: { 'c4.role': 'client' } } }] },
        },
        containers: [{
          name: 'client', image: IMG,
          securityContext: { capabilities: { add: netadmin ? ['NET_ADMIN'] : [] } },
          env: [{ name: 'POD_ROLE', value: role }],
          envFrom: [{ secretRef: { name: 'c4-lk' } }],
          command: ['/bin/bash', '-c'],
          args: [`set -euo pipefail
${netadmin ? 'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables >/dev/null && iptables -S >/dev/null' : 'true'}
mkdir -p /work /c4/www && cd /work && npm init -y >/dev/null && npm install --no-audit --no-fund --silent playwright@${PIN.playwright} livekit-client@${PIN.lkClient}
cp /cfg-www/* /c4/www/ && cp /cfg-pod/control.mjs /work/
exec node control.mjs`],
          volumeMounts: [{ name: 'www', mountPath: '/cfg-www' }, { name: 'podsrc', mountPath: '/cfg-pod' }],
          resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { memory: '1536Mi' } },
        }],
        volumes: [{ name: 'www', configMap: { name: 'c4-www' } }, { name: 'podsrc', configMap: { name: 'c4-pod' } }],
      },
    };
    execFileSync('sh', ['-c', `kubectl -n ${NS} delete pod ${name} --ignore-not-found --wait=true >/dev/null`]);
    kc(['apply', '-f', '-'], { input: JSON.stringify(manifest) });
  }
  for (const name of Object.values(PODS)) {
    for (let i = 0; i < 120; i++) { try { const h = pod(name, 'GET', '/health'); log(name, 'ready', JSON.stringify(h)); break; } catch { execFileSync('sleep', ['3']); } if (i === 119) throw new Error(`${name} never ready`); }
  }
}

// ---------------------------------------------------------------- stacks ---
function switchStack(stack) {
  const [act, idle] = stack === 'livekit' ? [['c4-livekit', 'livekit-livekit-server'], ['c4-janus', 'janus']] : [['c4-janus', 'janus'], ['c4-livekit', 'livekit-livekit-server']];
  kc(['-n', idle[0], 'scale', `deploy/${idle[1]}`, '--replicas=0']);
  kc(['-n', act[0], 'scale', `deploy/${act[1]}`, '--replicas=1']);
  execFileSync('sh', ['-c', `kubectl -n ${idle[0]} wait --for=delete pod -l ${idle[0] === 'c4-janus' ? 'app=janus' : 'app.kubernetes.io/name=livekit-server'} --timeout=120s >/dev/null 2>&1 || true`]);
  kc(['-n', act[0], 'rollout', 'status', `deploy/${act[1]}`, '--timeout=8m']);
  log(`switched to ${stack}`);
}

function sfu(stack) {
  const [ns, sel] = stack === 'livekit' ? ['c4-livekit', 'app.kubernetes.io/name=livekit-server'] : ['c4-janus', 'app=janus'];
  const p = kjson(['-n', ns, 'get', 'pods', '-l', sel]).items.filter((x) => !x.metadata.deletionTimestamp);
  if (p.length !== 1) return null;
  const ip = p[0].status.podIP;
  return stack === 'livekit'
    ? { pod: p[0], ip, ws: `ws://${ip}:31880`, http: `http://${ip}:31880` }
    : { pod: p[0], ip, ws: `ws://${ip}:31188`, http: `http://${ip}:31088/janus` };
}

// ---------------------------------------------------------- preconditions --
function preconditions(stack) {
  const failed = [];
  const all = kjson(['get', 'pods', '-A']).items;
  const nodes = kjson(['get', 'nodes']).items;
  const live = (p) => !p.metadata.deletionTimestamp && p.status.phase !== 'Succeeded' && p.status.phase !== 'Failed';
  const isLK = (p) => p.metadata.namespace === 'c4-livekit' && p.metadata.labels && p.metadata.labels['app.kubernetes.io/name'] === 'livekit-server';
  const isJ = (p) => p.metadata.namespace === 'c4-janus' && p.metadata.labels && p.metadata.labels.app === 'janus';
  const isT = (p) => p.metadata.namespace === 'coturn' && p.metadata.labels && p.metadata.labels['app.kubernetes.io/name'] === 'coturn';
  const isC = (p) => p.metadata.namespace === NS && p.metadata.labels && p.metadata.labels['c4.role'] === 'client';
  const pods = all.filter(live);
  const at = (f) => pods.filter(f).map((p) => ({ name: `${p.metadata.namespace}/${p.metadata.name}`, node: p.spec.nodeName, phase: p.status.phase }));
  const placement = { coturn: at(isT), livekit: at(isLK), janus: at(isJ), clients: at(isC), nodes: nodes.map((n) => ({ name: n.metadata.name, ready: (n.status.conditions || []).find((c) => c.type === 'Ready')?.status })) };
  const underTest = stack === 'livekit' ? placement.livekit : placement.janus;
  const idle = stack === 'livekit' ? placement.janus : placement.livekit;
  const idleDeploy = stack === 'livekit' ? ['c4-janus', 'janus'] : ['c4-livekit', 'livekit-livekit-server'];
  const idleReplicas = Number(kc(['-n', idleDeploy[0], 'get', 'deploy', idleDeploy[1], '-o', 'jsonpath={.spec.replicas}']));
  if (idleReplicas !== 0) failed.push(`idle SFU deployment ${idleDeploy.join('/')} has replicas=${idleReplicas} (must be 0)`);
  if (idle.length) failed.push(`idle SFU has ${idle.length} pod(s): ${idle.map((p) => `${p.name}@${p.node}`).join(', ')}`);
  if (placement.coturn.length !== 1) failed.push(`coturn pods: ${placement.coturn.length}`);
  if (underTest.length !== 1 || underTest[0].phase !== 'Running') failed.push(`SFU under test pods: ${JSON.stringify(underTest)}`);
  if (placement.clients.length !== 3 || placement.clients.some((c) => c.phase !== 'Running')) failed.push(`clients: ${JSON.stringify(placement.clients)}`);
  const cn = new Set(placement.clients.map((c) => c.node));
  if (cn.size !== 1) failed.push(`clients span ${cn.size} nodes (one clock requires one node)`);
  const tn = placement.coturn[0] && placement.coturn[0].node, sn = underTest[0] && underTest[0].node, clientNode = [...cn][0];
  const sfuNodes = [...placement.livekit, ...placement.janus].map((p) => p.node);
  if (tn && (sfuNodes.includes(tn) || cn.has(tn))) failed.push(`coturn node ${tn} is shared with an SFU or a client`);
  if (sn && (cn.has(sn) || sfuNodes.filter((n) => n === sn).length > 1)) failed.push(`SFU-under-test node ${sn} holds a client or another SFU`);
  if (clientNode && sfuNodes.includes(clientNode)) failed.push(`client node ${clientNode} holds an SFU`);
  const clientKernel = {}; // SYN retransmission settings and kernel release as seen inside each client pod (R2)
  const nodeInfo = nodes.map((n) => ({ name: n.metadata.name, ...Object.fromEntries(Object.keys(NODE_PIN).map((k) => [k, n.status.nodeInfo[k]])) }));
  let stop = false; // control arm: a different node image or client build ends the session, it is not retried
  if (CONTROL) for (const n of nodeInfo) for (const k of Object.keys(NODE_PIN)) if (n[k] !== NODE_PIN[k]) { failed.push(`node ${n.name} ${k}=${n[k]} differs from the study's ${NODE_PIN[k]}`); stop = true; }
  const used = [tn, sn, clientNode].filter(Boolean);
  for (const n of used) if (placement.nodes.find((x) => x.name === n)?.ready !== 'True') failed.push(`node ${n} not Ready`);
  // versions + config
  const s = sfu(stack);
  if (s) {
    const img = s.pod.status.containerStatuses[0].imageID || '';
    if (!img.endsWith(stack === 'livekit' ? PIN.livekitImage : PIN.janusImage)) failed.push(`SFU image ${img} not pinned digest`);
    if (stack === 'janus') {
      try {
        const info = JSON.parse(kc(['-n', 'c4-janus', 'exec', s.pod.metadata.name, '--', 'curl', '-s', '-m', '5', 'http://localhost:31088/janus/info']));
        if (info.version_string !== PIN.janusVersion) failed.push(`janus version ${info.version_string}`);
        if (info['reclaim-session-timeout'] !== PIN.reclaim || info['session-timeout'] !== PIN.sessionTimeout) failed.push(`janus timers reclaim=${info['reclaim-session-timeout']} session=${info['session-timeout']}`);
      } catch (e) { failed.push(`janus server_info unavailable: ${e.message.slice(0, 120)}`); }
    }
  }
  try {
    for (const [role, name] of Object.entries(PODS)) {
      const h = pod(name, 'GET', '/health');
      if (h.lkClient !== PIN.lkClient || h.playwright !== PIN.playwright) failed.push(`${role} versions lk=${h.lkClient} pw=${h.playwright}`);
      clientKernel[role] = h.kernel || null;
      if (CONTROL && !(h.kernel && h.kernel.release && Number.isFinite(h.kernel.tcp_syn_linear_timeouts) && Number.isFinite(h.kernel.tcp_syn_retries))) { failed.push(`${role}: kernel release or SYN retransmission settings could not be read inside the pod`); stop = true; }
      if (CONTROL && JSON.stringify(h.www) !== JSON.stringify(wwwHashes())) { failed.push(`${role} serves client files that differ from the selected build`); stop = true; }
    }
    const ipt = pod(PODS.S, 'GET', '/iptables');
    if (ipt.rules.length) failed.push(`subject has DROP rules: ${ipt.rules.join(' | ')}`);
  } catch (e) { failed.push(`client pod check failed: ${e.message.slice(0, 200)}`); }
  try { const h = sinkCall(stack, '/head'); if (!h.json || !h.json.bootId) failed.push('event sink not answering /head'); } catch (e) { failed.push(`event sink unreachable: ${e.message.slice(0, 120)}`); }
  return { ok: failed.length === 0, failed, stop, placement, nodeInfo, clientKernel, build: CONTROL ? { name: process.env.C4_CLIENT_BUILD || 'current', sha256: wwwHashes() } : undefined, sfu: s ? { ip: s.ip, node: s.pod.spec.nodeName } : null };
}

function abort(trialId, stack, pre) {
  const line = { t: nowIso(), trial: trialId, stack, aborted: true, failed: pre.failed, placement: pre.placement };
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.appendFileSync(path.join(ROOT, 'logs/aborts.log'), JSON.stringify(line) + '\n');
  log(`ABORT ${trialId}: ${pre.failed.join('; ')}`);
}

// ---------------------------------------------------------------- trial ----
let seq = 0;
async function trial(stack, test, arm, opt = {}) {
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\..*/, '');
  const id = test === 'isolation' ? `${stack}-iso-${opt.mode}-${opt.durS}s-${arm}-${opt.mediaAgeMs ? `T${opt.mediaAgeMs / 1000}-` : ''}${stamp}-${++seq}` : `${stack}-${test}-${arm}-${stamp}-${++seq}`;
  const pre = preconditions(stack);
  if (!pre.ok) { abort(id, stack, pre); return { id, aborted: true, failed: pre.failed, stop: pre.stop }; }
  const s = sfu(stack);
  const dir = path.join(ROOT, TRIALS, id); fs.mkdirSync(dir, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(dir, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('preconditions.json', pre);
  const tStart = nowIso();
  const marks = []; const mark = (step, x = {}) => { const m = { t: Date.now(), step, ...x }; marks.push(m); log(id, step, JSON.stringify(x).slice(0, 200)); };
  const invalid = [];
  let iso = null;
  let head0 = null; const clock = { sink: null, sfu: null, boundMs: CLOCK_UNC_BOUND_MS };
  try { head0 = sinkCall(stack, '/head').json; sinkCall(stack, '/c4-marker', 'POST', { trial: id, phase: 'start' }); clock.sink = pod(PODS.S, 'POST', '/probe-clock', { url: `${SINK[stack]}/time`, n: 9 }); } catch (e) { invalid.push(`server-event channel: start failed: ${String(e.message).slice(0, 160)}`); }
  const room = stack === 'livekit' ? `c4-${id}` : 5000 + Math.floor(Math.random() * 90000);
  const cfgFor = (who, extra = {}) => ({
    stack, arm, role: who === 'S' ? 'subject' : 'observer', identity: who, room, subjectIdentity: 'S',
    remotes: ['S', 'O1', 'O2'].filter((x) => x !== who),
    lk: { url: s.ws }, janus: { wsUrl: s.ws, room, feedId: FEED[who] }, ...extra,
  });
  try {
    if (stack === 'janus') { const r = pod(PODS.S, 'POST', '/admin/janus', { httpUrl: s.http, body: { request: 'create', room, publishers: 6, audiocodec: 'opus', notify_joining: true, permanent: false } }); mark('janus_room', r); }
    for (const who of ['O1', 'O2', 'S']) pod(PODS[who], 'POST', '/open', { ctx: 'main' });
    for (const who of ['O1', 'O2', 'S']) mark(`join_${who}`, pod(PODS[who], 'POST', '/join', { ctx: 'main', cfg: cfgFor(who) }));
    // wait for fresh media from every remote at every participant (<= 25 s)
    for (let i = 0; i < 50; i++) {
      const st = Object.fromEntries(['S', 'O1', 'O2'].map((w2) => [w2, pod(PODS[w2], 'POST', '/eval', { ctx: 'main', fn: 'status' })]));
      if (Object.values(st).every((x) => x.health && Object.values(x.health.ages).every((a) => a < 2000))) { mark('media_flowing'); break; }
      if (i === 49) { invalid.push('media never flowed to all participants within 25 s'); mark('media_timeout', st); }
      await sleep(500);
    }
    try { pod(PODS.O1, 'POST', '/poll-start', { stack, httpUrl: s.http, room }); } catch (e) { invalid.push(`state poll did not start: ${String(e.message).slice(0, 120)}`); }
    await sleep(15000); // warm-up (spec §3.2)
    // R2: both arms set the detection threshold through the same call, before arming; the reply is in the record
    if (opt.mediaAgeMs) { const r = pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'ctlSetParam', args: ['mediaAgeMs', opt.mediaAgeMs] }); mark('threshold_set', r); if (r.value !== opt.mediaAgeMs) invalid.push(`detection threshold not set: ${JSON.stringify(r)}`); }
    for (const who of ['O1', 'O2', 'S']) mark(`arm_${who}`, pod(PODS[who], 'POST', '/eval', { ctx: 'main', fn: 'arm' }));
    await sleep(5000);
    // ---- deliberate-failure self-test (spec §3.3): starve the server-event channel mid-trial ----
    if (process.env.C4_STARVE_SINK === '1') { kc(['-n', stack === 'livekit' ? 'c4-livekit' : 'c4-janus', 'delete', 'pod', '-l', 'app=event-sink', '--wait=false']); mark('STARVE_SINK', { note: 'sink pod deleted on purpose' }); }
    // ---- trigger ----
    if (test === 'healthy_rebuild') mark('trigger', pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'driverAction', args: ['rebuild'] }));
    else if (test === 'remove_participant') mark('trigger', pod(PODS.S, 'POST', '/admin/lk', { httpUrl: s.http, method: 'RemoveParticipant', body: { room, identity: 'S' }, room }));
    else if (test === 'intruder') {
      pod(PODS.O2, 'POST', '/open', { ctx: 'intruder' });
      // The intruder's own join may legitimately fail: S's immediate rebuild evicts it before its
      // PC connects (observed 2026-09-30). That is an OUTCOME to record, not a runner error.
      try { mark('trigger', pod(PODS.O2, 'POST', '/join', { ctx: 'intruder', cfg: { ...cfgFor('S'), role: 'intruder', publish: false } })); }
      catch (e) { mark('trigger', { intruderJoin: 'failed', error: String(e.message || e).slice(0, 300) }); }
    } else if (test === 'kick') mark('trigger', pod(PODS.S, 'POST', '/admin/janus', { httpUrl: s.http, body: { request: 'kick', room, id: FEED.S } }));
    else if (test === 'rogue') mark('trigger', { violationsAfter: pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'plantRogue' }) });
    else if (test === 'isolation') {
      // Spec §3.2: isolate the subject at the network layer for D, restore, then observe.
      const on = pod(PODS.S, 'POST', '/isolate', { mode: opt.mode, durMs: opt.durS * 1000, stack, ip: s.ip }); mark('isolate_on', on);
      if (!on.rulesDuring || !on.rulesDuring.length) invalid.push('isolation rules did not apply');
      await sleep(opt.durS * 1000 + 300);
      let res = null; for (let i = 0; i < 20; i++) { res = pod(PODS.S, 'GET', '/isolate-result'); if (res.restore) break; await sleep(250); }
      mark('isolate_off', res);
      if (!res || !res.restore) invalid.push('isolation restore was never reported by the pod');
      else {
        iso = { mode: opt.mode, plannedS: opt.durS, onset: res.onset, restore: res.restore, actualS: res.actualS, rulesDuring: res.rulesDuring, rulesAfter: res.rulesAfter };
        if (res.error) invalid.push(`isolation restore error: ${res.error}`);
        if ((res.rulesAfter || []).some((r) => r.includes(s.ip))) invalid.push('isolation rules were not removed');
      }
    } else if (CONTROL_TESTS.includes(test)) mark('trigger', { control: test, observeS: CONTROL_OBSERVE_S });
    else throw new Error(`unknown test ${test}`);
    if (test === 'isolation') {
      // observe until S has been healthy for 30 s after restore, capped at onset + max(160, D + 80) s (give-up is 120 s)
      const tOnset = Date.now() - opt.durS * 1000 - 1500; let healthyPolls = 0;
      while (Date.now() - tOnset < Math.max(160, opt.durS + 80) * 1000) {
        await sleep(2000); const st = pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'status' }); marks.push({ t: Date.now(), step: 'S_status', ...st });
        healthyPolls = st.state === 'healthy' ? healthyPolls + 1 : 0;
        if (healthyPolls >= 15) break;
      }
    } else if (CONTROL_TESTS.includes(test)) {
      // Benign events at fixed offsets from the trigger mark; each mark carries the time it actually ran.
      const T0 = Date.now(); const B = (route, body) => pod(PODS.O2, 'POST', route, { ctx: 'bystander', ...body });
      const bCfg = (publish) => cfgFor('B', { role: 'bystander', remotes: [], publish });
      const ev = (step, f) => { try { const { t: tPod, ...rest } = f() || {}; mark(step, { ...rest, tPod }); } catch (e) { invalid.push(`control event ${step} failed: ${String(e.message || e).slice(0, 200)}`); mark(step, { error: String(e.message || e).slice(0, 300) }); } };
      const sEval = (fn, args = []) => pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn, args });
      // C4.leave() returns nothing, so the pod's reply has no body to parse; that the bystander left is checked from its dump.
      const bLeave = () => { try { B('/eval', { fn: 'leave' }); } catch (e) { if (!/Unexpected end of JSON input/.test(String(e.message))) throw e; } return { requested: true }; };
      const plan = {
        h0: [],
        h1: [[25, 'bystander_open', () => B('/open')],
          [30, 'bystander_join', () => (stack === 'livekit' ? B('/join', { cfg: bCfg(false) }) : B('/eval', { fn: 'ctlJanusBystander', args: [{ wsUrl: s.ws, room, id: FEED.B, display: 'B' }] }))],
          [90, 'bystander_leave', () => (stack === 'livekit' ? bLeave() : B('/eval', { fn: 'ctlJanusBystanderLeave' }))]],
        h2: [[25, 'bystander_open', () => B('/open')], [30, 'bystander_join_publishing', () => B('/join', { cfg: bCfg(true) })], [90, 'bystander_leave', bLeave]],
        h3: [[28, 'packets_before', () => sEval('ctlPackets')], [30, 'mute_on', () => sEval('ctlMute', [true])], [34, 'packets_muted_1', () => sEval('ctlPackets')],
          [39, 'packets_muted_2', () => sEval('ctlPackets')], [40, 'mute_off', () => sEval('ctlMute', [false])], [45, 'packets_after', () => sEval('ctlPackets')]],
      }[test];
      while (Date.now() - T0 < CONTROL_OBSERVE_S * 1000) {
        while (plan.length && Date.now() - T0 >= plan[0][0] * 1000) { const [, step, f] = plan.shift(); ev(step, f); }
        const next = Math.min(2000, plan.length ? Math.max(50, plan[0][0] * 1000 - (Date.now() - T0)) : 2000); await sleep(next);
        if (next === 2000) { const st = pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'status' }); marks.push({ t: Date.now(), step: 'S_status', ...st }); }
      }
    } else for (let i = 0; i < 30; i++) { await sleep(2000); const st = pod(PODS.S, 'POST', '/eval', { ctx: 'main', fn: 'status' }); marks.push({ t: Date.now(), step: 'S_status', ...st }); }
  } catch (e) { invalid.push(`runner error: ${String(e.message || e).slice(0, 500)}`); mark('runner_error', { e: String(e.message || e).slice(0, 500) }); }
  // ---- collect (always) ----
  // participant-state poll (A_state): stop before the trial's own leave; completeness checked now
  try {
    const sp = pod(PODS.O1, 'POST', '/poll-stop', {}); w('state-poll.json', sp);
    const ok = (sp.samples || []).filter((x) => !x.error); let gap = 0; for (let i = 1; i < ok.length; i++) gap = Math.max(gap, ok[i].t1 - ok[i - 1].t1);
    if (ok.length < 20) invalid.push(`state poll: only ${ok.length} samples`);
    else if (gap > 3000) invalid.push(`state poll: gap of ${Math.round(gap)} ms between samples`);
  } catch (e) { invalid.push(`state poll: collection failed: ${String(e.message).slice(0, 160)}`); }
  for (const who of ['S', 'O1', 'O2']) { try { pod(PODS[who], 'POST', '/eval', { ctx: 'main', fn: 'leave' }); } catch {} }
  const dumps = {};
  for (const [who, ctx] of [['S', 'main'], ['O1', 'main'], ['O2', 'main'], ...(test === 'intruder' ? [['INTRUDER', 'intruder']] : []), ...(['h1', 'h2'].includes(test) ? [['B', 'bystander']] : [])]) {
    try { dumps[who] = pod(who === 'INTRUDER' || who === 'B' ? PODS.O2 : PODS[who], 'POST', '/dump', { ctx }); w(`${who}.json`, dumps[who]); } catch (e) { invalid.push(`no dump from ${who}: ${e.message.slice(0, 200)}`); }
    try { pod(who === 'INTRUDER' || who === 'B' ? PODS.O2 : PODS[who], 'POST', '/close', { ctx }); } catch {}
  }
  try { pod(PODS.S, 'POST', '/unblock-all'); } catch {}
  try { const ipt = pod(PODS.S, 'GET', '/iptables'); if (ipt.rules.length) invalid.push(`DROP rules left in subject: ${ipt.rules.join(' | ')}`); } catch (e) { invalid.push(`iptables check failed: ${e.message}`); }
  // server evidence: events from the sink's own store, with a completeness check NOW
  const since = `--since-time=${tStart}`;
  const grab = (f, args) => { try { w(f, kc(args)); } catch (e) { invalid.push(`server evidence ${f} missing: ${e.message.slice(0, 120)}`); } };
  let events = [];
  try {
    try { sinkCall(stack, '/c4-marker', 'POST', { trial: id, phase: 'end' }); } catch {}
    const head1 = sinkCall(stack, '/head').json;
    const range = head0 && head1 ? sinkCall(stack, `/range?from=${head0.seq}&to=${head1.seq}`).json : null;
    events = (range && range.events) || [];
    w('server-events.jsonl', events.map((e) => JSON.stringify(e)).join('\n'));
    w('server-events-meta.json', { head0, head1, count: events.length });
    invalid.push(...checkServerEvents(stack, room, id, head0, head1, range));
  } catch (e) { invalid.push(`server-event channel: collection failed: ${String(e.message).slice(0, 160)}`); }
  if (stack === 'livekit') grab('server-livekit.log', ['-n', 'c4-livekit', 'logs', 'deploy/livekit-livekit-server', '--timestamps', since]);
  else { grab('server-janus.log', ['-n', 'c4-janus', 'logs', 'deploy/janus', '--timestamps', since]); try { pod(PODS.S, 'POST', '/admin/janus', { httpUrl: s.http, body: { request: 'destroy', room } }); } catch {} }
  // clock-offset probe (spec §3.1.5)
  try { clock.sfu = dumps.S ? sfuClock(stack, dumps.S, events) : null; } catch (e) { clock.sfuError = String(e.message).slice(0, 160); }
  for (const k of ['sink', 'sfu']) {
    if (!clock[k]) invalid.push(`clock-offset probe (${k}) produced no measurement`);
    else if (clock[k].uncMs > CLOCK_UNC_BOUND_MS) invalid.push(`clock-offset probe (${k}) uncertainty ${clock[k].uncMs.toFixed(1)} ms exceeds ${CLOCK_UNC_BOUND_MS} ms`);
  }
  // invalidations (§3.3)
  const viol = dumps.S ? dumps.S.violations.length : null;
  const expectViolation = test === 'rogue';
  if (!expectViolation && viol) invalid.push(`${viol} attribution violation(s) in subject`);
  // h3 mutes S on purpose: the observers' received audio from S stops carrying the clock, so this check is
  // exempted for that arm only, and the exemption is written into the record with what was observed.
  const exemptions = test === 'h3' ? [{ check: 'observer detected a failure of its own connection', reason: 'S is muted for 10 s by design; a muted track carries no in-band clock, so both observers are expected to see S\'s audio go stale. The check exists to catch an unintended failure of an observer\'s own connection, which this is not.', observed: [] }] : undefined;
  for (const who of ['O1', 'O2']) if (dumps[who] && dumps[who].driver && dumps[who].driver.observerDetected) { if (exemptions) exemptions[0].observed.push({ who, ...dumps[who].driver.observerDetected }); else invalid.push(`observer ${who} detected a failure of its own connection`); }
  let control;
  if (opt.mediaAgeMs) {
    const inForce = dumps.S && dumps.S.params ? dumps.S.params.mediaAgeMs : null;
    if (inForce !== opt.mediaAgeMs) invalid.push(`detection threshold in the subject's record is ${inForce}, not ${opt.mediaAgeMs}`);
    control = { registration: 'REGISTRATION-R2-detection-threshold.md', arm: `T${opt.mediaAgeMs / 1000}`, mediaAgeMs: opt.mediaAgeMs, mediaAgeMsInSubjectRecord: inForce, build: pre.build, nodeInfo: pre.nodeInfo, clientKernel: pre.clientKernel };
  }
  if (['h1', 'h2'].includes(test) && !(dumps.B && dumps.B.log.some((l) => (l.type === 'driver_state' && l.state === 'left') || l.type === 'ctl_bystander_left'))) invalid.push('bystander did not leave (no left state in its dump)');
  if (CONTROL_TESTS.includes(test)) {
    // The same arm label is NOT the same condition on the two stacks: each record names its own condition.
    const NOTE = {
      h0: { livekit: 'idle session', janus: 'idle session' },
      h1: { livekit: 'bystander joins and leaves without publishing (livekit-client, publish: false)', janus: 'bystander joins and leaves without publishing (minimal Janus client: joins as a publisher, never publishes)' },
      h2: { livekit: 'publishing bystander joins and leaves; the existing subscriber connection of each participant is expected to be renegotiated (to be confirmed per trial from the recorded offers)', janus: 'publishing bystander joins and leaves; each participant opens a NEW handle and connection for it. No existing connection is renegotiated: benign renegotiation is not tested on Janus' },
      h3: { livekit: 'mute SIGNALLED to the server (LocalTrackPublication.mute: track disabled and the server told it is muted)', janus: 'mute NOT signalled (MediaStreamTrack.enabled = false only; the server is told nothing)' },
    };
    control = { clientKernel: pre.clientKernel, test, condition: `${test}-${stack}`, conditionNote: NOTE[test][stack], observeS: CONTROL_OBSERVE_S, build: pre.build, nodeInfo: pre.nodeInfo };
    if (['h1', 'h2'].includes(test)) control.observerAsymmetry = 'the bystander runs as a second browser context in the O2 pod' + (test === 'h2' ? '; every participant also decodes the bystander\'s audio' : '');
    if (test === 'h3') { // did RTP keep flowing while S was muted? (two reads inside the mute)
      const m = Object.fromEntries(marks.filter((x) => /^(packets_|mute_)/.test(x.step)).map((x) => [x.step, x])); const a1 = m.packets_muted_1, a2 = m.packets_muted_2;
      const rate = a1 && a2 && a1.packetsSent != null && a2.packetsSent != null ? (a2.packetsSent - a1.packetsSent) / ((a2.statsTimestamp - a1.statsTimestamp) / 1000) : null;
      control.mute = { mechanism: m.mute_on && m.mute_on.mechanism, mutedForS: m.mute_on && m.mute_off ? +((m.mute_off.tPod - m.mute_on.tPod) / 1000).toFixed(2) : null, packetsPerSecondWhileMuted: rate != null ? +rate.toFixed(1) : null, bytesPerPacketWhileMuted: rate ? +((a2.bytesSent - a1.bytesSent) / (a2.packetsSent - a1.packetsSent)).toFixed(1) : null, packetsContinued: rate != null ? rate > 40 : null };
      if (control.mute.packetsContinued === null) invalid.push('h3: outbound packet counters were not read during the mute');
    }
  }
  if (expectViolation) { if (viol > 0) invalid.push(`attribution violation(s): ${viol} (EXPECTED for the planted-rogue self-test)`); else invalid.push('SELF-TEST FAILURE: planted rogue reconnect was NOT caught'); }
  const result = { id, stack, test, arm, room, iso, clock, ladder: 'v2', tStart, tEnd: nowIso(), valid: invalid.length === 0, invalid, ...(control ? { control } : {}), ...(exemptions ? { exemptions } : {}), marks };
  w('result.json', result);
  log(id, result.valid ? 'VALID' : `INVALID: ${invalid.join(' | ')}`);
  return result;
}

// ------------------------------------------------------------------ main ---
const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'setup') setup();
else if (cmd === 'health') { for (const name of Object.values(PODS)) log(name, JSON.stringify(pod(name, 'GET', '/health'))); }
else if (cmd === 'switch') switchStack(a[0]);
else if (cmd === 'preconditions') console.log(JSON.stringify(preconditions(a[0]), null, 1));
else if (cmd === 'targeted') { const [stack, test, n = '1', arm = 'I'] = a; for (let i = 0; i < Number(n); i++) await trial(stack, test, arm); }
else if (cmd === 'smoke') { await trial(a[0], 'isolation', 'I', { mode: 'all', durS: 10 }); await trial(a[0], 'isolation', 'O', { mode: 'media', durS: 30 }); }
else if (cmd === 'iso') { const [stack, mode, durS, arm = 'I'] = a; await trial(stack, 'isolation', arm, { mode, durS: Number(durS) }); }
else if (cmd === 'study') {
  // Approved 2026-10-02 (STAGE-A-SPEC §4.4). Arm O only. n valid trials per cell, randomized order,
  // resumable: valid records already in the output directory count towards n.
  const stack = a[0];
  const CELLS = {
    livekit: [...[2, 5, 10, 16, 19, 21, 23, 26, 30].map((d) => ({ mode: 'all', durS: d, n: [19, 21, 23].includes(d) ? 10 : 5 })), ...[2, 5, 10, 20, 23, 26, 28, 30].map((d) => ({ mode: 'media', durS: d, n: [26, 28].includes(d) ? 10 : 5 }))],
    janus: [...[2, 5, 10, 30, 45, 55, 65, 90].map((d) => ({ mode: 'all', durS: d, n: 5 })), ...[2, 5, 10, 30, 45].map((d) => ({ mode: 'media', durS: d, n: 5 }))],
  }[stack];
  if (process.env.C4_CELLS) { CELLS.length = 0; for (const x of process.env.C4_CELLS.split(',')) { const [mode, d, n] = x.split(':'); CELLS.push({ mode, durS: Number(d), n: Number(n) }); } }
  const key = (c) => `${c.mode}-${c.durS}`; const dirT = path.join(ROOT, TRIALS); fs.mkdirSync(dirT, { recursive: true });
  const have = {}; const tried = {};
  for (const d of fs.readdirSync(dirT)) { const f = path.join(dirT, d, 'result.json'); if (!fs.existsSync(f)) continue; const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (r.stack !== stack || !r.iso) continue; const k = `${r.iso.mode}-${r.iso.plannedS}`; tried[k] = (tried[k] || 0) + 1; if (r.valid) have[k] = (have[k] || 0) + 1; }
  let queue = []; for (const c of CELLS) for (let i = have[key(c)] || 0; i < c.n; i++) queue.push(c);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  fs.appendFileSync(path.join(dirT, `order-${stack}.jsonl`), JSON.stringify({ t: nowIso(), planned: queue.map(key) }) + '\n');
  log('study', stack, `planned ${queue.length} trials`);
  let aborts = 0;
  while (queue.length) {
    const c = queue.shift(); const k = key(c);
    const r = await trial(stack, 'isolation', 'O', { mode: c.mode, durS: c.durS });
    if (r && r.aborted) { aborts++; if (aborts > 10) { log('study', 'too many precondition aborts: stopping'); process.exit(3); } await sleep(30000); queue.push(c); continue; }
    tried[k] = (tried[k] || 0) + 1;
    if (r && r.valid) have[k] = (have[k] || 0) + 1;
    else if (tried[k] < c.n + 3) queue.push(c); // replace an invalid trial, at most 3 extra attempts per cell
    else log('study', `cell ${k}: attempts exhausted with ${have[k] || 0}/${c.n} valid`);
    fs.writeFileSync(path.join(dirT, `progress-${stack}.json`), JSON.stringify({ t: nowIso(), have, tried, remaining: queue.length }));
  }
  log('study', stack, 'done', JSON.stringify(have));
} else if (cmd === 'control') {
  // Healthy-session control arm (approved 2026-10-07). Arm O. Per stack: h0 8, h1 8, h2 12, h3 12.
  // Randomized order, resumable like the study. A node-image or client-build mismatch stops the session.
  const stack = a[0];
  if (!CONTROL) { console.error('control: set C4_CONTROL=1 (and C4_CLIENT_BUILD=pre-sampler)'); process.exit(2); }
  const CELLS = (process.env.C4_CELLS || 'h0:8,h1:8,h2:12,h3:12').split(',').map((x) => { const [test, n] = x.split(':'); return { test, n: Number(n) }; });
  const dirT = path.join(ROOT, TRIALS); fs.mkdirSync(dirT, { recursive: true });
  const have = {}; const tried = {};
  for (const d of fs.readdirSync(dirT)) { const f = path.join(dirT, d, 'result.json'); if (!fs.existsSync(f)) continue; const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (r.stack !== stack || !r.control) continue; tried[r.test] = (tried[r.test] || 0) + 1; if (r.valid) have[r.test] = (have[r.test] || 0) + 1; }
  const queue = []; for (const c of CELLS) for (let i = have[c.test] || 0; i < c.n; i++) queue.push(c);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  fs.appendFileSync(path.join(dirT, `order-${stack}.jsonl`), JSON.stringify({ t: nowIso(), planned: queue.map((c) => c.test) }) + '\n');
  log('control', stack, `planned ${queue.length} sessions`);
  let aborts = 0;
  while (queue.length) {
    const c = queue.shift(); const k = c.test;
    const r = await trial(stack, c.test, 'O');
    if (r && r.aborted && r.stop) { log('control', `STOP: ${r.failed.join(' | ')}`); process.exit(5); }
    if (r && r.aborted) { aborts++; if (aborts > 10) { log('control', 'too many precondition aborts: stopping'); process.exit(3); } await sleep(30000); queue.push(c); continue; }
    tried[k] = (tried[k] || 0) + 1;
    if (r && r.valid) have[k] = (have[k] || 0) + 1;
    else if (tried[k] < c.n + 3) queue.push(c); // replace an invalid session, at most 3 extra attempts per arm
    else log('control', `arm ${k}: attempts exhausted with ${have[k] || 0}/${c.n} valid`);
    fs.writeFileSync(path.join(dirT, `progress-${stack}.json`), JSON.stringify({ t: nowIso(), have, tried, remaining: queue.length }));
  }
  log('control', stack, 'done', JSON.stringify(have));
} else if (cmd === 'threshold') {
  // R2, registered 2026-10-08 (REGISTRATION-R2-detection-threshold.md). LiveKit only; full and media-only isolation, 2 s;
  // per condition 8 trials at mediaAgeMs 4000 and 7 at 2000; one randomized order; resumable like the study.
  const stack = a[0];
  if (stack !== 'livekit' || !CONTROL) { console.error('threshold: LiveKit only, with C4_CONTROL=1 and C4_CLIENT_BUILD=pre-sampler'); process.exit(2); }
  const N = process.env.C4_CELLS ? Object.fromEntries(process.env.C4_CELLS.split(',').map((x) => x.split(':')).map(([k, n]) => [k, Number(n)])) : { T4: 8, T2: 7 };
  const CELLS = []; for (const mode of ['all', 'media']) for (const [armName, n] of Object.entries(N)) CELLS.push({ mode, durS: 2, mediaAgeMs: armName === 'T4' ? 4000 : 2000, n });
  const key = (c) => `${c.mode}-2-T${c.mediaAgeMs / 1000}`; const dirT = path.join(ROOT, TRIALS); fs.mkdirSync(dirT, { recursive: true });
  const have = {}; const tried = {};
  for (const d of fs.readdirSync(dirT)) { const f = path.join(dirT, d, 'result.json'); if (!fs.existsSync(f)) continue; const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (!r.iso || !r.control || !r.control.mediaAgeMs) continue; const k = `${r.iso.mode}-${r.iso.plannedS}-${r.control.arm}`; tried[k] = (tried[k] || 0) + 1; if (r.valid) have[k] = (have[k] || 0) + 1; }
  const queue = []; for (const c of CELLS) for (let i = have[key(c)] || 0; i < c.n; i++) queue.push(c);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  fs.appendFileSync(path.join(dirT, `order-${stack}.jsonl`), JSON.stringify({ t: nowIso(), planned: queue.map(key) }) + '\n');
  log('threshold', stack, `planned ${queue.length} trials`);
  let aborts = 0;
  while (queue.length) {
    const c = queue.shift(); const k = key(c);
    const r = await trial(stack, 'isolation', 'O', { mode: c.mode, durS: c.durS, mediaAgeMs: c.mediaAgeMs });
    if (r && r.aborted && r.stop) { log('threshold', `STOP: ${r.failed.join(' | ')}`); process.exit(5); }
    if (r && r.aborted) { aborts++; if (aborts > 10) { log('threshold', 'too many precondition aborts: stopping'); process.exit(3); } await sleep(30000); queue.push(c); continue; }
    tried[k] = (tried[k] || 0) + 1;
    if (r && r.valid) have[k] = (have[k] || 0) + 1;
    else if (tried[k] < c.n + 3) queue.push(c); // replace an invalid trial, at most 3 extra attempts per group
    else log('threshold', `group ${k}: attempts exhausted with ${have[k] || 0}/${c.n} valid`);
    fs.writeFileSync(path.join(dirT, `progress-${stack}.json`), JSON.stringify({ t: nowIso(), have, tried, remaining: queue.length }));
  }
  log('threshold', stack, 'done', JSON.stringify(have));
} else if (cmd === 'shakedown') {
  // STAGE-A-SPEC §4.2: 2 arms x 2 modes x {10 s, 30 s} x 3 reps = 24 trials per stack, reps interleaved.
  const stack = a[0]; const reps = Number(a[1] || 3);
  const cells = []; for (const arm of ['I', 'O']) for (const mode of ['all', 'media']) for (const durS of [10, 30]) cells.push({ arm, mode, durS });
  for (let r = 0; r < reps; r++) for (const c of cells) await trial(stack, 'isolation', c.arm, { mode: c.mode, durS: c.durS });
} else if (cmd === 'placement-selftest') {
  // spec §6.4: idle SFU left at 1 replica must ABORT with the placement reason and write no record.
  const stack = a[0]; const idle = stack === 'livekit' ? ['c4-janus', 'janus'] : ['c4-livekit', 'livekit-livekit-server'];
  const before = fs.existsSync(path.join(ROOT, TRIALS)) ? fs.readdirSync(path.join(ROOT, TRIALS)).length : 0;
  kc(['-n', idle[0], 'scale', `deploy/${idle[1]}`, '--replicas=1']);
  execFileSync('sh', ['-c', `kubectl -n ${idle[0]} rollout status deploy/${idle[1]} --timeout=6m >/dev/null 2>&1 || true`]);
  const r = await trial(stack, 'healthy_rebuild', 'I');
  const after = fs.existsSync(path.join(ROOT, TRIALS)) ? fs.readdirSync(path.join(ROOT, TRIALS)).length : 0;
  kc(['-n', idle[0], 'scale', `deploy/${idle[1]}`, '--replicas=0']);
  execFileSync('sh', ['-c', `kubectl -n ${idle[0]} wait --for=delete pod --all --timeout=120s >/dev/null 2>&1 || true`]);
  console.log(JSON.stringify({ selftest: 'placement', aborted: !!r.aborted, reasons: r.failed, trialDirsBefore: before, trialDirsAfter: after, PASS: !!r.aborted && before === after }));
} else { console.error('usage: setup | switch <stack> | preconditions <stack> | targeted <stack> <test> <n> [arm] | placement-selftest <stack>'); process.exit(2); }
