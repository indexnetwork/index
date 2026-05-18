/**
 * Protocol-side contract for summarizing discovery negotiations into compact
 * digests. The protocol layer only sees this shape; the LLM implementation
 * (NegotiationSummarizer) is injected through dependency wiring.
 *
 * Pattern mirrors ChatSummaryReader: protocol defines the read shape, the
 * backend (or any consumer) provides the implementation.
 */
import type { DiscoveryNegotiation } from "../../opportunity/question.prompt.js";
import type { DiscoveryNegotiationDigest } from "../schemas/negotiation-digest.schema.js";

export interface NegotiationSummaryReader {
  /**
   * Summarize a single negotiation into a compact digest.
   *
   * @returns the digest, or `null` when summarization fails (caller should
   *   fall back to a deterministic minimal digest so questions can still
   *   be generated).
   */
  summarize(negotiation: DiscoveryNegotiation): Promise<DiscoveryNegotiationDigest | null>;
}
