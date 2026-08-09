import { log } from '../lib/log';
import { EnrichmentGraphFactory } from '@indexnetwork/protocol';
import type { EnrichmentGraphDatabase, Scraper } from '@indexnetwork/protocol';
import { EnrichmentDatabaseAdapter, userDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { S3StorageAdapter } from '../adapters/storage.adapter';
import { enrichUserProfile } from '../lib/parallel/parallel';

const logger = log.service.from("EnrichmentService");

/** The identity + socials a synchronous enrichment resolves and persists. */
export interface SyncEnrichmentResult {
  name: string | null;
  intro: string | null;
  location: string | null;
  avatar: string | null;
  socials: { label: string; value: string }[];
}

/** content-type → file extension for avatar images we accept. */
const AVATAR_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MIN_AVATAR_BYTES = 1024;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const UNAVATAR_BASE = process.env.UNAVATAR_BASE || 'https://unavatar.io';
const UNAVATAR_TOKEN = process.env.UNAVATAR_TOKEN || '';

/** Reduce a handle or profile URL to its bare username (no `@`, no URL parts). */
function bareHandle(value: string): string {
  return (value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '')
    .replace(/^@/, '')
    .trim();
}

/**
 * Download a URL and return its bytes only if it is a supported avatar image
 * between MIN and MAX bytes. Never throws — a bad/missing/oversized/favicon-sized
 * response just yields null so the source is skipped.
 */
async function downloadAvatar(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!(contentType in AVATAR_CONTENT_TYPES)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_AVATAR_BYTES || buffer.length > MAX_AVATAR_BYTES) return null;
    return { buffer, contentType };
  } catch {
    return null;
  }
}

/**
 * EnrichmentService
 *
 * Manages profile generation and synchronization.
 * Uses EnrichmentDatabaseAdapter for database operations.
 * Uses EnrichmentGraphFactory for graph-based profile generation.
 *
 * RESPONSIBILITIES:
 * - Generate/sync user profiles through Enrichment Graph
 * - Coordinate profile and scraper operations
 */
export class EnrichmentService {
  private db: EnrichmentGraphDatabase;
  private scraper: Scraper;
  private factory: EnrichmentGraphFactory;
  private enricherFactory: EnrichmentGraphFactory;
  private storage = new S3StorageAdapter({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    bucket: process.env.S3_BUCKET ?? '',
  });

  constructor() {
    this.db = new EnrichmentDatabaseAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new EnrichmentGraphFactory(this.db, this.scraper);
    // Separate factory wired with the Parallel enricher for the on-demand
    // public-research path. Kept distinct from `factory` so the light
    // `syncProfile` (used by the `/me` auto-enrichment hot path) is unchanged.
    this.enricherFactory = new EnrichmentGraphFactory(this.db, this.scraper, { enrichUserProfile });
  }

  /**
   * Run the full public-research enrichment synchronously and return the
   * resolved identity + socials. Unlike `syncProfile`, this uses the Parallel
   * enricher: generate mode routes through `auto_generate`, which looks the
   * person up from name+email and persists discovered socials/location/bio.
   * Premise/HyDE work is intentionally left to the async pipeline (no premise
   * graph injected here), so this stays a bounded, request-time call.
   */
  async enrichNow(userId: string): Promise<SyncEnrichmentResult> {
    logger.verbose('Synchronous enrichment requested', { userId });

    const graph = this.enricherFactory.createGraph();
    await graph.invoke({ userId, operationMode: 'generate' });

    const user = await this.db.getUser(userId);
    const socials = await this.db.getUserSocials(userId);
    const flatSocials = socials.map((s) => ({ label: s.label, value: s.value }));
    const avatar = await this.resolveAndStoreAvatar(
      userId,
      user?.email ?? '',
      user?.avatar ?? null,
      flatSocials,
    );
    return {
      name: user?.name ?? null,
      intro: user?.intro ?? null,
      location: user?.location ?? null,
      avatar,
      socials: flatSocials,
    };
  }

