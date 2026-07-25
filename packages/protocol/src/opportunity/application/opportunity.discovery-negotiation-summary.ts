import type { NegotiationSummaryReader } from '../../shared/interfaces/negotiation-summary.interface.js';
import type { DiscoveryNegotiationDigest } from '../../shared/schemas/negotiation-digest.schema.js';
import type { DiscoveryNegotiation } from '../../shared/schemas/discovery-question.schema.js';
import { buildFallbackDigest } from '../../capabilities/negotiation.summary.facade.js';
import { protocolLogger } from '../../shared/observability/protocol.logger.js';
import { traceAgent } from '../../shared/observability/trace.js';

const logger = protocolLogger('OpportunityDiscoveryNegotiationSummary');
const NEGOTIATION_SUMMARY_TIMEOUT_MS_DEFAULT = 5_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return fallback;
  return n;
}

function combineWithDeadline(
  callerSignal: AbortSignal | undefined,
  deadlineMs: number,
): AbortSignal {
  const deadline = AbortSignal.timeout(deadlineMs);
  if (!callerSignal) return deadline;
  return AbortSignal.any([callerSignal, deadline]);
}

export interface DiscoveryNegotiationSummaryInput {
  negotiations: DiscoveryNegotiation[];
  summarizer: NegotiationSummaryReader | undefined;
  callerSignal?: AbortSignal;
}

/**
 * Summarizes each already-admitted discovery negotiation independently. A
 * missing, null, empty, or failed model response falls back per negotiation so
 * one failure cannot suppress an ordered batch of deterministic digests.
 */
export async function summarizeDiscoveryNegotiations(
  args: DiscoveryNegotiationSummaryInput,
): Promise<DiscoveryNegotiationDigest[]> {
  const perNegTimeoutMs = parsePositiveIntEnv(
    'NEGOTIATION_SUMMARY_TIMEOUT_MS',
    NEGOTIATION_SUMMARY_TIMEOUT_MS_DEFAULT,
  );

  return traceAgent(
    `Negotiation summary (${args.negotiations.length})`,
    () =>
      Promise.all(
        args.negotiations.map(async (negotiation) => {
          if (!args.summarizer) return buildFallbackDigest(negotiation);
          const signal = combineWithDeadline(args.callerSignal, perNegTimeoutMs);
          try {
            const digest = await args.summarizer.summarize(negotiation, { signal });
            return digest ?? buildFallbackDigest(negotiation);
          } catch (err) {
            const aborted = err instanceof Error && err.name === 'AbortError';
            logger.warn('negotiationSummary.summarize threw — using fallback digest', {
              counterpartyHint: negotiation.counterpartyHint,
              aborted,
              error: err instanceof Error ? err.message : String(err),
            });
            return buildFallbackDigest(negotiation);
          }
        }),
      ),
    (digests) => `${digests.length} digest${digests.length === 1 ? '' : 's'}`,
  );
}
