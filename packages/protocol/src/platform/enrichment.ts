/** Request to enrich a user profile from external data sources. */
export interface EnrichmentRequest {
  name?: string;
  email?: string;
  linkedin?: string;
  twitter?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}

/** Structured profile enrichment result. */
export interface EnrichmentResult {
  identity: {
    name: string;
    bio: string;
    location: string;
  };
  narrative: {
    context: string;
  };
  attributes: {
    skills: string[];
    interests: string[];
  };
  socials: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    telegram?: string;
    websites?: string[];
  };
  confidentMatch: boolean;
  isHuman: boolean;
}

/**
 * Profile enrichment adapter for resolving user identity from external sources.
 * Consumers provide a concrete implementation (e.g. backed by Parallel Chat API).
 */
export interface ProfileEnricher {
  enrichUserProfile(request: EnrichmentRequest): Promise<EnrichmentResult | null>;
}
