/**
 * MCP enrichment tools — public profile prefill only.
 */

import { z } from "zod";

import type { DefineTool } from "../shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../contexts/context.tools.port.js";
import { success, error } from "../shared/agent/tool.helpers.js";
import { socialsToEnrichmentRequest } from "../shared/utils/social-label.js";

export function createEnrichmentTools(
  defineTool: DefineTool,
  deps: EnrichmentToolDeps,
) {
  if (!deps.enricher) return [] as const;

  const researchProfile = defineTool({
    name: "research_profile",
    description:
      "Runs public profile research (Parallel lookup) for the authenticated user. " +
      "Returns a suggested profile for review — does not persist. " +
      "Optional hints override account defaults for the lookup.",
    querySchema: z.object({
      name: z.string().optional(),
      linkedin: z.string().optional(),
      github: z.string().optional(),
      twitter: z.string().optional(),
      telegram: z.string().optional(),
      websites: z.array(z.string()).optional(),
    }).strict(),
    handler: async ({ context, query }) => {
      const user = await deps.userDb.getUser();
      if (!user) return error("User not found.");

      const socials = await deps.userDb.getUserSocials();
      const accountSocials = socialsToEnrichmentRequest(socials);

      const enrichment = await deps.enricher!.enrichUserProfile({
        name: query.name?.trim() || user.name || undefined,
        email: user.email || undefined,
        linkedin: query.linkedin?.trim() || accountSocials.linkedin || undefined,
        twitter: query.twitter?.trim() || accountSocials.twitter || undefined,
        github: query.github?.trim() || accountSocials.github || undefined,
        telegram: query.telegram?.trim() || accountSocials.telegram || undefined,
        websites: query.websites?.length
          ? query.websites
          : accountSocials.websites?.length
            ? accountSocials.websites
            : undefined,
      });

      if (!enrichment || !enrichment.confidentMatch || !enrichment.isHuman) {
        return success({ enriched: false, profile: null });
      }

      const outSocials: { label: string; value: string }[] = [];
      if (enrichment.socials.twitter) outSocials.push({ label: 'twitter', value: enrichment.socials.twitter });
      if (enrichment.socials.linkedin) outSocials.push({ label: 'linkedin', value: enrichment.socials.linkedin });
      if (enrichment.socials.github) outSocials.push({ label: 'github', value: enrichment.socials.github });
      if (enrichment.socials.telegram) outSocials.push({ label: 'telegram', value: enrichment.socials.telegram });
      if (enrichment.socials.websites?.length) {
        for (const w of enrichment.socials.websites) outSocials.push({ label: 'custom', value: w });
      }

      return success({
        enriched: true,
        profile: {
          name: enrichment.identity.name?.trim() || user.name || null,
          intro: enrichment.identity.bio?.trim() || null,
          location: enrichment.identity.location?.trim() || null,
          socials: outSocials,
          avatarUrl: null,
        },
      });
    },
  });

  return [researchProfile] as const;
}
