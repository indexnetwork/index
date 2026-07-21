import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type { ChatGraphCompositeDatabase, UserDatabase } from "../shared/interfaces/database.interface.js";
import type { ChatTools, ResolvedToolContext, ToolContext } from "../shared/agent/tool.factory.js";
import { success } from "../shared/agent/tool.helpers.js";

export const AGENT_ACTION_PROPOSAL_FENCE = "agent_action_proposal";

export type AgentCleanupActionType = "retract_premise" | "narrow_signal" | "pause_signal";

export interface AgentActionProposalSnapshot {
  status: string;
  updatedAt?: string;
  payload?: string;
  summary?: string | null;
  assertionText?: string;
}

interface AgentActionProposalActionBase {
  entityId: string;
  currentState: string;
  proposedOperation: string;
  evidence?: string;
  skipped?: boolean;
  reason?: string;
  snapshot?: AgentActionProposalSnapshot;
  description?: string;
}

export type AgentActionProposalAction =
  | (AgentActionProposalActionBase & { type: "retract_premise" })
  | (AgentActionProposalActionBase & { type: "narrow_signal" })
  | (AgentActionProposalActionBase & { type: "pause_signal" });

export interface AgentActionProposal {
  proposalId: string;
  userId: string;
  conversationId?: string;
  actions: AgentActionProposalAction[];
}

/** Host persistence bridge for proposals; the reporter tool never mutates domain rows. */
export interface AgentActionProposalStore {
  createProposal(proposal: AgentActionProposal): Promise<void>;
}

const actionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("retract_premise"),
    premiseId: z.string().trim().min(1),
  }).strict(),
  z.object({
    type: z.literal("narrow_signal"),
    intentId: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }).strict(),
  z.object({
    type: z.literal("pause_signal"),
    intentId: z.string().trim().min(1),
    evidence: z.string().trim().min(1, "pause_signal evidence is required"),
  }).strict(),
]);

const proposeCleanupActionsSchema = z.object({
  actions: z.array(actionInputSchema).min(1).max(5),
}).strict();

type ActionInput = z.infer<typeof actionInputSchema>;

function isFullUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function skippedAction(
  action: ActionInput,
  entityId: string,
  proposedOperation: string,
  reason: string,
): AgentActionProposalAction {
  return {
    type: action.type,
    entityId,
    currentState: "UNKNOWN",
    proposedOperation,
    skipped: true,
    reason,
    ...(action.type === "pause_signal" ? { evidence: action.evidence } : {}),
  };
}

/**
 * Creates the reporter-only proposal tool. It validates owner state and records
 * snapshots, but intentionally has no mutation dependency.
 */
export function createProposeCleanupActionsTool(input: {
  database: ChatGraphCompositeDatabase;
  userDb: UserDatabase;
  context: ResolvedToolContext;
  store: AgentActionProposalStore;
}): ChatTools[number] {
  const { database, userDb, context, store } = input;

  return tool(
    async (query: { actions: ActionInput[] }) => {
      const proposalId = crypto.randomUUID();
      const actions: AgentActionProposalAction[] = [];

      for (const action of query.actions) {
        const entityId = action.type === "retract_premise" ? action.premiseId : action.intentId;
        const operation = action.type === "retract_premise"
          ? "RETRACT_PREMISE"
          : action.type === "narrow_signal" ? "NARROW_SIGNAL" : "PAUSE_SIGNAL";

        if (!isFullUuid(entityId)) {
          actions.push(skippedAction(action, entityId, operation, "A full UUID is required; suffixes and ambiguous IDs are not accepted."));
          continue;
        }

        if (action.type === "retract_premise") {
          const premise = await database.getPremise(entityId).catch(() => null);
          if (!premise || premise.userId !== context.userId) {
            actions.push(skippedAction(action, entityId, operation, "Premise not found or not owned by the authenticated user."));
            continue;
          }
          if (premise.status !== "ACTIVE") {
            actions.push({
              type: action.type,
              entityId,
              currentState: premise.status,
              proposedOperation: operation,
              skipped: true,
              reason: `Premise is already ${premise.status}.`,
            });
            continue;
          }
          actions.push({
            type: action.type,
            entityId,
            currentState: premise.status,
            proposedOperation: operation,
            snapshot: { status: premise.status, updatedAt: premise.updatedAt.toISOString(), assertionText: premise.assertion.text },
          });
          continue;
        }

        const intent = await userDb.getIntent(entityId).catch(() => null);
        if (!intent) {
          actions.push(skippedAction(action, entityId, operation, "Signal not found or not owned by the authenticated user."));
          continue;
        }
        const status = intent.status ?? "ACTIVE";
        if (intent.archivedAt || status === "FULFILLED" || status === "EXPIRED") {
          actions.push({
            type: action.type,
            entityId,
            currentState: intent.archivedAt ? "ARCHIVED" : status,
            proposedOperation: operation,
            ...(action.type === "pause_signal" ? { evidence: action.evidence } : {}),
            skipped: true,
            reason: "Signal is archived or terminal and cannot be changed.",
          });
          continue;
        }
        actions.push({
          type: action.type,
          entityId,
          currentState: status,
          proposedOperation: operation,
          ...(action.type === "pause_signal" ? { evidence: action.evidence } : {}),
          ...(action.type === "narrow_signal" ? { description: action.description } : {}),
          snapshot: {
            status,
            updatedAt: intent.updatedAt.toISOString(),
            payload: intent.payload,
            summary: intent.summary,
          },
        });
      }

      await store.createProposal({
        proposalId,
        userId: context.userId,
        ...(context.sessionId ? { conversationId: context.sessionId } : {}),
        actions,
      });

      const renderedActions = actions.map(({ snapshot: _snapshot, ...entry }) => entry);
      const block = `\`\`\`${AGENT_ACTION_PROPOSAL_FENCE}\n${JSON.stringify({ proposalId, actions: renderedActions })}\n\`\`\``;
      return success({
        proposed: true,
        proposalId,
        actions: renderedActions,
        message: `IMPORTANT: Include this \`\`\`agent_action_proposal code block EXACTLY as-is in your response. It is a REQUEST for owner confirmation; it performs no mutation until the owner confirms it in the UI:\n\n${block}`,
      });
    },
    {
      name: "propose_cleanup_actions",
      description: "Prepare owner-confirmed cleanup actions from same-turn grounded reads. This tool never mutates data.",
      schema: proposeCleanupActionsSchema,
    },
  ) as ChatTools[number];
}

/** Build the optional action tool from the host-provided ToolContext. */
export function createReporterActionTool(
  deps: ToolContext,
  context: ResolvedToolContext,
  userDb: UserDatabase,
): ChatTools[number] | null {
  if (!deps.actionToolsEnabled || !deps.actionProposalStore) return null;
  return createProposeCleanupActionsTool({
    database: deps.database,
    userDb,
    context,
    store: deps.actionProposalStore,
  });
}