  /**
   * Best-effort avatar for a freshly enriched user, using the discovered socials
   * + email. Sources mirror the backfill learning: the GitHub avatar first, then
   * unavatar.io (twitter → telegram handle → email, always `fallback=false`).
   * Telegram bot photo fetching is intentionally excluded. Users who already have
   * an avatar are left untouched. Never throws — a miss or error just leaves the
   * avatar unset so enrichment always returns.
   */
  private async resolveAndStoreAvatar(
    userId: string,
    email: string,
    avatar: string | null,
    socials: { label: string; value: string }[],
  ): Promise<string | null> {
    if (avatar) return avatar;

    const social = (label: string) => socials.find((s) => s.label === label)?.value;
    const github = social('github');
    const twitter = social('twitter');
    const telegram = social('telegram');

    // Candidate sources, most identity-bound first. unavatar always uses
    // `fallback=false` so a miss is a clean 404, not a stored placeholder.
    const q = UNAVATAR_TOKEN ? `fallback=false&token=${encodeURIComponent(UNAVATAR_TOKEN)}` : 'fallback=false';
    const urls: string[] = [];
    if (github) urls.push(`https://github.com/${encodeURIComponent(bareHandle(github))}.png?size=460`);
    if (twitter) urls.push(`${UNAVATAR_BASE}/twitter/${encodeURIComponent(bareHandle(twitter))}?${q}`);
    if (telegram) urls.push(`${UNAVATAR_BASE}/telegram/${encodeURIComponent(bareHandle(telegram))}?${q}`);
    if (email) urls.push(`${UNAVATAR_BASE}/${encodeURIComponent(email.trim())}?${q}`);

    try {
      for (const url of urls) {
        const img = await downloadAvatar(url);
        if (!img) continue;
        const key = await this.storage.uploadAvatar(
          img.buffer,
          userId,
          AVATAR_CONTENT_TYPES[img.contentType],
          img.contentType,
        );
        await userDatabaseAdapter.update(userId, { avatar: key });
        logger.verbose('Avatar resolved from enrichment', { userId, key });
        return key;
      }
    } catch (err) {
      logger.warn('Avatar resolution failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  /**
   * Sync/generate a profile for a user.
   * Invokes the enrichment graph to create or update the user's profile.
   *
   * @param userId - The user ID
   * @returns Graph execution result with profile data, plus a flat `intro` field
   *   sourced from `users.intro` (the canonical identity bio home).
   */
  async syncProfile(userId: string): Promise<Record<string, unknown>> {
    logger.verbose('Syncing profile', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId });

    // The enrichment graph persists the identity bio to `users.intro`. Surface it as a
    // flat field so callers (e.g. the frontend intro display) read the canonical
    // users-table value instead of the soon-to-be-removed `profile.identity.bio`.
    const user = await this.db.getUser(userId);
    return { ...result, intro: user?.intro ?? null };
  }

  /**
   * Embed profiles (and generate HyDE) for a list of tester users.
   * Used by db-seed to run enrichment graph write mode for each persona.
   *
   * @param personaUsers - List of user ids (same order as personas)
   * @param personas - List of persona names for logging (same length as personaUsers)
   * @returns Counts of successful embeddings and failures
   */
  async embedTesterProfiles(
    personaUsers: { id: string }[],
    personas: Array<{ name: string }>
  ): Promise<{ embedded: number; embedFailures: number }> {
    let embedded = 0;
    let embedFailures = 0;
    const graph = this.factory.createGraph();

    for (let i = 0; i < personaUsers.length && i < personas.length; i++) {
      const userId = personaUsers[i].id;
      const name = personas[i].name;
      try {
        const result = await graph.invoke({ userId, operationMode: 'write' });
        if (result.error) {
          embedFailures++;
          logger.warn('Embed failed', { name, error: result.error });
        } else {
          embedded++;
        }
      } catch (err: unknown) {
        embedFailures++;
        logger.warn('Embed error', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { embedded, embedFailures };
  }
}

export const enrichmentService = new EnrichmentService();
