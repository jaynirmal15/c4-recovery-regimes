// LiveKit (server v1.13.7) adapter: server-facing half.
// Server surfaces used: Twirp RoomService (JSON), webhooks (via the c4-livekit event sink).
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StackAdapter } from '../base.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Webhook disconnectReason -> canonical cause. Source: livekit_models.proto DisconnectReason
// (protocol a4f4b5c) plus observed payloads (vocabulary/payloads/livekit-webhook-examples.json).
const LEFT_BY_REASON = {
  CLIENT_INITIATED: 'participant.left.graceful',
  DUPLICATE_IDENTITY: 'participant.left.replaced',
  CONNECTION_TIMEOUT: 'participant.left.media_timeout',
  SIGNAL_CLOSE: 'participant.left.signal_closed',
  PARTICIPANT_REMOVED: 'participant.left.administrative',
  ROOM_DELETED: 'participant.left.administrative',
  SERVER_SHUTDOWN: 'participant.left.administrative',
  ROOM_CLOSED: 'participant.left.administrative',
  JOIN_FAILURE: 'participant.left.unknown',
  STATE_MISMATCH: 'participant.left.unknown',
  MIGRATION: 'participant.left.unknown',
  MEDIA_FAILURE: 'participant.left.media_timeout',
  UNKNOWN_REASON: 'participant.left.unknown',
};

export default class LiveKitAdapter extends StackAdapter {
  dir() { return path.dirname(fileURLToPath(import.meta.url)); }

  /** cfg: { httpUrl, wsUrl, apiKey, apiSecret } */
  token(grants, ttlS = 600) {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u({ alg: 'HS256', typ: 'JWT' });
    const p = b64u({ iss: this.cfg.apiKey, nbf: now - 5, exp: now + ttlS, ...grants });
    return `${h}.${p}.${crypto.createHmac('sha256', this.cfg.apiSecret).update(`${h}.${p}`).digest('base64url')}`;
  }
  async twirp(method, body, grants) {
    const r = await fetch(`${this.cfg.httpUrl}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token({ sub: 'c4-adapter', video: grants })}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`twirp ${method} ${r.status} ${JSON.stringify(j)}`);
    return j;
  }

  describe() {
    return {
      stack: 'livekit',
      serverVersion: '1.13.7',
      deployment: 'helm livekit/livekit-server 1.9.0, ns c4-livekit, pod networking, no TURN, single node',
      timers: {
        iceDisconnectedTimeoutS: 10, iceFailedTimeoutS: 5, disconnectCleanupS: 5,
        observedLossToRemovalS: 20.8, signalPingIntervalS: 5, signalPingTimeoutS: 15,
        roomDepartureTimeoutS: 20, roomEmptyTimeoutS: 300,
        note: 'ICE/cleanup timers hard-coded in v1.13.7 (pkg/rtc/transport.go, participant.go); not configurable',
      },
    };
  }
  async health() {
    const r = await fetch(`${this.cfg.httpUrl}/`).catch((e) => ({ ok: false, statusText: String(e) }));
    return { ok: !!r.ok, detail: r.ok ? 'http 200' : r.statusText };
  }
  async ensureRoom(room) {
    const list = await this.twirp('ListRooms', { names: [room] }, { roomList: true });
    if ((list.rooms || []).length) return { room, created: false };
    await this.twirp('CreateRoom', { name: room }, { roomCreate: true });
    return { room, created: true };
  }
  async listParticipants(room) {
    const j = await this.twirp('ListParticipants', { room }, { roomAdmin: true, room });
    return (j.participants || []).map((p) => ({ key: `${p.identity}/${p.sid}`, identity: p.identity, sessionId: p.sid, state: p.state || 'JOINING', raw: p }));
  }
  async mintJoinCredential(room, identity) {
    return { url: this.cfg.wsUrl, token: this.token({ sub: identity, video: { roomJoin: true, room } }, 3600) };
  }

  /** record: {logged_at, path, body} from probes/extract-sink.py */
  parseSinkRecord(rec) {
    const b = rec.body;
    if (!b || typeof b !== 'object' || !b.event) return [];
    return [{ source: 'webhook', at: Date.parse(rec.logged_at), atSource: 'sink-receive', native: b }];
  }

  /** One line of `kubectl logs --timestamps` from an lk CLI observer (server-sdk-go view of others). */
  parseClientRecord(line) {
    const m = line.match(/^(\S+Z) .*participant (connected|disconnected)\t(\{.*\})/);
    if (!m) return [];
    const d = JSON.parse(m[3]);
    return [{ source: 'client', at: Date.parse(m[1]), atSource: 'client', native: { kind: m[2], identity: d.participant, sid: d.participantID } }];
  }

  normalize(natives) {
    const out = [];
    for (const n of [...natives].sort((a, b) => a.at - b.at)) {
      if (n.source === 'client') {
        const k = `${n.native.identity}/${n.native.sid}`;
        // lk (server-sdk-go) reports no cause; its events are quantized to 1 s ticks.
        out.push(StackAdapter.ev(n.native.kind === 'connected' ? 'participant.joined' : 'participant.left.unknown',
          { observer: 'other', at: n.at, atSource: n.atSource, participantKey: k, native: `lk-observer:${n.native.kind}` }));
        continue;
      }
      const b = n.native, p = b.participant || {};
      const key = p.identity ? `${p.identity}/${p.sid}` : null;
      const base = { at: n.at, atSource: n.atSource, participantKey: key, native: `webhook:${b.event}` };
      switch (b.event) {
        case 'room_started': out.push(StackAdapter.ev('room.created', base)); break;
        case 'room_finished': out.push(StackAdapter.ev('room.ended', base)); break;
        case 'participant_joined': out.push(StackAdapter.ev('participant.joined', base)); break;
        case 'participant_left': {
          const c = LEFT_BY_REASON[p.disconnectReason || 'UNKNOWN_REASON'] || 'participant.left.unknown';
          out.push(StackAdapter.ev(c, { ...base, native: `webhook:participant_left/${p.disconnectReason}` }));
          break;
        }
        case 'participant_connection_aborted': out.push(StackAdapter.ev('participant.left.unknown', { ...base, native: 'webhook:participant_connection_aborted' })); break; // never became connected (docs-only)
        case 'track_published': out.push(StackAdapter.ev('participant.media.published', base)); break;
        case 'track_unpublished': out.push(StackAdapter.ev('participant.media.unpublished', base)); break;
        default: break;
      }
    }
    return out;
  }
}
