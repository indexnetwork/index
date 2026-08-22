/**
 * Helpers shared by the enrichment tools.
 *
 * These were nested functions inside `createEnrichmentTools`, closing over the
 * destructured host capabilities. They are top-level now, each taking the tool
 * deps explicitly, so the three tool modules can share them.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ResolvedToolContext } from "../shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../contexts/context.tools.port.js";
import { success, error, needsClarification, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { EnrichmentResult } from "../../platform/enrichment.js";
import type { OnboardingProfileSeed, OnboardingState, UserRecord } from "../../platform/database.js";
import type { EnrichmentRunInput, EnrichmentRunOperation } from "../../platform/enrichment-run.js";
import { socialsToEnrichmentRequest, detectSocialLabel } from "../shared/utils/social-label.js";
import { normalizeTelegramHandle } from "../shared/utils/telegram-handle.js";
import { EnrichmentGenerator } from "./enrichment.generator.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";

export const logger = protocolLogger("ChatTools:Enrichment");

export function isMeaningfulEnrichment(enrichment: EnrichmentResult | null): enrichment is EnrichmentResult {
  return !!enrichment &&
    enrichment.confidentMatch &&
    (
      enrichment.identity.bio.trim().length > 0 ||
      enrichment.narrative.context.trim().length > 0 ||
      enrichment.attributes.skills.length > 0 ||
      enrichment.attributes.interests.length > 0
    );
}

export const approvedProfileDraftSchema = z.object({
  identity: z.object({ name: z.string(), bio: z.string(), location: z.string() }),
  narrative: z.object({ context: z.string() }),
  attributes: z.object({ interests: z.array(z.string()), skills: z.array(z.string()) }),
});

type ApprovedProfileDraft = z.infer<typeof approvedProfileDraftSchema>;


export function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function isPlaceholderName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'unknown' || normalized === 'user';
}

export async function enrichFromUserRecord(deps: EnrichmentToolDeps, user: { name?: string | null; email?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }> }) {
  const enrichmentSocials = socialsToEnrichmentRequest(user.socials);
  return deps.enricher.enrichUserProfile({
    name: trimToUndefined(user.name),
    email: trimToUndefined(user.email),
    linkedin: enrichmentSocials.linkedin || undefined,
    twitter: enrichmentSocials.twitter || undefined,
    github: enrichmentSocials.github || undefined,
    telegram: enrichmentSocials.telegram || undefined,
    websites: enrichmentSocials.websites?.length ? enrichmentSocials.websites : undefined,
  });
}

export function selectProfileSeed(onboarding: OnboardingState | null | undefined, networkId?: string): OnboardingProfileSeed | undefined {
  const seeds = onboarding?.profileSeeds ?? [];
  if (seeds.length === 0) return undefined;
  const scoped = networkId ? seeds.filter((seed) => seed.networkId === networkId) : seeds;
  return scoped[scoped.length - 1];
}

export function normalizeSocialUpdate(label: string, value: string): { label: string; value: string } | null {
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedLabel) return null;
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;
  if (normalizedLabel === 'telegram') {
    const handle = normalizeTelegramHandle(trimmedValue);
    return handle ? { label: normalizedLabel, value: handle } : null;
  }
  return { label: normalizedLabel, value: trimmedValue };
}

export async function mergeUserSocials(deps: EnrichmentToolDeps, incoming: { label: string; value: string }[]): Promise<void> {
  const normalizedIncoming = incoming
    .map((social) => normalizeSocialUpdate(social.label, social.value))
    .filter((social): social is { label: string; value: string } => social !== null);
  if (normalizedIncoming.length === 0) return;

  const existingSocials = await deps.userDb.getUserSocials();
  const incomingLabels = new Set(normalizedIncoming.map((social) => social.label));
  const kept = existingSocials
    .filter((social) => !incomingLabels.has(social.label) || social.label === 'custom')
    .map((social) => ({ label: social.label, value: social.value }));
  const merged = incomingLabels.has('custom')
    ? [...kept.filter((social) => social.label !== 'custom'), ...normalizedIncoming]
    : [...kept, ...normalizedIncoming];
  await deps.userDb.setUserSocials(merged);
}

export function socialsRecordToRows(socials: Record<string, string> | undefined): { label: string; value: string }[] {
  if (!socials) return [];
  return Object.entries(socials).map(([label, value]) => ({ label, value }));
}

export async function enqueueEnrichmentRun(
  deps: EnrichmentToolDeps,
  context: ResolvedToolContext,
  operation: EnrichmentRunOperation,
  input: EnrichmentRunInput,
): Promise<string | null> {
  if (!context.isMcp || !deps.enrichmentRuns || !deps.enrichmentRunQueue) return null;
  const run = await deps.enrichmentRuns.create({
    userId: context.userId,
    agentId: context.agentId ?? null,
    operation,
    input,
    context: {
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail,
      ...(focusedNetworkId(context) ? { scopeType: 'network' as const, scopeId: focusedNetworkId(context)! } : {}),
      ...(context.indexName ? { indexName: context.indexName } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.agentId ? { agentId: context.agentId } : {}),
    },
  });
  try {
    await deps.enrichmentRunQueue.enqueue(run.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.enrichmentRuns.markFailed(run.id, message);
    if (err instanceof Error) throw err;
    const wrapped = new Error(`Failed to enqueue profile run: ${message}`) as Error & { cause?: unknown };
    wrapped.cause = err;
    throw wrapped;
  }
  return run.id;
}

export async function persistApprovedProfileContext(deps: EnrichmentToolDeps, profile: { identity: { name: string; bio: string; location: string } }, user: UserRecord | null, networkId?: string): Promise<void> {
  await deps.userDb.updateUser({
    name: profile.identity.name,
    intro: profile.identity.bio,
    location: profile.identity.location,
  });

  const onboarding = user?.onboarding ?? undefined;
  const seed = selectProfileSeed(onboarding, networkId);
  if (!seed?.socials?.length) return;

  await mergeUserSocials(deps, seed.socials);
}

export async function markApprovedProfileConfirmed(deps: EnrichmentToolDeps, context: ResolvedToolContext): Promise<void> {
  const latestUser = await deps.userDb.getUser();
  const currentOnboarding = latestUser?.onboarding ?? context.user.onboarding ?? {};
  await deps.userDb.updateUser({
    onboarding: {
      ...currentOnboarding,
      profileConfirmedAt: currentOnboarding.profileConfirmedAt ?? new Date().toISOString(),
      currentStep: currentOnboarding.completedAt
        ? currentOnboarding.currentStep ?? 'complete'
        : 'first_signal',
    },
  });
}

export function buildProfileInput(parts: {
  name?: string;
  location?: string;
  bioOrDescription?: string;
  socials?: Array<{ label: string; value: string }>;
}): string {
  const lines: string[] = [];
  if (parts.name) lines.push(`Name: ${parts.name}`);
  if (parts.location) lines.push(`Location: ${parts.location}`);
  if (parts.bioOrDescription) lines.push(parts.bioOrDescription);
  if (parts.socials?.length) {
    lines.push(`User-provided public links:\n${parts.socials.map((s) => `${s.label}: ${s.value}`).join('\n')}`);
  }
  return lines.filter((line) => line.trim().length > 0).join('\n\n');
}

export function toProfileSummary(profile: { identity: { name: string; bio: string; location: string }; attributes: { skills: string[]; interests: string[] } }) {
  return {
    name: profile.identity.name,
    bio: profile.identity.bio,
    location: profile.identity.location,
    skills: profile.attributes.skills,
    interests: profile.attributes.interests,
  };
}

export function buildApprovedDraftProfileInput(draft: ApprovedProfileDraft): string {
  return [
    draft.identity.name ? `My name is ${draft.identity.name}.` : '',
    draft.identity.location ? `I am based in ${draft.identity.location}.` : '',
    draft.identity.bio || '',
    draft.narrative.context || '',
    draft.attributes.skills.length ? `My skills include ${draft.attributes.skills.join(', ')}.` : '',
    draft.attributes.interests.length ? `My interests include ${draft.attributes.interests.join(', ')}.` : '',
  ].filter((part) => part.trim().length > 0).join('\n');
}

export async function decomposeApprovedDraftProfile(
  deps: EnrichmentToolDeps,
  profile: ApprovedProfileDraft & { userId: string },
): Promise<void> {
  const input = buildApprovedDraftProfileInput(profile);
  if (!input.trim()) return;

  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const graphStart = Date.now();
  traceEmitter?.({ type: "graph_start", name: "enrichment" });
  try {
    const graphInput = {
      userId: profile.userId,
      operationMode: 'write' as const,
      input,
      forceUpdate: true,
    };
    // Always invoked as a background fire-and-forget task (see confirm_user_context
    // call sites), so decomposition must outlive the originating request — invoke
    // the graph directly and never bind the request abort signal, which would
    // cancel it as soon as the web request completes.
    const result = await deps.graphs.profile.invoke(graphInput);

    if (result.error) {
      const err = new Error(result.error);
      logger.error('Approved draft premise decomposition failed', {
        userId: profile.userId,
        error: result.error,
      });
      deps.reportToolError?.(err, {
        subsystem: 'enrichment',
        operation: 'profile.confirm_draft_decompose',
        toolName: 'confirm_user_context',
        userId: profile.userId,
        tags: { toolName: 'confirm_user_context', execution: 'background' },
      });
      return;
    }

    // The write graph's decompose → aggregate → generate → save_profile
    // pipeline persists the aggregate profile. The approved draft was already
    // saved before decomposition started, so the DB is consistent regardless
    // of graph outcome.  Do not re-save here — the graph's save_profile is
    // authoritative, and a concurrent user-driven profile update could race.
  } catch (err) {
    logger.error('Approved draft premise decomposition failed', {
      userId: profile.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    deps.reportToolError?.(err, {
      subsystem: 'enrichment',
      operation: 'profile.confirm_draft_decompose',
      toolName: 'confirm_user_context',
      userId: profile.userId,
      tags: { toolName: 'confirm_user_context', execution: 'background' },
    });
  } finally {
    traceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: Date.now() - graphStart });
  }
}
