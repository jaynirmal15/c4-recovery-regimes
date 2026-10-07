// LiveKit adapter: driven livekit-client v2.22.3 (CLIENT-FEASIBILITY Q1, SPIKE-REPORT).
// The SDK keeps its protocol code; every recovery DECISION is the driver's.
'use strict';

(() => {
  const ACTION = { 0: 'DISCONNECT', 1: 'RESUME', 2: 'RECONNECT' };
  const PASSIVE_DELAY_MS = 24 * 3600 * 1000;

  class LiveKitAdapter {
    constructor(opts) {
      this.o = opts; // {url, token, identity, signalTimeoutS, onServerRequest, onTerminal, attribution}
      this.room = null; this.engine = null;
      this.lastReplyAt = 0;
      this.leaves = []; // every LeaveRequest seen, from raw frames
      this.resumeAccepted = [];
      this.terminated = null;
      C4X.onFrame((f) => this.#onFrame(f));
    }
    stack() { return 'livekit'; }

    #onFrame(f) {
      if (f.dir !== 'in' || f.gen !== C4X.generation) return;
      this.lastReplyAt = f.t;
      if (!f.raw) return;
      let m; try { m = window.LKProto.SignalResponse.fromBinary(new Uint8Array(f.raw)).message; } catch { return; }
      if (m.case === 'leave') {
        const l = { t: f.t, ws: f.ws, action: ACTION[m.value.action] ?? m.value.action, reason: window.LKProto.DisconnectReason[m.value.reason] ?? m.value.reason };
        this.leaves.push(l); C4X.log('lk_leave_frame', l);
      } else if (m.case === 'reconnect') { this.resumeAccepted.push({ t: f.t, ws: f.ws }); }
    }

    #makeRoom() {
      const LK = window.LivekitClient;
      const roomGen = C4X.generation;
      const room = new LK.Room({
        adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false,
        reconnectPolicy: { nextRetryDelayInMs: (ctx) => { C4X.log('lk_policy_consulted', { retryCount: ctx.retryCount, elapsedMs: ctx.elapsedMs, gen: roomGen, currentGen: C4X.generation }); return PASSIVE_DELAY_MS; } },
      });
      room.on(LK.RoomEvent.TrackSubscribed, (track, _pub, p) => { if (track.kind === 'audio') C4X.attachRemote(p.identity, track.mediaStreamTrack); });
      for (const ev of ['ParticipantConnected', 'ParticipantDisconnected', 'Reconnecting', 'SignalReconnecting', 'Reconnected', 'Disconnected']) {
        room.on(LK.RoomEvent[ev], (x, y) => C4X.log('lk_room_event', { ev, identity: x && x.identity, sid: x && x.sid, arg: typeof x !== 'object' && x !== undefined ? String(x) : (y !== undefined && typeof y !== 'object' ? String(y) : null), gen: C4X.generation }));
      }
      return room;
    }

    #installHooks(engine) {
      const gen = C4X.generation;
      engine.__c4gen = gen;
      const attr = this.o.attribution;
      for (const name of ['attemptReconnect', 'resumeConnection', 'restartConnection', 'close']) {
        const orig = engine[name].bind(engine);
        engine[name] = async (...args) => {
          const serverDisconnect = name === 'close' && String(args[0] || '').startsWith('server leave');
          attr.check(`lk.engine.${name}`, { gen, serverDisconnect, arg: args[0] === undefined ? null : String(args[0]) }, serverDisconnect);
          return orig(...args);
        };
      }
      const wrapOnLeave = () => {
        const c = engine.client, inner = c.onLeave;
        if (!inner || inner.__c4) return;
        const w = (leave) => {
          const action = ACTION[leave && leave.action];
          C4X.log('lk_server_leave', { action, gen });
          if (action === 'DISCONNECT') { inner(leave); return; } // terminal: pass through
          if (gen === C4X.generation) this.o.onServerRequest(action === 'RESUME' ? 'resume' : 'reconnect', { reason: leave.reason });
        };
        w.__c4 = true; c.onLeave = w;
      };
      const origSetup = engine.setupSignalClientCallbacks.bind(engine);
      engine.setupSignalClientCallbacks = () => { origSetup(); wrapOnLeave(); };
      wrapOnLeave();
      const pinned = this.o.signalTimeoutS;
      Object.defineProperty(engine.client, 'pingTimeoutDuration', { configurable: true, get: () => pinned, set: (v) => C4X.log('lk_server_ping_timeout_ignored', { serverValueS: v }) });
      window.removeEventListener('online', engine.handleBrowserOnLine);
      window.removeEventListener('offline', engine.handleBrowserOffline);
      engine.on('closing', () => C4X.log('lk_engine_closing', { gen }));
      engine.on('disconnected', (reason) => {
        C4X.log('lk_engine_disconnected', { gen, reason: reason === undefined ? null : String(reason) });
        if (gen === C4X.generation && !this.terminated) {
          const last = [...this.leaves].reverse().find((l) => l.action === 'DISCONNECT');
          this.terminated = { t: C4X.now(), reason: last ? last.reason : String(reason) };
          this.o.onTerminal(this.terminated);
        }
      });
      engine.on('resumed', () => C4X.log('lk_engine_resumed', { gen }));
    }

    async #connect() {
      this.room = this.#makeRoom();
      await this.room.connect(this.o.url, this.o.token, { autoSubscribe: true });
      this.engine = this.room.engine;
      this.#installHooks(this.engine);
      this.terminated = null;
      this.lastReplyAt = C4X.now();
      if (this.o.publish !== false) await this.room.localParticipant.publishTrack(C4X.audio.freshTrack(), { name: 'chirp', dtx: false, red: false });
      this.joinedGen = C4X.generation;
      C4X.log('lk_joined', { sid: this.sessionId(), gen: C4X.generation });
    }

    async join() { await C4X.initAudio(); await this.#connect(); return { sessionId: this.sessionId() }; }
    sessionId() { return this.room && this.room.localParticipant && this.room.localParticipant.sid; }
    isTerminated() { return !!this.terminated || !!(this.engine && this.engine._isClosed); }
    isJoined() { return !!(this.room && this.engine && this.joinedGen === C4X.generation && !this.isTerminated()); }

    /** Transport restart within the session = LiveKit resume (reconnect=1). */
    async transportRestart() {
      if (this.isTerminated()) return { ok: false, detail: 'engine closed' };
      const e = this.engine, mark = C4X.now(), sid0 = this.sessionId();
      let resumed = false; const on = () => { resumed = true; }; e.on('resumed', on);
      e.fullReconnectOnNext = false;
      await e.attemptReconnect(1 /* RR_SIGNAL_DISCONNECTED */);
      e.off('resumed', on);
      const refusal = this.leaves.find((l) => l.t >= mark && l.action === 'RECONNECT');
      if (resumed) return { ok: true, sessionId: this.sessionId(), sameSession: this.sessionId() === sid0 };
      return refusal ? { ok: false, refused: `RECONNECT/${refusal.reason}` } : { ok: false, detail: 'resume did not complete' };
    }

    /** Rebuild = abandon (DROP, no Leave) and rejoin under the same identity (spec §1.2). */
    async rebuild() {
      const old = this.room, oldGen = C4X.generation, oldSid = this.sessionId();
      if (old) old.removeAllListeners();
      await C4X.dropGeneration(oldGen);
      C4X.generation = oldGen + 1;
      try { await this.#connect(); } catch (err) { return { ok: false, detail: String(err && err.message || err) }; }
      return { ok: true, sessionId: this.sessionId(), oldSessionId: oldSid };
    }

    /** TEST ONLY (spec §6.3): a reconnect NOT made by the driver. Must be caught. */
    async plantRogue() { C4X.log('rogue_planted', { stack: 'livekit' }); this.engine.fullReconnectOnNext = false; await this.engine.attemptReconnect(1); }

    pcsHealthy() { return C4X.livePCs().every((r) => !['disconnected', 'failed', 'closed'].includes(r.pc.iceConnectionState)); }
    async leave() { try { await this.room.disconnect(); } catch {} }
  }
  window.LiveKitAdapter = LiveKitAdapter;
})();
