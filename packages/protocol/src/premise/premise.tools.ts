import { z } from "zod";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { PremiseRecord, PremiseValidity } from "../shared/interfaces/database.interface.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("ChatTools:Premise");
const createPremiseLog = protocolLogger("ChatTools:Premise:createPremise");
const readPremisesLog = protocolLogger("ChatTools:Premise:readPremises");
const updatePremiseLog = protocolLogger("ChatTools:Premise:updatePremise");
const retractPremiseLog = protocolLogger("ChatTools:Premise:retractPremise");

export function createPremiseTools(defineTool: DefineTool, deps: ToolDeps) {
  const database = deps.database;
  const premiseGraph = deps.graphs.premise;

  // ─────────────────────────────────────────────────────────────────────────────
  // PREMISE CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  const createPremise = defineTool({
    name: "create_premise",
    description:
      "Creates a premise — a self-descriptive proposition the user asserts about themselves. " +
      "Premises are the foundational facts that shape how the system understands who you are " +
      "and what contexts you inhabit.\n\n" +
      "**Tiers:**\n" +
      "- `assertive` (default): stable identity facts (e.g. 'I am a software engineer', 'I live in Berlin'). " +
      "Use for things that are durably true and not time-bound.\n" +
      "- `contextual`: temporal or situational facts (e.g. 'I am attending DevCon this week', " +
      "'I am fundraising for my Series A right now'). Use when the user shares something time-bound " +
      "or context-specific. These default to `volatile: true`.\n\n" +
      "**When to use:** Call this whenever the user shares a fact about themselves in first person " +
      "('I am', 'I work at', 'I just joined', 'I am currently'). Do not infer premises from vague " +
      "statements — only create them when the user is clearly asserting something about themselves.",
    querySchema: z.object({
      text: z.string().trim().min(1).describe("The premise text — a self-descriptive proposition in first person, e.g. 'I am a machine learning researcher at MIT'."),
      tier: z.enum(["assertive", "contextual"]).default("assertive").describe("Tier of the premise. 'assertive' = stable identity fact. 'contextual' = temporal/situational. Defaults to 'assertive'."),
      validFrom: z.string().datetime().optional().describe("ISO 8601 date-time string for when this premise becomes valid. Omit for immediate."),
      validUntil: z.string().datetime().optional().describe("ISO 8601 date-time string for when this premise expires. Recommended for contextual premises with a known end date; omit if open-ended."),
      volatile: z.boolean().optional().describe("Whether this premise should be automatically retracted when it expires. Defaults to true for contextual tier, false for assertive."),
    }),
    handler: async ({ context, query }) => {
      if (!premiseGraph) {
        return error("Premise graph not available.");
      }

      const effectiveVolatile = query.volatile ?? (query.tier === "contextual" ? true : false);
      const scopeEnvelope = context.scopeType && context.scopeId
        ? { scopeType: context.scopeType, scopeId: context.scopeId }
        : {};

      createPremiseLog.verbose('Creating premise for user', { userId: context.userId, preview: query.text.substring(0, 60) });

      const result = await invokeWithAbortSignal(premiseGraph, {
        userId: context.userId,
        assertionText: query.text,
        tier: query.tier,
        validFrom: query.validFrom,
        validUntil: query.validUntil,
        volatile: effectiveVolatile,
        operationMode: "create",
        ...scopeEnvelope,
      });

      if (result.error) {
        return error(result.error);
      }

      if (!result.premise) {
        return error("Premise creation failed — no premise returned.");
      }

      const premise = result.premise;
      const indexesAssigned = result.networkAssignments?.length ?? 0;
      const analysisSummary = premise.analysis
        ? `speechActType: ${premise.analysis.speechActType}, clarity: ${premise.analysis.felicityClarity?.toFixed(2) ?? "n/a"}`
        : "no analysis";

      const createResult = success({
        id: premise.id,
        assertion: premise.assertion.text,
        tier: premise.assertion.tier,
        analysisSummary,
        indexesAssigned,
        message: `Premise created and assigned to ${indexesAssigned} index${indexesAssigned === 1 ? "" : "es"}.`,
      });
      return createResult;
    },
  });

  const readPremises = defineTool({
    name: "read_premises",
    description:
      "Retrieves premises — the self-descriptive propositions a user has asserted about themselves. " +
      "Premises represent stable identity facts (assertive) and temporal context (contextual).\n\n" +
      "**Usage modes:**\n" +
      "- No parameters: returns the caller's own active premises.\n" +
      "- With `userId`: returns that user's premises (use when reviewing another member's context).\n" +
      "- With `includeRetracted: true`: returns all premises regardless of status (active, retracted, expired) for history review.\n\n" +
      "**When to use:** Call before creating a premise to check if it already exists. " +
      "Call when the user asks what they have shared about themselves, or to review their current context. " +
      "Each premise includes: id, text, tier, status, analysis summary, and validity range.",
    querySchema: z.object({
      userId: z.string().optional().describe("User ID to fetch premises for. Omit to fetch the current user's own premises."),
      includeRetracted: z.boolean().default(false).describe("When true, returns all premises regardless of status (active, retracted, expired). Defaults to false (active only)."),
    }),
    handler: async ({ context, query }) => {
      const targetUserId = query.userId?.trim() || context.userId;

      if (query.userId?.trim() && !UUID_REGEX.test(query.userId.trim())) {
        return error("Invalid userId format.");
      }

      readPremisesLog.verbose('Fetching premises for user', { userId: targetUserId });

      // Query DB directly (bypassing graph) to support status filtering.
      // The graph's query node hardcodes ACTIVE status, so includeRetracted
      // would be dead code if we routed through it.
      const statusFilter = query.includeRetracted ? undefined : "ACTIVE" as const;
      const premises = await database.getPremisesForUser(targetUserId, statusFilter);

      const mapped = premises.map((p: PremiseRecord) => ({
        id: p.id,
        text: p.assertion.text,
        tier: p.assertion.tier,
        status: p.status,
        analysisSummary: p.analysis
          ? `speechActType: ${p.analysis.speechActType ?? "n/a"}, clarity: ${p.analysis.felicityClarity?.toFixed(2) ?? "n/a"}`
          : "no analysis",
        validFrom: p.validity.validFrom ?? null,
        validUntil: p.validity.validUntil ?? null,
        volatile: p.validity.volatile ?? false,
      }));

      return success({
        premises: mapped,
        count: mapped.length,
      });
    },
  });

  const updatePremise = defineTool({
    name: "update_premise",
    description:
      "Modifies an existing premise. Updating the text triggers re-analysis and re-embedding, " +
      "which may change how it influences opportunity discovery. " +
      "Use when the user corrects or refines something they previously stated about themselves, " +
      "or when validity dates need adjustment.\n\n" +
      "**When to use:** When the user says 'actually, I meant...', 'update my premise about...', " +
      "or provides a corrected version of a previously stated fact. " +
      "Requires the premise ID — call read_premises first if you don't have it.",
    querySchema: z.object({
      premiseId: z.string().describe("UUID of the premise to update. Get from read_premises."),
      text: z.string().trim().min(1).optional().describe("New assertion text. Triggers re-analysis and re-embedding when provided."),
      validFrom: z.string().datetime().optional().describe("New ISO 8601 valid-from date-time."),
      validUntil: z.string().datetime().optional().describe("New ISO 8601 valid-until date-time."),
      volatile: z.boolean().optional().describe("Update the volatile flag."),
    }),
    handler: async ({ context, query }) => {
      if (!UUID_REGEX.test(query.premiseId)) {
        return error("Invalid premiseId format.");
      }

      const existing = await database.getPremise(query.premiseId);
      if (!existing) {
        return error("Premise not found.");
      }
      if (existing.userId !== context.userId) {
        return error("You can only update your own premises.");
      }
      if (existing.status === "RETRACTED") {
        return error("Cannot update a retracted premise. Retracted premises are immutable.");
      }

      updatePremiseLog.verbose('Updating premise for user', { premiseId: query.premiseId, userId: context.userId });

      // When text is unchanged, skip the graph (avoids unnecessary LLM
      // re-analysis and non-deterministic re-embedding). Only route through
      // the graph when the assertion text actually changes.
      if (query.text === undefined) {
        const hasValidityChange =
          query.validFrom !== undefined ||
          query.validUntil !== undefined ||
          query.volatile !== undefined;

        if (!hasValidityChange) {
          return error("No fields to update. Provide text, validFrom, validUntil, or volatile.");
        }

        const mergedValidity: PremiseValidity = {
          ...existing.validity,
          ...(query.validFrom !== undefined && { validFrom: query.validFrom }),
          ...(query.validUntil !== undefined && { validUntil: query.validUntil }),
          ...(query.volatile !== undefined && { volatile: query.volatile }),
        };

        const updated = await database.updatePremise(query.premiseId, { validity: mergedValidity });

        const metadataResult = success({
          id: updated.id,
          assertion: updated.assertion.text,
          tier: updated.assertion.tier,
          status: updated.status,
          message: "Premise updated successfully (metadata only, no re-analysis).",
        });
        return metadataResult;
      }

      // Text change requires the graph for re-analysis and re-embedding
      if (!premiseGraph) {
        return error("Premise graph not available.");
      }

      const result = await invokeWithAbortSignal(premiseGraph, {
        userId: context.userId,
        assertionText: query.text,
        tier: existing.assertion.tier,
        validFrom: query.validFrom ?? existing.validity.validFrom ?? undefined,
        validUntil: query.validUntil ?? existing.validity.validUntil ?? undefined,
        volatile: query.volatile ?? existing.validity.volatile,
        operationMode: "update",
        targetPremiseId: query.premiseId,
        ...(context.scopeType && context.scopeId ? { scopeType: context.scopeType, scopeId: context.scopeId } : {}),
      });

      if (result.error) {
        return error(result.error);
      }

      if (!result.premise) {
        return error("Premise update failed — no updated premise returned.");
      }

      const updated = result.premise;

      const updateResult = success({
        id: updated.id,
        assertion: updated.assertion.text,
        tier: updated.assertion.tier,
        status: updated.status,
        message: "Premise updated successfully.",
      });
      return updateResult;
    },
  });

  const retractPremise = defineTool({
    name: "retract_premise",
    description:
      "Retracts a premise — a soft delete that preserves the history of what was asserted. " +
      "Retracted premises are no longer active but remain in the audit trail. " +
      "Use when the user explicitly wants to remove something they previously stated about themselves, " +
      "or when a contextual premise is no longer true.\n\n" +
      "**When to use:** When the user says 'remove my premise about...', 'I no longer...', " +
      "or 'that's not true anymore'. Do not retract premises proactively — only on explicit user instruction.",
    querySchema: z.object({
      premiseId: z.string().describe("UUID of the premise to retract. Get from read_premises."),
    }),
    handler: async ({ context, query }) => {
      if (!UUID_REGEX.test(query.premiseId)) {
        return error("Invalid premiseId format.");
      }

      const existing = await database.getPremise(query.premiseId);
      if (!existing) {
        return error("Premise not found.");
      }
      if (existing.userId !== context.userId) {
        return error("You can only retract your own premises.");
      }
      if (existing.status === "RETRACTED") {
        return error("Premise is already retracted.");
      }

      retractPremiseLog.verbose('Retracting premise for user', { premiseId: query.premiseId, userId: context.userId });

      await database.updatePremise(query.premiseId, {
        status: "RETRACTED",
        retractedAt: new Date(),
      });

      const retractResult = success({
        id: query.premiseId,
        message: "Premise retracted successfully.",
      });
      return retractResult;
    },
  });

  return [createPremise, readPremises, updatePremise, retractPremise];
}
