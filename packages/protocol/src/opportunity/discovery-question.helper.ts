/**
 * Pure mapper from opportunity-graph outputs + optional chat digest to a
 * `DiscoveryQuestionInput`. No I/O. Side-effect-free.
 */

import type { ChatContextDigest } from "../shared/schemas/chat-context.schema.js";
import type { DiscoveryNegotiationDigest } from "../shared/schemas/negotiation-digest.schema.js";
import type { SourceProfileData } from "./opportunity.state.js";
import type { DiscoveryQuestionInput, DiscoverySourceProfile, DiscoverySummary } from "./question.prompt.js";

export interface BuildDiscoveryQuestionInputArgs {
  query: string;
  sourceProfile: SourceProfileData | null;
  negotiationDigests: DiscoveryNegotiationDigest[];
  summary: DiscoverySummary;
  chatContext?: ChatContextDigest;
  now: string;
}

/** @deprecated Use QuestionerAgent discovery preset instead. Will be removed in a future version. */
export function buildDiscoveryQuestionInput(args: BuildDiscoveryQuestionInputArgs): DiscoveryQuestionInput {
  return {
    query: args.query,
    sourceProfile: extractSourceProfile(args.sourceProfile),
    negotiationDigests: args.negotiationDigests,
    summary: args.summary,
    ...(args.chatContext !== undefined ? { chatContext: args.chatContext } : {}),
    now: args.now,
  };
}

function extractSourceProfile(profile: SourceProfileData | null): DiscoverySourceProfile {
  if (!profile) return {};
  const out: DiscoverySourceProfile = {};
  if (profile.identity?.name) out.name = profile.identity.name;
  if (profile.identity?.bio) out.bio = profile.identity.bio;
  if (profile.identity?.location) out.location = profile.identity.location;
  if (profile.attributes?.skills?.length) out.skills = profile.attributes.skills;
  if (profile.attributes?.interests?.length) out.interests = profile.attributes.interests;
  return out;
}
