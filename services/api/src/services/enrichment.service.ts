import type { ParallelEnrichmentResult } from '../lib/parallel/parallel';
import { createPremisesFromProfile as runCreatePremisesFromProfile } from '../lib/enrichment/create-premises-from-profile';

import { log } from '../lib/log';
import { enrichUserProfile } from '../lib/parallel/parallel';
import { EnrichmentDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from('EnrichmentService');

export interface ResearchHints {
  name?: string;
  linkedin?: string;
  twitter?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}

export interface PrefillProfileResult {
  name: string | null;
  intro: string | null;
  location: string | null;
  socials: { label: string; value: string }[];
  avatarUrl: string | null;
}

function socialsToRequest(socials: Array<{ label: string; value: string }>) {
  const out: { linkedin?: string; twitter?: string; github?: string; telegram?: string; websites?: string[] } = {};
  for (const s of socials) {
    const label = s.label.toLowerCase();
    if (label === 'linkedin') out.linkedin = s.value;
    else if (label === 'twitter') out.twitter = s.value;
    else if (label === 'github') out.github = s.value;
    else if (label === 'telegram') out.telegram = s.value;
    else out.websites = [...(out.websites ?? []), s.value];
  }
  return out;
}

function buildProfileInputFromUser(
  user: { name?: string | null; intro?: string | null; location?: string | null },
  socials: Array<{ label: string; value: string }>,
): string {
  const lines: string[] = [];
  if (user.name?.trim()) lines.push(`Name: ${user.name.trim()}`);
  if (user.location?.trim()) lines.push(`Location: ${user.location.trim()}`);
  if (user.intro?.trim()) lines.push(user.intro.trim());
  if (socials.length) lines.push(`User-provided public links:\n${socials.map((s) => `${s.label}: ${s.value}`).join('\n')}`);
  return lines.filter((l) => l.trim()).join('\n\n');
}

function isMeaningfulResearch(enrichment: ParallelEnrichmentResult | null): enrichment is ParallelEnrichmentResult {
  return !!enrichment && enrichment.confidentMatch && enrichment.isHuman &&
    (enrichment.identity.bio.trim().length > 0 || enrichment.narrative.context.trim().length > 0 ||
     enrichment.attributes.skills.length > 0 || enrichment.attributes.interests.length > 0);
}

function mapEnrichmentToPrefill(
  enrichment: ParallelEnrichmentResult,
  fallbackName: string | null,
): PrefillProfileResult {
  const socials: { label: string; value: string }[] = [];
  if (enrichment.socials.twitter) socials.push({ label: 'twitter', value: enrichment.socials.twitter });
  if (enrichment.socials.linkedin) socials.push({ label: 'linkedin', value: enrichment.socials.linkedin });
  if (enrichment.socials.github) socials.push({ label: 'github', value: enrichment.socials.github });
  if (enrichment.socials.websites?.length) {
    for (const w of enrichment.socials.websites) socials.push({ label: 'custom', value: w });
  }

  return {
    name: enrichment.identity.name?.trim() || fallbackName,
    intro: enrichment.identity.bio?.trim() || null,
    location: enrichment.identity.location?.trim() || null,
    socials,
    avatarUrl: null,
  };
}

export class EnrichmentService {
  private db = new EnrichmentDatabaseAdapter();

  /** Public lookup prefill — does not persist. */
  async prefillPublicProfile(userId: string, hints: ResearchHints = {}): Promise<{ enriched: boolean; profile: PrefillProfileResult | null }> {
    logger.verbose('Public profile prefill requested', { userId });
    const user = await this.db.getUser(userId);
    if (!user) throw new Error(`User not found: ${userId}`);

    const accountSocials = await this.db.getUserSocials(userId);
    const accountReq = socialsToRequest(accountSocials);

    const enrichment = await enrichUserProfile({
      name: hints.name?.trim() || user.name || undefined,
      email: user.email || undefined,
      linkedin: hints.linkedin?.trim() || accountReq.linkedin,
      twitter: hints.twitter?.trim() || accountReq.twitter,
      github: hints.github?.trim() || accountReq.github,
      telegram: hints.telegram?.trim() || accountReq.telegram,
      websites: hints.websites?.length ? hints.websites : accountReq.websites?.length ? accountReq.websites : undefined,
    });

    if (!isMeaningfulResearch(enrichment)) {
      return { enriched: false, profile: null };
    }

    return {
      enriched: true,
      profile: mapEnrichmentToPrefill(enrichment, user.name ?? null),
    };
  }

  async createPremisesFromProfile(userId: string): Promise<void> {
    await runCreatePremisesFromProfile(userId);
  }
}

export const enrichmentService = new EnrichmentService();
