// C4 spike: a driven livekit-client v2.22.3. Page side.
// The SDK keeps its protocol code; this replaces only its recovery DECISIONS.
// Every entry into reconnect/close is attributed: made by the driver, or not.
'use strict';

const LOG = [];
const FRAMES = [];
const now = () => Date.now();
const log = (type, data = {}) => LOG.push({ t: now(), type, ...data });

// ---- raw signalling capture (installed before the SDK loads) --------------------
(() => {
  const Native = window.WebSocket;
  let seq = 0;
  const b64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  class TapWS extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const id = ++seq;
      const clean = String(url).replace(/access_token=[^&]+/, 'access_token=REDACTED');
      FRAMES.push({ t: now(), ws: id, dir: 'open', url: clean });
      this.addEventListener('message', (ev) => {
        if (ev.data instanceof ArrayBuffer) FRAMES.push({ t: now(), ws: id, dir: 'in', b64: b64(ev.data) });
        else FRAMES.push({ t: now(), ws: id, dir: 'in-text', text: String(ev.data).slice(0, 2000) });
      });
      this.addEventListener('close', (ev) => FRAMES.push({ t: now(), ws: id, dir: 'close', code: ev.code, reason: ev.reason }));
      this.addEventListener('error', () => FRAMES.push({ t: now(), ws: id, dir: 'error' }));
      this._c4id = id;
    }
    send(data) {
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        FRAMES.push({ t: now(), ws: this._c4id, dir: 'out', b64: b64(buf) });
      }
      return super.send(data);
    }
  }
  window.WebSocket = TapWS;
})();

// ---- driver ------------------------------------------------------------------
let room = null;
let driverActive = null; // label of the driver action in progress, else null
const VIOLATIONS = [];
let POLICY = null;

function attribute(name) {
  return { by: driverActive ? `driver:${driverActive}` : 'SDK/server', violation: !driverActive };
}

function installHooks(engine) {
  if (!engine || engine.__c4) return;
  engine.__c4 = true;
  log('hooks_install', { engineId: (engine.__c4id = Math.random().toString(36).slice(2, 8)) });

  // (1) Wrap reconnect / close entry points with attribution.
  for (const name of ['attemptReconnect', 'resumeConnection', 'restartConnection', 'close']) {
    const orig = engine[name].bind(engine);
    engine[name] = async (...args) => {
      const a = attribute(name);
      // close() driven by a server DISCONNECT is expected pass-through, not a violation.
      const serverDisconnect = name === 'close' && String(args[0] || '').startsWith('server leave');
      const entry = { fn: name, arg: args[0] === undefined ? null : String(args[0]), ...a, serverDisconnect };
      log('engine_call', entry);
      if (a.violation && !serverDisconnect) VIOLATIONS.push({ t: now(), ...entry });
      return orig(...args);
    };
  }

  // (2) Server LeaveRequest: record every one; RESUME/RECONNECT are obeyed only if the
  //     policy says so. DISCONNECT (server ended the session) always passes through.
  //     setupSignalClientCallbacks re-installs onLeave on every join/resume, so wrap it.
  const wrapOnLeave = () => {
    const c = engine.client;
    const inner = c.onLeave;
    if (!inner || inner.__c4) return;
    const wrapped = (leave) => {
      const action = leave && leave.action; // 0 DISCONNECT, 1 RESUME, 2 RECONNECT
      const obey = action === 0 || (action === 1 && POLICY.obeyServerResume) || (action === 2 && POLICY.obeyServerReconnect);
      log('server_leave', { action, reason: leave && leave.reason, obeyed: obey });
      if (obey) inner(leave);
    };
    wrapped.__c4 = true;
    c.onLeave = wrapped;
  };
  const origSetup = engine.setupSignalClientCallbacks.bind(engine);
  engine.setupSignalClientCallbacks = () => { origSetup(); wrapOnLeave(); };
  wrapOnLeave();

  // (3) Signal liveness timeout: pinned to the policy value regardless of what the server sends.
  Object.defineProperty(engine.client, 'pingTimeoutDuration', {
    configurable: true,
    get: () => POLICY.signalTimeoutS,
    set: (v) => log('server_ping_timeout_ignored', { serverValueS: v }),
  });

  // (4) Browser online/offline handlers bypass the policy: remove them.
  window.removeEventListener('online', engine.handleBrowserOnLine);
  window.removeEventListener('offline', engine.handleBrowserOffline);

  for (const ev of ['connected', 'disconnected', 'resuming', 'resumed', 'restarting', 'restarted', 'signalResumed', 'signalRestarted', 'offline', 'closing']) {
    engine.on(ev, (...a) => log('engine_event', { ev, arg: a[0] === undefined ? null : String(a[0]) }));
  }
}

