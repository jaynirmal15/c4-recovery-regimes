// Control arm (healthy sessions) only. Served and loaded after driver.js when the pod has this
// file; the 215 study trials and the follow-up cell did not load it. It adds entry points for
// benign events to window.C4 and changes nothing in common.js, lk.js, janus.js or driver.js.
// The adapter classes are wrapped only to keep a reference to the instance the driver creates.
(() => {
  const C4X = window.C4X;
  let adapter = null;
  for (const n of ['LiveKitAdapter', 'JanusAdapter']) { const Orig = window[n]; window[n] = class extends Orig { constructor(o) { super(o); adapter = this; } }; }
  const isLk = () => !!(adapter && adapter.room);
  const lkPub = () => [...adapter.room.localParticipant.audioTrackPublications.values()][0];
  const janusTrack = () => adapter.pub.pc.getSenders().map((s) => s.track).find((t) => t && t.kind === 'audio');

  /** Mute as each client library documents it. LiveKit: LocalTrackPublication.mute(), which
   *  disables the MediaStreamTrack and signals the mute to the server. Janus: the janus.js
   *  muteAudio() behaviour, MediaStreamTrack.enabled = false, with no signalling. */
  window.C4.ctlMute = async (muted) => {
    let r;
    if (isLk()) { const p = lkPub(); await (muted ? p.mute() : p.unmute()); r = { mechanism: 'livekit-client LocalTrackPublication.mute()/unmute()', enabled: p.track.mediaStreamTrack.enabled, isMuted: p.isMuted }; }
    else { const t = janusTrack(); t.enabled = !muted; r = { mechanism: 'MediaStreamTrack.enabled (janus.js muteAudio/unmuteAudio)', enabled: t.enabled }; }
    C4X.log('ctl_mute', { muted, ...r });
    return { t: C4X.now(), muted, ...r };
  };

  /** One read of the publisher's outbound audio RTP counters (not a sampler). */
  window.C4.ctlPackets = async () => {
    const pc = isLk() ? null : adapter.pub.pc; const report = isLk() ? await lkPub().track.sender.getStats() : await pc.getStats();
    let out = null; report.forEach((v) => { if (v.type === 'outbound-rtp' && v.kind === 'audio') out = { packetsSent: v.packetsSent, bytesSent: v.bytesSent, statsTimestamp: v.timestamp }; });
    const r = { t: C4X.now(), ...out }; C4X.log('ctl_packets', r); return r;
  };

  /** Janus only: a participant that joins the room and publishes nothing. The Janus adapter
   *  always publishes on join, so the non-publishing bystander is this minimal client. */
  let by = null;
  window.C4.ctlJanusBystander = async ({ wsUrl, room, id, display }) => {
    const ws = new WebSocket(wsUrl, 'janus-protocol'); const pend = new Map(); let n = 0;
    const req = (body, ackOk = false) => new Promise((res) => {
      const transaction = `b${++n}`; pend.set(transaction, { res, ackOk });
      setTimeout(() => { if (pend.delete(transaction)) res({ janus: 'c4_timeout' }); }, 10000);
      ws.send(JSON.stringify({ ...body, transaction }));
    });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = m.transaction && pend.get(m.transaction); if (!p || (m.janus === 'ack' && !p.ackOk)) return; pend.delete(m.transaction); p.res(m); };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('bystander: websocket error')); });
    const c = await req({ janus: 'create' }); const session_id = c.data && c.data.id;
    const a = await req({ janus: 'attach', plugin: 'janus.plugin.videoroom', session_id }); const handle_id = a.data && a.data.id;
    const j = await req({ janus: 'message', session_id, handle_id, body: { request: 'join', ptype: 'publisher', room, id, display } });
    const pd = j.plugindata && j.plugindata.data;
    if (!pd || pd.videoroom !== 'joined') throw new Error(`bystander: join refused ${JSON.stringify(pd || j).slice(0, 200)}`);
    by = { ws, req, session_id, handle_id, ka: setInterval(() => { req({ janus: 'keepalive', session_id }, true); }, 5000) };
    C4X.log('ctl_bystander_joined', { session_id, handle_id, id });
    return { t: C4X.now(), sessionId: session_id };
  };
  window.C4.ctlJanusBystanderLeave = async () => {
    if (!by) return { ok: false };
    clearInterval(by.ka);
    await by.req({ janus: 'message', session_id: by.session_id, handle_id: by.handle_id, body: { request: 'leave' } });
    await by.req({ janus: 'destroy', session_id: by.session_id });
    try { by.ws.close(); } catch {}
    C4X.log('ctl_bystander_left', { session_id: by.session_id }); by = null;
    return { t: C4X.now(), ok: true };
  };
})();
