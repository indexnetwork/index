/**
 * The opportunity tool registry: list, update, and delivery confirmation.
 *
 * `list_opportunities` lives in `opportunity.tools.list.ts` and the shared card
 * and link helpers in `opportunity.tools.cards.ts`; this file wires the three
 * tools together and owns the two mutation tools.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";


import type { DefineTool } from "../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "./opportunity.tools.port.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { OpportunityPresenter, gatherPresenterContext, getSafePresentationOrSkip, narratorRemarkFromReasoning, safeFallbackSummary, stripUuids, type PresenterDatabase } from "./opportunity.presentation.js";
import { buildOpportunityPresentation } from "./opportunity.presentation.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { admitOpportunityUpdate } from "./opportunity.update-admission.js";
import { opportunityOwnerActionForStatus, type OpportunityOwnerAction, type OpportunityOwnerApprovalVerdict } from "./opportunity.owner-approval.js";
import { ownerApprovalProvenanceFor } from "./opportunity.owner-provenance.js";
import { selectOpportunityFeed } from "./opportunity.feed-selection.js";

export { buildOpportunityPresentation } from "./opportunity.presentation.js";

import { updateOpportunityStatus } from "./opportunity.graph.modes.js";
import { createListOpportunitiesTool } from "./opportunity.tools.list.js";
import { confirmDeliveryError, logger, ownerApprovalDenial } from "./opportunity.tools.cards.js";

export { attachOpportunityAppLink, attachProfileLink, buildMinimalOpportunityCard, buildNegotiationUrl, buildOpportunityAppUrl, buildProfileUrl } from "./opportunity.tools.cards.js";

export function createOpportunityTools(defineTool: DefineTool, deps: OpportunityToolDeps) {
  const { database, userDb, systemDb, graphs, cache } = deps;
  const createOpportunityPresenter =
    (deps.opportunityPresentation?.createPresenter as (() => OpportunityPresenter) | undefined) ??
    (() => new OpportunityPresenter());
  const gatherOpportunityPresenterContext =
    (deps.opportunityPresentation?.gatherPresenterContext as typeof gatherPresenterContext | undefined) ??
    gatherPresenterContext;
  const listOpportunities = createListOpportunitiesTool(defineTool, deps);

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status, advancing it through the connection lifecycle.\n\n" +
      "**Status transitions:**\n" +
      "- `pending`: Sends a draft opportunity to the other party. They'll be notified and can accept or reject. " +
      "This is the primary action after a persisted draft is returned.\n" +
      "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. Returns a conversationId to surface to the user.\n" +
      "- `rejected`: Decline a received opportunity.\n" +
      "- `expired`: Mark as expired (typically done by the system after timeout).\n\n" +
      "**When to use:** After list_opportunities returns persisted opportunity cards. " +
      "The user clicks 'Send' (pending), 'Accept', or 'Reject' on the card, and the agent calls this tool.\n\n" +
      "**Owner approval (agents):** Agent-driven send/accept/reject transitions require an explicit owner-issued approval proof. " +
      "Call without ownerApprovalProof first: the denial returns an approval challenge (interactionId, expiresAt) bound to the exact opportunity, action, owner, and agent. " +
      "Relay that challenge to the owner for explicit approval, then retry once with the issued ownerApprovalProof. " +
      "Proofs are single-use and expire; negotiation approvals and advisory values are never substitutes.\n\n" +
      "**Returns:** Confirmation with the new status and notification details (who was notified).",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("The UUID of the opportunity to update. Get from list_opportunities results."),
      status: z
        .enum(["pending", "accepted", "rejected", "expired"])
        .describe(
          "New status: 'pending' = send the draft to the other party, 'accepted' = accept the connection, " +
          "'rejected' = decline, 'expired' = mark as timed out.",
        ),
      ownerApprovalProof: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Opaque owner-issued approval proof for this exact transition (agents only). Obtained after the owner " +
          "explicitly approves the interaction challenge returned by a proof-less call. The opportunity, action, " +
          "owner, agent, and interaction binding is always derived server-side; only this token is presented.",
        ),
      scopeType: z
        .enum(['intent'])
        .optional()
        .describe("Optional selected scope type. Use 'intent' to require this opportunity to belong to a selected intent."),
      scopeId: z
        .string()
        .optional()
        .describe("Selected intent UUID when scopeType is 'intent'. Must match the chat's focused intent when one exists."),
    }),
    handler: async ({ context, query }) => {
      const opportunityId = query.opportunityId?.trim();
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return error("Valid opportunityId required.");
      }

      const contextIntentId = focusedIntentId(context);
      const rawScopeId = query.scopeId?.trim() || undefined;
      if (query.scopeType === 'intent' && !rawScopeId) {
        return error("scopeId required when scopeType is intent.");
      }
      if (!query.scopeType && rawScopeId) {
        return error("scopeType=intent required when scopeId is provided.");
      }
      if (rawScopeId && !UUID_REGEX.test(rawScopeId)) {
        return error("Invalid scope ID format.");
      }
      if (contextIntentId && rawScopeId && contextIntentId !== rawScopeId) {
        return error("This chat is scoped to a different intent.");
      }
      const effectiveIntentScope = contextIntentId
        ? { scopeType: 'intent' as const, scopeId: contextIntentId }
        : query.scopeType === 'intent' && rawScopeId
          ? { scopeType: 'intent' as const, scopeId: rawScopeId }
          : {};

      const scopedNetworkId = focusedNetworkId(context) ?? context.networkId?.trim();
      const admission = await admitOpportunityUpdate(systemDb, {
        opportunityId,
        viewerId: context.userId,
        scopedNetworkId,
        selectedIntentScope: effectiveIntentScope,
      });
      if (admission.kind === 'denied') return error(admission.message);

      // IND-593 owner-approval boundary: every owner-gated transition
      // (send/accept/reject) requires an explicit owner-issued, fresh,
      // atomically single-use proof before any graph/state persistence. The
      // binding is derived ONLY from the resolved context and validated input —
      // caller-controlled identity or proof-binding fields are never trusted.
      // Registered agents present the opaque proof token; direct authenticated
      // owners traverse the same boundary via host attestation. Fail closed
      // when no authority is wired.
      const ownerAction = opportunityOwnerActionForStatus(query.status);
      if (ownerAction) {
        const authority = deps.opportunityOwnerApproval;
        if (!authority) {
          return ownerApprovalDenial(opportunityId, ownerAction, { kind: 'denied', reason: 'missing' });
        }
        const directProvenance = ownerApprovalProvenanceFor(context);
        const verdict = context.agentId
          ? await authority.consumeAgentProof(query.ownerApprovalProof, {
              opportunityId,
              action: ownerAction,
              ownerId: context.userId,
              agentId: context.agentId,
            })
          : directProvenance
            ? await authority.attestOwnerInteraction({
                opportunityId,
                action: ownerAction,
                ownerId: context.userId,
                provenance: directProvenance,
              })
            : { kind: 'denied' as const, reason: 'untrusted_provenance' as const };
        if (verdict.kind === 'denied') return ownerApprovalDenial(opportunityId, ownerAction, verdict);
      }

      const _updateGraphStart = Date.now();
      const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateTraceEmitter?.({ type: "graph_start", name: "opportunity" });
      // One transition path. `pending` used to promote a pre-kickoff row;
      // there is no pre-kickoff state any more, so it is an ordinary status
      // change like the rest.
      const operations = deps.opportunityOperations ?? { updateOpportunityStatus };
      const result = await operations.updateOpportunityStatus(deps, {
        userId: context.userId,
        opportunityId: query.opportunityId,
        newStatus: query.status,
      });
      const _updateGraphMs = Date.now() - _updateGraphStart;
      _updateTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _updateGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
            ...(result.mutationResult.conversationId && {
              conversationId: result.mutationResult.conversationId,
            }),
            // Neither update nor send invokes an agent, so this stage never reports sub-agent timings.
            _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to update opportunity.");
      }
      return error("Failed to update opportunity.");
    },
  });

  const confirmOpportunityDelivery = defineTool({
    name: "confirm_opportunity_delivery",
    description:
      "Marks an opportunity as delivered to the user via the OpenClaw channel. " +
      "Call this for each opportunity you decide to surface, BEFORE including it in your delivery message. " +
      "The 'trigger' argument records which dispatch path produced this delivery: " +
      "'ambient' for real-time critical alerts (target ≤3/day), 'digest' for the daily sweep, " +
      "'accepted' for accepted-opportunity notifications to the counterparty. " +
      "Idempotent — safe to call even if the opportunity was already confirmed.",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("The UUID of the opportunity to mark as delivered."),
      trigger: z
        .enum(['ambient', 'digest', 'accepted'])
        .describe(
          "Which dispatch path produced this delivery. Use 'ambient' if the dispatch prompt says you are in the ambient pass; use 'digest' if it says you are in the daily digest; use 'accepted' for accepted-opportunity notifications to the counterparty.",
        ),
    }),
    handler: async ({ context, query }) => {
      if (!context.isMcp || !context.agentId) {
        return confirmDeliveryError(
          "unauthenticated",
          false,
          "confirm_opportunity_delivery is only available to authenticated agent MCP contexts.",
        );
      }
      if (!deps.deliveryLedger) {
        return confirmDeliveryError(
          "ledger_unavailable",
          false,
          "Delivery ledger not available in this context.",
        );
      }
      if (!UUID_REGEX.test(query.opportunityId)) {
        return confirmDeliveryError(
          "invalid_opportunity_id",
          false,
          "Invalid opportunity ID format.",
        );
      }
      try {
        const result = await deps.deliveryLedger.confirmOpportunityDelivery({
          opportunityId: query.opportunityId,
          userId: context.userId,
          agentId: context.agentId,
          trigger: query.trigger,
        });
        return success({ status: result });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Permanent failures — the caller MUST NOT retry. Retrying a deleted
        // opportunity or an unauthorized actor never succeeds and only spams
        // the ledger / MCP transport.
        if (reason === 'opportunity_not_found') {
          logger.warn('confirm_opportunity_delivery: opportunity not found', {
            opportunityId: query.opportunityId,
          });
          return confirmDeliveryError(
            'opportunity_not_found',
            false,
            'Opportunity not found — it may have been deleted. Do not retry.',
          );
        }
        if (reason === 'not_authorized') {
          logger.warn('confirm_opportunity_delivery: caller is not an actor', {
            opportunityId: query.opportunityId,
            userId: context.userId,
          });
          return confirmDeliveryError(
            'not_authorized',
            false,
            'You are not an actor on this opportunity. Do not retry.',
          );
        }
        // Unknown / transient (e.g. DB connectivity) — safe to retry. The
        // ledger write is idempotent, so a retry that races a prior success
        // returns 'already_delivered' rather than a duplicate row.
        logger.error('Failed to confirm opportunity delivery', { err });
        return confirmDeliveryError(
          'confirm_failed',
          true,
          'Failed to confirm opportunity delivery — transient error, safe to retry.',
        );
      }
    },
  });

  return [
    listOpportunities,
    updateOpportunity,
    confirmOpportunityDelivery,
  ] as const;
}