window.SPIKE = {
  async join({ url, token, policy, publish }) {
    POLICY = policy;
    const LK = window.LivekitClient;
    if (!room) {
      room = new LK.Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: false,
        reconnectPolicy: {
          nextRetryDelayInMs: (ctx) => {
            log('policy_consulted', { retryCount: ctx.retryCount, elapsedMs: ctx.elapsedMs, reason: ctx.retryReason ? String(ctx.retryReason) : null, returned: policy.passiveDelayMs });
            return policy.passiveDelayMs; // never retry on its own, never give up (null would close)
          },
        },
      });
      const RE = LK.RoomEvent;
      for (const ev of ['Connected', 'Reconnecting', 'SignalReconnecting', 'Reconnected', 'Disconnected', 'ConnectionStateChanged', 'ParticipantConnected', 'ParticipantDisconnected', 'TrackSubscribed', 'TrackUnsubscribed', 'ConnectionQualityChanged']) {
        room.on(RE[ev], (...a) => {
          const x = a[0];
          const d = x && typeof x === 'object' ? { identity: x.identity, sid: x.sid } : { value: x === undefined ? null : String(x) };
          if (a[1] !== undefined && typeof a[1] !== 'object') d.reason = String(a[1]);
          if (ev === 'ConnectionQualityChanged' && a[1]) d.who = a[1].identity;
          log('room_event', { ev, ...d });
        });
      }
    }
    await room.connect(url, token, { autoSubscribe: true });
    installHooks(room.engine);
    log('joined', { sid: room.localParticipant.sid, identity: room.localParticipant.identity, state: room.state });
    if (publish && !room.__published) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      const osc = ctx.createOscillator(); osc.frequency.value = 440;
      const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start(); await ctx.resume();
      await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], { name: 'tone' });
      room.__published = true;
      log('published', {});
    }
    return this.status();
  },

  /** Driver actions: 'resume' | 'full' | 'rejoin' (fresh room.connect after server DISCONNECT). */
  async action(kind, { url, token } = {}) {
    driverActive = kind;
    const before = this.status();
    log('driver_action_begin', { kind, before });
    let error = null;
    try {
      if (kind === 'resume' || kind === 'full') {
        const e = room.engine;
        e.fullReconnectOnNext = kind === 'full';
        await e.attemptReconnect(kind === 'resume' ? 1 /* RR_SIGNAL_DISCONNECTED */ : 0);
      } else if (kind === 'leave') {
        await room.disconnect();
      } else if (kind === 'rejoin') {
        await room.connect(url, token, { autoSubscribe: true });
        installHooks(room.engine);
        if (room.__published) { room.__published = false; }
      }
    } catch (e) { error = String(e && e.message || e); }
    driverActive = null;
    const after = this.status();
    log('driver_action_end', { kind, after, error });
    return { before, after, error };
  },

  status() {
    const e = room && room.engine;
    return {
      t: now(),
      roomState: room && room.state,
      sid: room && room.localParticipant && room.localParticipant.sid,
      engineId: e && e.__c4id,
      engineClosed: e ? !!e._isClosed : null,
      pcState: e && e.pcState,
      signalState: e && e.client && e.client.currentState,
      remotes: room ? [...room.remoteParticipants.values()].map((p) => `${p.identity}/${p.sid}`) : [],
    };
  },

  dump() { return { log: LOG, frames: FRAMES, violations: VIOLATIONS, status: this.status() }; },
};
