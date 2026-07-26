/**
 * IND-593 Batch A: Redis adapter for the opportunity owner-approval store.
 *
 * Follows the established ioredis Lua pattern (see lib/limiter/storage.redis.ts):
 * scripts are pre-loaded with SCRIPT LOAD and invoked via EVALSHA; on NOSCRIPT
 * (server restart / SCRIPT FLUSH) the scripts are reloaded and the call is
 * retried exactly once. Each script is atomic on the Redis side, which makes
 * one-shot issuance and exactly-one consumption hold across API replicas.
 *
 * Keyspace (around the authority's opaque 64-hex challenge hash `<key>`):
 * - `mcp:oap:c:<key>` — challenge hash: field `record` (opaque authority JSON)
 *   and one-shot field `issued`. PEXPIREd to the retention window supplied by
 *   the store contract (RETENTION_FACTOR × ttl), so recently-expired
 *   challenges still resolve to `stale` before eviction cleans them up.
 * - `mcp:oap:u:<key>` — replay marker armed on consumption, PX-limited to the
 *   supplied replay TTL.
 */
import type Redis from 'ioredis';

import { OWNER_APPROVAL_RETENTION_FACTOR, type OpportunityOwnerApprovalStore, type OwnerApprovalPeek } from './owner-approval.store';

const CHALLENGE_PREFIX = 'mcp:oap:c:';
const MARKER_PREFIX = 'mcp:oap:u:';

const PUT_LUA = `
-- oap:put — register a challenge record with retention TTL.
-- KEYS[1]=challenge  ARGV[1]=record  ARGV[2]=retention ms
redis.call('HSET', KEYS[1], 'record', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const PEEK_LUA = `
-- oap:peek — non-mutating challenge state read.
-- KEYS[1]=challenge  KEYS[2]=replay marker
if redis.call('EXISTS', KEYS[2]) == 1 then return {'consumed'} end
local record = redis.call('HGET', KEYS[1], 'record')
if not record then return {'absent'} end
if redis.call('HGET', KEYS[1], 'issued') then return {'pending', record, '1'} end
return {'pending', record, '0'}
`;

const ISSUE_LUA = `
-- oap:issue — atomic one-shot issuance flag.
-- KEYS[1]=challenge
if redis.call('EXISTS', KEYS[1]) == 0 then return 'absent' end
if redis.call('HSETNX', KEYS[1], 'issued', '1') == 1 then return 'issued' end
return 'already_issued'
`;

const CONSUME_LUA = `
-- oap:consume — exactly-one consumption plus replay marker.
-- KEYS[1]=challenge  KEYS[2]=replay marker  ARGV[1]=replay ttl ms
if redis.call('EXISTS', KEYS[2]) == 1 then return 'replayed' end
if redis.call('EXISTS', KEYS[1]) == 0 then return 'absent' end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], '1', 'PX', ARGV[1])
return 'consumed'
`;

const SCRIPTS = { put: PUT_LUA, peek: PEEK_LUA, issue: ISSUE_LUA, consume: CONSUME_LUA } as const;
type ScriptName = keyof typeof SCRIPTS;

export class RedisOwnerApprovalStore implements OpportunityOwnerApprovalStore {
  private shas: Partial<Record<ScriptName, string>> = {};

  constructor(private readonly redis: Redis) {}

  /** Pre-load all Lua scripts and cache their SHAs (lazy on first use). */
  async bootstrap(): Promise<void> {
    const loaded: Partial<Record<ScriptName, string>> = {};
    for (const [name, source] of Object.entries(SCRIPTS) as Array<[ScriptName, string]>) {
      loaded[name] = (await this.redis.script('LOAD', source)) as string;
    }
    this.shas = loaded;
  }

  async putChallenge(key: string, record: string, ttlMs: number): Promise<void> {
    await this.eval('put', [CHALLENGE_PREFIX + key], [record, String(ttlMs * OWNER_APPROVAL_RETENTION_FACTOR)]);
  }

  async peekChallenge(key: string): Promise<OwnerApprovalPeek> {
    const result = (await this.eval('peek', [CHALLENGE_PREFIX + key, MARKER_PREFIX + key], [])) as string[];
    switch (result[0]) {
      case 'consumed':
        return { state: 'consumed' };
      case 'pending':
        return { state: 'pending', record: result[1] ?? '', issued: result[2] === '1' };
      default:
        return { state: 'absent' };
    }
  }

  async issueOnce(key: string): Promise<'issued' | 'already_issued' | 'absent'> {
    return (await this.eval('issue', [CHALLENGE_PREFIX + key], [])) as 'issued' | 'already_issued' | 'absent';
  }

  async consumeOnce(key: string, replayTtlMs: number): Promise<'consumed' | 'replayed' | 'absent'> {
    return (await this.eval(
      'consume',
      [CHALLENGE_PREFIX + key, MARKER_PREFIX + key],
      [String(replayTtlMs)],
    )) as 'consumed' | 'replayed' | 'absent';
  }

  /** EVALSHA with a single reload-and-retry on NOSCRIPT. @throws otherwise. */
  private async eval(name: ScriptName, keys: string[], args: string[]): Promise<unknown> {
    if (!this.shas[name]) await this.bootstrap();
    try {
      return await this.redis.evalsha(this.shas[name]!, keys.length, ...keys, ...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('NOSCRIPT')) throw err;
      await this.bootstrap();
      return await this.redis.evalsha(this.shas[name]!, keys.length, ...keys, ...args);
    }
  }
}
