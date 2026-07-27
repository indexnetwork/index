/**
 * IND-593 Batch A test helper: deterministic fake ioredis client for the
 * owner-approval Redis store's Lua scripts. Implements exactly the surface the
 * adapter uses — `script('LOAD', src)` and `evalsha(sha, numKeys, ...args)` —
 * over an in-memory keyspace with a controllable clock and per-key expiry, so
 * the script semantics (atomic one-shot issue, exactly-one consume, replay
 * marker TTL, retention expiry) are provable without ever contacting a live
 * Redis server. Scripts are dispatched by their `-- oap:<op>` marker comment.
 */

type FakeEntry = {
  /** Hash fields for challenge keys; plain string for marker keys. */
  fields?: Map<string, string>;
  value?: string;
  /** Absolute fake-clock expiry in ms; undefined = no TTL. */
  expiresAt?: number;
};

export class FakeOwnerApprovalRedis {
  /** Controllable fake clock (ms). */
  now = 0;
  /** Every key ever touched by a script, for opaque-key/namespace assertions. */
  readonly touchedKeys: string[] = [];
  /** When > 0, the next N evalsha calls throw NOSCRIPT (retry-path testing). */
  noscriptFailures = 0;
  scriptLoads = 0;
  evalshaCalls = 0;

  private readonly keyspace = new Map<string, FakeEntry>();
  private readonly scripts = new Map<string, string>();

  async script(command: string, source: string): Promise<string> {
    if (command !== 'LOAD') throw new Error(`FakeOwnerApprovalRedis: unsupported SCRIPT ${command}`);
    this.scriptLoads += 1;
    const sha = `fake-sha-${this.scriptLoads}:${this.marker(source)}`;
    this.scripts.set(sha, source);
    return sha;
  }

  async evalsha(sha: string, _numKeys: number, ...args: string[]): Promise<unknown> {
    this.evalshaCalls += 1;
    if (this.noscriptFailures > 0) {
      this.noscriptFailures -= 1;
      throw new Error('NOSCRIPT No matching script. Please use EVAL.');
    }
    const source = this.scripts.get(sha);
    if (!source) throw new Error('NOSCRIPT No matching script. Please use EVAL.');
    switch (this.marker(source)) {
      case 'put': {
        const [key, record, retentionMs] = [args[0]!, args[1]!, args[2]!];
        this.touch(key);
        this.keyspace.set(key, {
          fields: new Map([['record', record]]),
          expiresAt: this.now + Number(retentionMs),
        });
        return 1;
      }
      case 'peek': {
        const [challengeKey, markerKey] = [args[0]!, args[1]!];
        this.touch(challengeKey, markerKey);
        if (this.live(markerKey)) return ['consumed'];
        const entry = this.live(challengeKey);
        if (!entry?.fields) return ['absent'];
        return ['pending', entry.fields.get('record') ?? '', entry.fields.get('issued') === '1' ? '1' : '0'];
      }
      case 'issue': {
        const key = args[0]!;
        this.touch(key);
        const entry = this.live(key);
        if (!entry?.fields) return 'absent';
        if (entry.fields.has('issued')) return 'already_issued';
        entry.fields.set('issued', '1');
        return 'issued';
      }
      case 'consume': {
        const [challengeKey, markerKey, replayTtlMs] = [args[0]!, args[1]!, args[2]!];
        this.touch(challengeKey, markerKey);
        if (this.live(markerKey)) return 'replayed';
        if (!this.live(challengeKey)) return 'absent';
        this.keyspace.delete(challengeKey);
        this.keyspace.set(markerKey, { value: '1', expiresAt: this.now + Number(replayTtlMs) });
        return 'consumed';
      }
      default:
        throw new Error(`FakeOwnerApprovalRedis: unrecognized script ${sha}`);
    }
  }

  /** Marker comment (`-- oap:<op>`) identifying each adapter script. */
  private marker(source: string): string {
    const match = /--\s*oap:([a-z_]+)/.exec(source);
    if (!match) throw new Error('FakeOwnerApprovalRedis: script missing -- oap:<op> marker');
    return match[1]!;
  }

  /** Returns the entry only while unexpired; evicts lazily like Redis TTL. */
  private live(key: string): FakeEntry | undefined {
    const entry = this.keyspace.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now) {
      this.keyspace.delete(key);
      return undefined;
    }
    return entry;
  }

  private touch(...keys: string[]): void {
    this.touchedKeys.push(...keys);
  }
}
