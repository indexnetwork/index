/**
 * The enrichment tool registry.
 *
 * The user-context read and write tools live in sibling modules and the shared
 * helpers in `enrichment.tools.helpers.ts`; this file owns the enrichment-run
 * and onboarding tools and assembles the registry.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ResolvedToolContext } from "../shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../contexts/context.tools.port.js";
import { success, error, needsClarification, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { EnrichmentResult } from "../shared/interfaces/enrichment.interface.js";
import type { OnboardingProfileSeed, OnboardingState, UserRecord } from "../shared/interfaces/database.interface.js";
import type { EnrichmentRunInput, EnrichmentRunOperation } from "../shared/interfaces/enrichment-run.interface.js";
import { socialsToEnrichmentRequest, detectSocialLabel } from "../shared/utils/social-label.js";
import { normalizeTelegramHandle } from "../shared/utils/telegram-handle.js";
import { EnrichmentGenerator } from "./enrichment.generator.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";
import type { ToolSurface } from "../shared/agent/utility.tools.js";

import { approvedProfileDraftSchema, buildApprovedDraftProfileInput, buildProfileInput, decomposeApprovedDraftProfile, enqueueEnrichmentRun, enrichFromUserRecord, isMeaningfulEnrichment, isPlaceholderName, logger, markApprovedProfileConfirmed, mergeUserSocials, normalizeSocialUpdate, persistApprovedProfileContext, selectProfileSeed, socialsRecordToRows, toProfileSummary, trimToUndefined } from "./enrichment.tools.helpers.js";
import { createUserContextReadTools } from "./enrichment.tools.context-read.js";
import { createUserContextWriteTools } from "./enrichment.tools.context-write.js";

export function createEnrichmentTools(
  defineTool: DefineTool,
  deps: EnrichmentToolDeps,
  options: { surface?: ToolSurface } = {},
) {
  const { userDb, systemDb, graphs, enricher, grantDefaultSystemPermissions, reportToolError, getUserContextText } = deps;
  const isMcpSurface = options.surface === "mcp";

  const { readUserContexts, previewUserContext, confirmUserContext } = createUserContextReadTools(defineTool, deps);
  const { createUserContext, updateUserContext } = createUserContextWriteTools(defineTool, deps);

  const getEnrichmentRun = defineTool({
    name: "get_enrichment_run",
    description:
      "Checks the status of an async profile preview/update run started by preview_user_context or update_user_context in MCP contexts. " +
      "Poll this tool with the profileRunId until status is succeeded, failed, or cancelled. When succeeded, present the result to the user.",
    querySchema: z.object({
      profileRunId: z.string().describe("Profile run ID returned by preview_user_context or update_user_context."),
    }),
    handler: async ({ context, query }) => {
      if (!deps.enrichmentRuns) {
        return error("Profile run polling is not available in this environment.");
      }
      const run = await deps.enrichmentRuns.get(query.profileRunId, context.userId);
      if (!run) return error("Profile run not found.");
      return success({
        profileRunId: run.id,
        operation: run.operation,
        status: run.status,
        progress: run.progress ?? null,
        result: run.result ?? null,
        error: run.error ?? null,
        createdAt: run.createdAt.toISOString?.() ?? null,
        startedAt: run.startedAt?.toISOString?.() ?? null,
        completedAt: run.completedAt?.toISOString?.() ?? null,
      });
    },
  });

  const cancelEnrichmentRun = defineTool({
    name: "cancel_enrichment_run",
    description:
      "Requests cancellation for an async profile run. If the queued job has not started, it is removed and marked cancelled. " +
      "If already running, the worker observes the cancellation request and aborts where supported.",
    querySchema: z.object({
      profileRunId: z.string().describe("Profile run ID returned by preview_user_context or update_user_context."),
    }),
    handler: async ({ context, query }) => {
      if (!deps.enrichmentRuns || !deps.enrichmentRunQueue) {
        return error("Profile run cancellation is not available in this environment.");
      }
      const existing = await deps.enrichmentRuns.get(query.profileRunId, context.userId);
      if (!existing) return error("Profile run not found.");
      if (!["queued", "running"].includes(existing.status)) {
        return success({
          profileRunId: existing.id,
          status: existing.status,
          message: `Profile run is already ${existing.status}.`,
        });
      }
      const run = await deps.enrichmentRuns.requestCancel(query.profileRunId, context.userId);
      if (!run) return error("Profile run not found or cannot be cancelled.");
      const removed = await deps.enrichmentRunQueue.cancel(run.id);
      if (removed) {
        await deps.enrichmentRuns.markCancelled(run.id, "cancelled before worker start");
      }
      const updated = await deps.enrichmentRuns.get(run.id, context.userId);
      return success({
        profileRunId: run.id,
        status: updated?.status ?? run.status,
        cancelled: true,
        message: removed
          ? "Profile run cancelled before it started."
          : "Cancellation requested while the profile run is running or queued.",
      });
    },
  });

  const completeOnboarding = isMcpSurface ? null : defineTool({
    name: "complete_onboarding",
    description:
      "Marks the user's onboarding as complete after validating the durable approved-profile marker and a persisted active first signal created at or after that approval. " +
      "Web onboarding should pass the exact intentId returned by /intents/confirm; legacy clients may omit it and use any eligible active intent. " +
      "This records firstSignalIntentId/currentStep and is idempotent.",
    querySchema: z.object({
      intentId: z.string().min(1).optional().describe("Exact first-signal ID returned by the confirmation endpoint."),
    }).strict(),
    handler: async ({ context, query }) => {
      const currentUser = await userDb.getUser();
      const currentOnboarding = currentUser?.onboarding ?? context.user.onboarding ?? {};
      if (currentOnboarding.completedAt) {
        logger.verbose("Onboarding already completed, skipping", { userId: context.userId });
        return success({
          message: "Onboarding already completed.",
          completedAt: currentOnboarding.completedAt,
          ...(currentOnboarding.firstSignalIntentId
            ? { intentId: currentOnboarding.firstSignalIntentId }
            : {}),
        });
      }

      if (!currentOnboarding.profileConfirmedAt) {
        return error("Onboarding cannot be completed until the user has a confirmed profile. Show the profile draft, get explicit approval, then save it before finishing onboarding.");
      }
      const profileConfirmedAtMs = Date.parse(currentOnboarding.profileConfirmedAt);
      if (!Number.isFinite(profileConfirmedAtMs)) {
        return error("Onboarding cannot be completed because the durable profile confirmation timestamp is invalid. Confirm the approved profile again before finishing onboarding.");
      }

      const activeIntents = await userDb.getActiveIntents();
      const isEligibleFirstSignal = (intent: (typeof activeIntents)[number]) => {
        const createdAtMs = intent.createdAt.getTime();
        return Number.isFinite(createdAtMs) && createdAtMs >= profileConfirmedAtMs;
      };
      const firstSignal = query.intentId
        ? activeIntents.find((intent) => intent.id === query.intentId)
        : activeIntents.find(isEligibleFirstSignal);
      if (!firstSignal) {
        return error(query.intentId
          ? "Onboarding cannot be completed because the confirmed first signal is not active for this user."
          : "Onboarding cannot be completed until the user has at least one active intent created after profile confirmation. Ask what they are open to right now and create the first signal before finishing onboarding.");
      }
      if (!isEligibleFirstSignal(firstSignal)) {
        return error("Onboarding cannot be completed because the selected first signal was created before profile confirmation. Create and confirm a new signal before finishing onboarding.");
      }

      const completedAt = new Date().toISOString();
      await userDb.updateUser({
        onboarding: {
          ...currentOnboarding,
          firstSignalIntentId: firstSignal.id,
          currentStep: 'complete',
          completedAt,
        },
      });

      if (grantDefaultSystemPermissions) {
        try {
          await grantDefaultSystemPermissions(context.userId);
        } catch (err) {
          logger.warn('Default system agent permission grant failed (non-fatal)', {
            userId: context.userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("Onboarding completed", { userId: context.userId, intentId: firstSignal.id });
      return success({ message: "Onboarding complete.", intentId: firstSignal.id, completedAt });
    },
  });

  return [readUserContexts, previewUserContext, confirmUserContext, createUserContext, updateUserContext, getEnrichmentRun, cancelEnrichmentRun, completeOnboarding] as const;
}
