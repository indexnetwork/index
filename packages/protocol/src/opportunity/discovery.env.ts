/**
 * Centralized accessors for discovery match-type environment variables.
 *
 *   DISCOVERY_ALLOWED_TYPES   CSV of `intent`, `profile` (default: both).
 *                             Master gate for which data types may participate
 *                             in opportunity matching. `profile` is an umbrella
 *                             whose representation is selected by
 *                             DISCOVERY_PROFILE_SOURCE. Unknown tokens warn once
 *                             and are ignored; if no valid tokens remain, falls
 *                             back to both-allowed with a warning (a typo must
 *                             never disable all discovery).
 *   DISCOVERY_PROFILE_SOURCE  `premise` (default, heavyweight: atomic premises
 *                             as profile corpus + premise-to-premise) or
 *                             `user_context` (lightweight: synthesized context
 *                             paragraphs as profile corpus + context-to-context).
 *                             Unknown values warn once and fall back to `premise`.
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so
 * tests and long-lived processes observe changes.
 */
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const envLog = protocolLogger('Discovery:env');

export const DISCOVERY_MIN_SIMILARITY_DEFAULT = 0.30;
export const DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT = 50;

const DECIMAL_VALUE = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function validateThreshold(name: string, value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return value;
}

function readThreshold(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim();
  if (!DECIMAL_VALUE.test(normalized)) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return validateThreshold(name, Number(normalized), max);
}

export function validateDiscoveryMinSimilarity(value: number): number {
  return validateThreshold('DISCOVERY_MIN_SIMILARITY', value, 1);
}

export function validateDiscoveryEvaluatorMinScore(value: number): number {
  return validateThreshold('DISCOVERY_EVALUATOR_MIN_SCORE', value, 100);
}

export function discoveryMinSimilarity(): number {
  return readThreshold('DISCOVERY_MIN_SIMILARITY', DISCOVERY_MIN_SIMILARITY_DEFAULT, 1);
}

export function discoveryEvaluatorMinScore(): number {
  return readThreshold('DISCOVERY_EVALUATOR_MIN_SCORE', DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT, 100);
}

/** Data types allowed to participate in opportunity matching. */
export type DiscoveryMatchType = 'intent' | 'profile';

const VALID_TOKENS: ReadonlySet<string> = new Set(['intent', 'profile']);
const BOTH: ReadonlySet<DiscoveryMatchType> = new Set(['intent', 'profile']);

/** Tokens/values already warned about (warn-once per process). */
const warned = new Set<string>();

/** Test hook: clear warn-once state so each test observes warnings. */
export function resetDiscoveryEnvWarningsForTests(): void {
  warned.clear();
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  envLog.warn(message);
}

/** Current DISCOVERY_ALLOWED_TYPES set (default: intent + profile). */
export function discoveryAllowedTypes(): ReadonlySet<DiscoveryMatchType> {
  const raw = process.env.DISCOVERY_ALLOWED_TYPES;
  if (raw === undefined || raw.trim() === '') return BOTH;
  const parsed = new Set<DiscoveryMatchType>();
  for (const token of raw.split(',')) {
    const t = token.trim().toLowerCase();
    if (!t) continue;
    if (VALID_TOKENS.has(t)) {
      parsed.add(t as DiscoveryMatchType);
    } else {
      warnOnce(`token:${t}`, `DISCOVERY_ALLOWED_TYPES: ignoring unknown token "${t}" (valid: intent, profile)`);
    }
  }
  if (parsed.size === 0) {
    warnOnce('fallback', `DISCOVERY_ALLOWED_TYPES="${raw}" has no valid tokens; falling back to intent,profile`);
    return BOTH;
  }
  return parsed;
}

/** True when intents may participate in matching (source or candidate). */
export function discoveryIntentMatchingEnabled(): boolean {
  return discoveryAllowedTypes().has('intent');
}

/** True when profile data (premises or user_contexts) may participate. */
export function discoveryProfileMatchingEnabled(): boolean {
  return discoveryAllowedTypes().has('profile');
}

/** What "profile" means in matching: heavyweight premises or lightweight user_contexts. */
export type DiscoveryProfileSource = 'premise' | 'user_context';

/** Current DISCOVERY_PROFILE_SOURCE (default: premise). */
export function discoveryProfileSource(): DiscoveryProfileSource {
  const raw = process.env.DISCOVERY_PROFILE_SOURCE;
  if (raw === undefined || raw.trim() === '') return 'premise';
  const v = raw.trim().toLowerCase();
  if (v === 'premise' || v === 'user_context') return v;
  warnOnce(`source:${v}`, `DISCOVERY_PROFILE_SOURCE: unknown value "${raw}"; falling back to "premise" (valid: premise, user_context)`);
  return 'premise';
}
