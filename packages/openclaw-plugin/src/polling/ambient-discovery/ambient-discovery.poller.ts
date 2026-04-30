import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 10;

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

/** Single-line error text for logs (host loggers often omit structured meta). */
function formatErr(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  const tail =
    cause === undefined ? '' : `; cause: ${cause instanceof Error ? cause.message : String(cause)}`;
  return `${err.name}: ${err.message}${tail}`;
}

/**
 * Handles one ambient discovery poll cycle. Single-pass:
 *  1. GET /opportunities/pending?limit=10
 *  2. Hash the batch; skip if identical to last successful dispatch (dedup).
 *  3. Fetch today's ambient delivery count from GET /opportunities/delivery-stats.
 *  4. Build the ambient-discovery prompt and hand it to the user's main
 *     OpenClaw agent via `dispatchToMainAgent` (POST /hooks/agent →
 *     user's last channel).
 *  5. On dispatch success, advance the dedup hash. The agent confirms
 *     individual opportunities via `confirm_opportunity_delivery` MCP tool.
 *
 * The agent decides which subset to surface and confirms only what it
 * actually mentions. The dedup hash prevents back-to-back redispatch of
 * the same set.
 *
 * @returns
 *   - `'dispatched'` — a dispatch landed successfully.
 *   - `'empty'` — backend reached, but nothing to dispatch (no opportunities, all filtered out, or batch unchanged since last cycle). This is a healthy idle state, not a failure.
 *   - `'error'` — the backend was unreachable or returned an error, OR dispatch to the main agent failed. The scheduler should back off only on this case.
 */
export type AmbientDiscoveryOutcome = 'dispatched' | 'empty' | 'error';

/**
 * Compute start-of-today in the **OpenClaw host's** local timezone, expressed
 * as a UTC ISO string. The plugin is intended to run on the user's own
 * machine, so host-local matches user-local in practice; deployments where
 * the host runs a different TZ from the user (e.g. UTC server, user in PT)
 * will see the "today" boundary shift by the offset. DST transitions are
 * handled by the platform's `setHours` semantics.
 */
function midnightLocalIso(now: Date = new Date()): string {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

/**
 * Fetch today's ambient delivery count. Best-effort: returns null on any failure
 * (the prompt will then tell the agent the count is unknown). Auth failures
 * (401/403) are logged at error level since they indicate a misconfigured key
 * that will keep the soft cap permanently disabled until fixed.
 */
async function fetchAmbientDeliveredToday(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<number | null> {
  const since = encodeURIComponent(midnightLocalIso());
  const url = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/delivery-stats?since=${since}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
    });
    if (!res.ok) {
      const detail = { url, status: res.status, agentId: config.agentId, method: 'GET' };
      if (res.status === 401 || res.status === 403) {
        api.logger.error(
          `Ambient delivery-stats: HTTP ${res.status} (unauthorized — soft cap disabled) agentId=${config.agentId} method=GET url=${url}`,
          detail,
        );
      } else {
        api.logger.warn(
          `Ambient delivery-stats: HTTP ${res.status} agentId=${config.agentId} method=GET url=${url}`,
          detail,
        );
      }
      return null;
    }
    const body = (await res.json()) as { ambient?: unknown };
    return Number.isFinite(body.ambient) ? (body.ambient as number) : null;
  } catch (err) {
    api.logger.warn(
      `Ambient delivery-stats: request failed — ${formatErr(err)} agentId=${config.agentId} method=GET url=${url}`,
      { url, agentId: config.agentId, method: 'GET', error: formatErr(err) },
    );
    return null;
  }
}

export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<AmbientDiscoveryOutcome> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending?limit=${PENDING_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
    });
  } catch (err) {
    api.logger.warn(
      `Ambient discovery: pending opportunities request failed — ${formatErr(err)} agentId=${config.agentId} method=GET url=${pendingUrl}`,
      { url: pendingUrl, agentId: config.agentId, method: 'GET', error: formatErr(err) },
    );
    return 'error';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 280);
    const detail = {
      url: pendingUrl,
      status: res.status,
      body: text,
      agentId: config.agentId,
      method: 'GET',
    };
    if (res.status === 401 || res.status === 403) {
      api.logger.error(
        `Ambient discovery: pending GET HTTP ${res.status} (check API key) agentId=${config.agentId} method=GET url=${pendingUrl}`,
        detail,
      );
    } else {
      api.logger.warn(
        `Ambient discovery: pending GET HTTP ${res.status}${snippet ? ` — ${snippet}` : ''} agentId=${config.agentId} method=GET url=${pendingUrl}`,
        detail,
      );
    }
    return 'error';
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      counterpartUserId: string | null;
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Ambient discovery: no pending opportunities');
    return 'empty';
  }

  const candidates = body.opportunities
    .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
    .map((o) => ({
      opportunityId: o.opportunityId,
      counterpartUserId: o.counterpartUserId,
      headline: o.rendered.headline,
      personalizedSummary: o.rendered.personalizedSummary,
      suggestedAction: o.rendered.suggestedAction,
      narratorRemark: o.rendered.narratorRemark,
      profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}?link_preview=false`,
      acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept?link_preview=false`,
    }));

  if (!candidates.length) return 'empty';

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.info('Opportunity batch unchanged since last poll — skipping main-agent dispatch.');
    return 'empty';
  }

  const ambientDeliveredToday = await fetchAmbientDeliveredToday(api, config);
  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'ambient_discovery',
    mainAgentToolUse,
    payload: { contentType: 'ambient_discovery', ambientDeliveredToday, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return 'error';
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Ambient discovery dispatched: ${candidates.length} candidate(s); agent will confirm individually`,
    { agentId: config.agentId, ambientDeliveredToday },
  );

  return 'dispatched';
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
