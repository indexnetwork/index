import { enrichUserProfile as parallelEnrichUserProfile, type ParallelSearchRequestStruct, type ParallelEnrichmentResult } from '../lib/parallel/parallel';

/**
 * Adapter that wraps the Parallel Chat API enrichment function.
 * Bridges ParallelSearchRequestStruct to ParallelEnrichmentResult.
 * Structural compatibility with the protocol ProfileEnricher interface is
 * verified at the composition root (mcp.controller.ts) via TypeScript duck typing.
 */
export const enricherAdapter: { enrichUserProfile: (request: ParallelSearchRequestStruct) => Promise<ParallelEnrichmentResult | null> } = {
  async enrichUserProfile(request: ParallelSearchRequestStruct): Promise<ParallelEnrichmentResult | null> {
    const result = await parallelEnrichUserProfile(request);
    return result;
  },
};
