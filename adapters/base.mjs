// Base class for C4 stack adapters. See interface.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADAPTERS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CANONICAL = JSON.parse(fs.readFileSync(path.join(ADAPTERS_DIR, 'canonical-events.json'), 'utf8'));
export const REQUIRED_METHODS = ['describe', 'health', 'ensureRoom', 'listParticipants', 'mintJoinCredential', 'parseSinkRecord', 'normalize'];

export class NotImplemented extends Error {}

export class StackAdapter {
  /** @param {object} cfg  stack-specific endpoints/credentials; never logged */
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.mapping = JSON.parse(fs.readFileSync(path.join(this.dir(), 'mapping.json'), 'utf8'));
  }
  /** Directory of the concrete adapter (override if the subclass lives elsewhere). */
  dir() { throw new NotImplemented('dir'); }
  describe() { throw new NotImplemented('describe'); }
  async health() { throw new NotImplemented('health'); }
  async ensureRoom() { throw new NotImplemented('ensureRoom'); }
  async listParticipants() { throw new NotImplemented('listParticipants'); }
  async mintJoinCredential() { throw new NotImplemented('mintJoinCredential'); }
  parseSinkRecord() { throw new NotImplemented('parseSinkRecord'); }
  normalize() { throw new NotImplemented('normalize'); }

  /** Helper for subclasses: build a canonical event and assert the name is in the vocabulary. */
  static ev(canonical, { observer = 'server', at, atSource, participantKey = null, native }) {
    if (!CANONICAL.events[canonical]) throw new Error(`not a canonical event: ${canonical}`);
    return { canonical, observer, at, atSource, participantKey, native };
  }
}
