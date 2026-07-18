/**
 * Protocol-side contract for summarizing discovery negotiations into compact
 * digests. The protocol layer only sees this shape; the LLM implementation
 * (NegotiationSummarizer) is injected through dependency wiring.
 *
 * Pattern mirrors ChatSummaryReader: protocol defines the read shape, the
 * backend (or any consumer) provides the implementation.
 */
import type { DiscoveryNegotiation } from "../schemas/discovery-question.schema.js";
import type { DiscoveryNegotiationDigest } from "../schemas/negotiation-digest.schema.js";

export interface NegotiationSummaryReader {
  /**
   * Summarize a single negotiation into a compact digest.
   *
   * @param negotiation  The raw negotiation to compress.
   * @param options.signal  Optional AbortSignal. When aborted (deadline reached or
   *   upstream cancel) the in-flight LLM call is cancelled and `null` is returned —
   *   callers fall back to a deterministic digest so question generation can
   *   still proceed.
   * @returns the digest, or `null` when summarization fails or is aborted.
   */
  summarize(
    negotiation: DiscoveryNegotiation,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoveryNegotiationDigest | null>;
}
