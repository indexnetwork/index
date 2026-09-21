import type { Decision, Opportunity } from "../shared/agent.context.js";
import { defineTool, type Tool } from "../shared/reasoning/reasoning.tool.js";

import type { WakeAction } from "./principal.context.js";
import { BRIEF_LIMIT, DECISIONS } from "./principal.instructions.js";

export function createWakeTools(input: {
  opportunities: Opportunity[];
  openQuestions: Map<string, string>;
  actions: WakeAction[];
  onBrief?: (actions: WakeAction[]) => void | Promise<void>;
}): { tools: Tool[]; publicationFailure: () => { cause: unknown } | undefined } {
  const byId = new Map(input.opportunities.map((opportunity) => [opportunity.id, { ...opportunity }]));
  let noted = false;
  let publicationFailure: { cause: unknown } | undefined;

  const tools: Tool[] = [
    defineTool({
      name: "set_brief",
      description: "Decide one opportunity and brief its negotiator. Its negotiator starts as soon as you call this. The brief text is required when that opportunity has none yet, and otherwise replaces the standing one. Check every counterpart eligibility requirement against explicit principal facts. Put each missing qualification or preference first as unresolved and require asking the principal before advancing. After an answer, repeat that check and preserve all other missing facts, even if the previous brief omitted them. Fit claims must be supported within the brief limit.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          opportunityId: { type: "string" },
          decision: { type: "string", enum: DECISIONS },
          brief: { type: "string", minLength: 1, maxLength: BRIEF_LIMIT },
        },
        required: ["opportunityId", "decision"],
      },
      run: async ({ opportunityId, decision, brief }: { opportunityId: string; decision: Decision; brief?: string }) => {
        const opportunity = byId.get(opportunityId);
        if (!opportunity) throw new Error(`No opportunity ${opportunityId}. Use one of: ${[...byId.keys()].join(", ") || "none"}.`);
        const decided = recordBrief(opportunity, decision, brief);
        input.actions.push(...decided);
        if (brief) opportunity.brief = brief;
        opportunity.decision = decision;
        try {
          await input.onBrief?.(decided);
        } catch (cause) {
          publicationFailure ??= { cause };
        }
        return "Brief recorded, and its negotiator is starting.";
      },
    }),
    defineTool({
      name: "note_principal",
      description: "Send a visible reply to your principal, including greetings, answers to their questions, and acknowledgment of their answers. Use this even when no negotiation action is needed; plain text outside this tool is not delivered. Also explain relevant work or why you need input. Required before ask_principal. Do not repeat replies or send unsolicited activity dumps.",
      parameters: { type: "object", additionalProperties: false, properties: { text: { type: "string", minLength: 1 } }, required: ["text"] },
      run: ({ text }: { text: string }) => {
        input.actions.push({ type: "note", text });
        noted = true;
        return "Note recorded. You may ask now.";
      },
    }),
    defineTool({
      name: "ask_principal",
      description: "Ask your principal one question, when a missing personal fact or an approval to commit them would change the next move. Ask directly for the missing role, skill or preference; asking whether they want to explore a match does not establish those facts. One question per missing fact: negotiations stalled on the same fact share a single intent-scoped question, and a fact that is one counterpart's own terms — or any approval — is opportunity-scoped. A question already waiting on your principal rules out asking for that same fact again, nothing else: a stall whose fact no open question covers still has to be asked, or that negotiation waits on an answer that will never come. Call note_principal first.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1 },
          options: { type: "array", minItems: 2, maxItems: 4, uniqueItems: true, items: { type: "string", minLength: 1 } },
          scope: { type: "string", enum: ["intent", "opportunity"] },
          opportunityId: { type: "string", description: "Required when scope is opportunity." },
        },
        required: ["question", "options", "scope"],
      },
      run: (argument: { question: string; options: string[]; scope: "intent" | "opportunity"; opportunityId?: string }) => {
        if (!noted) throw new Error("Write the note first with note_principal: your principal reads why you are asking before the question itself.");
        if (argument.scope === "opportunity") {
          if (!argument.opportunityId) throw new Error("An opportunity-scoped question needs its opportunityId.");
          if (!byId.has(argument.opportunityId)) throw new Error(`No opportunity ${argument.opportunityId}. Use one of: ${[...byId.keys()].join(", ") || "none"}.`);
        }
        input.actions.push({ type: "ask", scope: argument.scope, question: argument.question, options: argument.options, ...(argument.opportunityId ? { opportunityId: argument.opportunityId } : {}) });
        return "Question recorded.";
      },
    }),
    defineTool({
      name: "expire_question",
      description: "Retire a question already waiting on your principal, when their own words have made its answer unable to change anything. It leaves their queue unanswered.",
      parameters: { type: "object", additionalProperties: false, properties: { questionId: { type: "string" } }, required: ["questionId"] },
      run: ({ questionId }: { questionId: string }) => {
        if (!input.openQuestions.has(questionId)) throw new Error(`No question ${questionId} is waiting on your principal. Open questions: ${[...input.openQuestions.keys()].join(", ") || "none"}.`);
        input.openQuestions.delete(questionId);
        input.actions.push({ type: "expire", questionId });
        return "Question retired.";
      },
    }),
  ];

  return { tools, publicationFailure: () => publicationFailure };
}

export function createBriefTool(opportunity: Opportunity, actions: WakeAction[]): Tool {
  return defineTool({
    name: "set_brief",
    description: "Decide this opportunity and brief its negotiator. The brief is the only thing the negotiator carries into its turn. Check every counterpart eligibility requirement against explicit principal facts. Put each missing qualification or preference first as unresolved and require asking the principal before advancing, even before the counterpart asks about it. Fit claims must be supported within the brief limit.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        decision: { type: "string", enum: DECISIONS },
        brief: { type: "string", minLength: 1, maxLength: BRIEF_LIMIT, description: opportunity.brief ? "A replacement brief. Omit it to leave the standing brief in place." : "This opportunity's brief. Required: it has none yet." },
      },
      required: opportunity.brief ? ["decision"] : ["decision", "brief"],
    },
    run: ({ decision, brief }: { decision: Decision; brief?: string }) => {
      actions.push(...recordBrief(opportunity, decision, brief));
      return "Brief recorded.";
    },
  });
}

function recordBrief(opportunity: Opportunity, decision: Decision, brief?: string): WakeAction[] {
  if (!brief && !opportunity.brief) throw new Error("This opportunity has no brief yet, so this decision needs one: the negotiator carries it out from the brief alone.");
  return [...(brief ? [{ type: "brief" as const, opportunityId: opportunity.id, brief }] : []), { type: "decision", opportunityId: opportunity.id, decision }];
}
