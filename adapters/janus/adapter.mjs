// Janus 1.4.1 VideoRoom adapter: server-facing half.
// Server surfaces used: HTTP API (/janus), sampleevh event stream (via the c4-janus event sink).
// Participant key = "<room>/<feedId>". VideoRoom leaving/unpublished events carry no
// session_id, so cause is recovered by correlating with the session events that precede
// them (see vocabulary/janus.md §1 "Correlation hazards").
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StackAdapter } from '../base.mjs';

const T = { SESSION: 1, HANDLE: 2, JSEP: 8, WEBRTC: 16, MEDIA: 32, PLUGIN: 64, TRANSPORT: 128, CORE: 256 };
const txn = () => Math.random().toString(36).slice(2, 12);

export default class JanusAdapter extends StackAdapter {
  dir() { return path.dirname(fileURLToPath(import.meta.url)); }

  /** cfg: { httpUrl (…/janus), wsUrl } */
  async api(body, sessionId, handleId) {
    const url = [this.cfg.httpUrl, sessionId, handleId].filter(Boolean).join('/');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, transaction: txn() }) });
    return r.json();
  }
  async withVideoRoom(fn) {
    const s = (await this.api({ janus: 'create' })).data.id;
    try {
      const h = (await this.api({ janus: 'attach', plugin: 'janus.plugin.videoroom' }, s)).data.id;
      return await fn((body) => this.api({ janus: 'message', body }, s, h).then((r) => r.plugindata && r.plugindata.data));
    } finally { await this.api({ janus: 'destroy' }, s).catch(() => {}); }
  }

  describe() {
    return {
      stack: 'janus-videoroom',
      serverVersion: '1.4.1 (Debian 1.4.1+ds-4+b2)',
      deployment: 'debian:sid-slim + snapshot 20260928T000000Z apt pin, ns c4-janus, pod networking',
      timers: {
        sessionTimeoutS: 60, reclaimSessionTimeoutS: 0, observedSilentToRemovalS: 60.05,
        wsCloseToRemovalMs: 0, candidatesTimeoutS: 45, iceConsentFreshness: false, hangupOnFailed: false,
        note: 'session/reclaim timers are server config (deploy/janus/configmap.yaml) and are study variables',
      },
    };
  }
  async health() {
    const r = await fetch(`${this.cfg.httpUrl}/info`).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    return { ok: r.janus === 'server_info', detail: r.version_string || r.error };
  }
  async ensureRoom(room) {
    return this.withVideoRoom(async (msg) => {
      const ex = await msg({ request: 'exists', room });
      if (ex && ex.exists) return { room, created: false };
      const c = await msg({ request: 'create', room, permanent: false, publishers: 6, notify_joining: true });
      return { room, created: c && c.videoroom === 'created' };
    });
  }
  async listParticipants(room) {
    return this.withVideoRoom(async (msg) => {
      const d = await msg({ request: 'listparticipants', room });
      return ((d && d.participants) || []).map((p) => ({ key: `${room}/${p.id}`, identity: p.display, sessionId: null, state: p.publisher ? 'PUBLISHING' : 'JOINED', raw: p }));
    });
  }
  async mintJoinCredential(room, identity) {
    // No token auth in this deployment; the feed id is the identity key and must be unique while present (436).
    return { url: this.cfg.wsUrl, room, display: identity, note: 'feed id collision -> 436 until the old session dies' };
  }

  /** Sink record from probes/extract-sink.py; body is one evh event or an array (grouping=true). */
  parseSinkRecord(rec) {
    const b = rec.body;
    const list = Array.isArray(b) ? b : [b];
    return list.filter((e) => e && typeof e === 'object' && e.type)
      .map((e) => ({ source: 'evh', at: e.timestamp / 1000, atSource: 'server-us', native: e }));
  }
  /** One line of probes/raw/janus-probe.jsonl (client-side view). */
  parseClientRecord(line) {
    if (line.dir !== 'recv') return [];
    return [{ source: 'client', at: Date.parse(line.t), atSource: 'client', who: line.who, native: line.msg }];
  }

  normalize(natives) {
    const out = [];
    const sessions = new Map(); // session_id -> {transportId, feeds:Set, cause}
    const feedSession = new Map(); // "room/id" -> session_id
    const published = new Set();
    const lastUnpubAt = new Map(); // client view: "room/id" -> t
    const sorted = [...natives].sort((a, b) => a.at - b.at);
    for (const n of sorted) {
      const base = { at: n.at, atSource: n.atSource };
      if (n.source === 'client') { this.#client(n, base, out, lastUnpubAt); continue; }
      const e = n.native, ev = e.event || {};
      if (e.type === T.SESSION) {
        if (ev.name === 'created') sessions.set(e.session_id, { transportId: ev.transport && ev.transport.id, feeds: new Set(), cause: null });
        const s = sessions.get(e.session_id);
        if (s && ev.name === 'timeout') s.cause = 'participant.left.inactivity_timeout';
        if (s && ev.name === 'destroyed' && !s.cause) s.cause = s.transportClosed ? 'participant.left.signal_closed' : 'participant.left.graceful';
      } else if (e.type === T.TRANSPORT && ev.data && ev.data.event === 'disconnected') {
        for (const [, s] of sessions) {
          if (s.transportId === ev.id && !s.cause && !s.transportClosed) {
            s.transportClosed = true;
            for (const f of s.feeds) out.push(StackAdapter.ev('participant.signal.lost', { ...base, participantKey: f, native: 'evh:transport/disconnected' }));
          }
        }
      } else if (e.type === T.PLUGIN) {
        const d = ev.data || {}, key = `${d.room}/${d.id}`;
        if (d.event === 'joined') {
          feedSession.set(key, e.session_id);
          const s = sessions.get(e.session_id); if (s) s.feeds.add(key);
          out.push(StackAdapter.ev('participant.joined', { ...base, participantKey: key, native: 'evh:plugin/joined' }));
        } else if (d.event === 'published') {
          published.add(key); out.push(StackAdapter.ev('participant.media.published', { ...base, participantKey: key, native: 'evh:plugin/published' }));
        } else if (d.event === 'unpublished') {
          // Janus also emits this on teardown for feeds that never published; only a real
          // publisher can "stop publishing".
          if (published.delete(key)) out.push(StackAdapter.ev('participant.media.unpublished', { ...base, participantKey: key, native: 'evh:plugin/unpublished' }));
        } else if (d.event === 'leaving' || d.event === 'kicked') {
          const s = sessions.get(feedSession.get(key));
          const cause = d.event === 'kicked' ? 'participant.left.administrative' : (s && s.cause) || 'participant.left.graceful';
          out.push(StackAdapter.ev(cause, { ...base, participantKey: key, native: `evh:plugin/${d.event}` }));
          feedSession.delete(key); if (s) s.feeds.delete(key);
        } else if (d.event === 'created') out.push(StackAdapter.ev('room.created', { ...base, native: 'evh:plugin/created' }));
        else if (d.event === 'destroyed') out.push(StackAdapter.ev('room.ended', { ...base, native: 'evh:plugin/destroyed' }));
      } else if (e.type === T.WEBRTC) {
        if (ev.connection === 'hangup' || ev.ice === 'failed') out.push(StackAdapter.ev('participant.transport.lost', { ...base, participantKey: `session:${e.session_id}`, native: `evh:webrtc/${ev.connection || 'ice:' + ev.ice}` }));
      } else if (e.type === T.MEDIA && typeof ev.receiving === 'boolean') {
        out.push(StackAdapter.ev(ev.receiving ? 'participant.media.flowing' : 'participant.media.stalled', { ...base, participantKey: `session:${e.session_id}`, native: 'evh:media/receiving' }));
      }
    }
    return out;
  }

  #client(n, base, out, lastUnpubAt) {
    const m = n.native, pd = (m.plugindata && m.plugindata.data) || {};
    const self = { ...base, observer: 'self', participantKey: `client:${n.who}` };
    if (m.janus === 'timeout') out.push(StackAdapter.ev('participant.left.inactivity_timeout', { ...self, native: 'client:timeout' }));
    else if (m.janus === 'error' && m.error && m.error.code === 458) out.push(StackAdapter.ev('participant.signal.reclaim_failed', { ...self, native: 'client:error/458' }));
    else if (pd.error_code === 436) out.push(StackAdapter.ev('participant.rejoin.rejected', { ...self, native: 'client:videoroom/436' }));
    else if (pd.videoroom === 'event' && pd.room !== undefined) {
      const other = { ...base, observer: 'other' };
      if (pd.joining) out.push(StackAdapter.ev('participant.joined', { ...other, participantKey: `${pd.room}/${pd.joining.id}`, native: 'client:videoroom/joining' }));
      if (typeof pd.unpublished === 'number') lastUnpubAt.set(`${pd.room}/${pd.unpublished}`, n.at);
      if (typeof pd.leaving === 'number') {
        const key = `${pd.room}/${pd.leaving}`, u = lastUnpubAt.get(key);
        // Other participants cannot tell WS-close from timeout: both arrive as unpublished+leaving.
        const cause = u !== undefined && n.at - u <= 5 ? 'participant.left.unknown' : 'participant.left.graceful';
        out.push(StackAdapter.ev(cause, { ...other, participantKey: key, native: u !== undefined ? 'client:videoroom/unpublished+leaving' : 'client:videoroom/leaving' }));
        lastUnpubAt.delete(key);
      }
    }
  }
}
