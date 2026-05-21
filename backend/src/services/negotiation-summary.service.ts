/**
 * NegotiationSummaryService — backend implementation of the protocol's
 * NegotiationSummaryReader contract. Lazily constructs the default LLM-bound
 * NegotiationSummarizer on first use so module load never demands
 * OPENROUTER_API_KEY. Tests inject a fake.
 */
import { NegotiationSummarizer } from "@indexnetwork/protocol";
import type {
  DiscoveryNegotiation,
  DiscoveryNegotiationDigest,
  NegotiationSummaryReader,
} from "@indexnetwork/protocol";

import { log } from "../lib/log";

const logger = log.service.from("NegotiationSummaryService");

export interface NegotiationSummarizerLike {
  summarize(
    n: DiscoveryNegotiation,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoveryNegotiationDigest | null>;
}

export class NegotiationSummaryService implements NegotiationSummaryReader {
  private summarizer: NegotiationSummarizerLike | undefined;

  constructor(injected?: NegotiationSummarizerLike) {
    this.summarizer = injected;
  }

  private getSummarizer(): NegotiationSummarizerLike {
    if (!this.summarizer) {
      this.summarizer = new NegotiationSummarizer();
    }
    return this.summarizer;
  }

  async summarize(
    negotiation: DiscoveryNegotiation,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoveryNegotiationDigest | null> {
    try {
      return await this.getSummarizer().summarize(negotiation, options);
    } catch (err) {
      logger.warn("negotiation-summarizer threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
