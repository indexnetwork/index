/**
 * The opportunity tool registry: list and update.
 *
 * `list_opportunities` lives in `opportunity.tools.list.ts` and the shared card
 * and link helpers in `opportunity.tools.cards.ts`; this file wires the two
 * tools together and owns the mutation tool.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";


import type { DefineTool } from "../shared/agent/tool.helpers.js";
import type { OpportunityToolDeps } from "./opportunity.tools.port.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { focusedIntentId, focusedNetworkId } from "../shared/agent/tool.scope.js";
import { admitOpportunityUpdate } from "./opportunity.update-admission.js";

export { buildOpportunityPresentation } from "./opportunity.presentation.js";

import { updateOpportunityStatus } from "./opportunity.graph.modes.js";
import { createListOpportunitiesTool } from "./opportunity.tools.list.js";

export { attachOpportunityAppLink, attachProfileLink, buildMinimalOpportunityCard, buildOpportunityAppUrl, buildProfileUrl } from "./opportunity.tools.cards.js";

export function createOpportunityTools(defineTool: DefineTool, deps: OpportunityToolDeps) {
  const { systemDb } = deps;
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

  return [
    listOpportunities,
    updateOpportunity,
  ] as const;
}
