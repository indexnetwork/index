/**
 * ask_user_question — blocking mid-conversation questions for the chat
 * orchestrator (AskUserQuestion-style human-in-the-loop).
 *
 * Flow (hybrid authoring):
 * 1. The orchestrator states what it needs to learn (`purpose`) plus optional
 *    draft questions.
 * 2. The QuestionerAgent (mode `chat`) refines that into polished structured
 *    questions, grounded in the recent conversation excerpt and the user's
 *    global context.
 * 3. Questions are persisted (`questions` table, mode `chat`,
 *    `conversationId = sessionId`) via the injected {@link ChatQuestionsHost}.
 * 4. A `user_question` trace event streams the persisted questions to the
 *    frontend, which renders them inline while the turn stays open.
 * 5. The tool blocks on `awaitAnswers` until the user answers/dismisses
 *    through the questions REST endpoints, the wait budget elapses, or the
 *    run is aborted. Answers come back as the tool result so the model
 *    continues the SAME turn.
 *
 * On timeout the questions remain `pending`: they survive reloads via the
 * conversation-linked question fetch, and a later answer re-enters the chat
 * as a new user turn (frontend responsibility).
 *
 * Chat-only: not registered in the MCP tool registry. The handler also fails
 * gracefully when the session/stream context or host bridge is missing.
 */
import { z } from "zod";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { error, success } from "../shared/agent/tool.helpers.js";
import { requestContext } from "../shared/observability/request-context.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { PersistableQuestion, PersistedQuestion, ChatQuestionAnswerOutcome } from "../shared/interfaces/questioner.interface.js";
import type { Question, QuestionGenerationResult, QuestionStrategy, UnderspecificationType } from "../shared/schemas/question.schema.js";
import { QuestionerAgent } from "./questioner.agent.js";
import { chatQuestionWaitTimeoutMs } from "./questioner.env.js";
import type { ChatContext } from "./questioner.types.js";

const logger = protocolLogger("AskUserQuestionTool");


/** Heartbeat interval while blocked, so SSE transports do not idle out. */
const WAIT_HEARTBEAT_MS = 15_000;

/** Messages included in the conversation excerpt fed to the QuestionerAgent. */
const EXCERPT_MESSAGE_COUNT = 10;

/**
 * Fetch window for the excerpt. Host adapters return the FIRST N messages
 * (ascending) when a limit is passed, so we fetch a wide window and keep the
 * tail to get the most recent exchange.
 */
const EXCERPT_FETCH_LIMIT = 100;

/** Max characters per message inside the excerpt. */
const EXCERPT_MESSAGE_CHARS = 400;

// Lazy singleton — construction binds the LLM once; invocations are stateless.
let questionerAgent: QuestionerAgent | null = null;
function getQuestionerAgent(): QuestionerAgent {
  if (!questionerAgent) questionerAgent = new QuestionerAgent();
  return questionerAgent;
}

/** Test seam: replace or reset the module-level QuestionerAgent singleton. */
export function setQuestionerAgentForTesting(agent: QuestionerAgent | null): void {
  questionerAgent = agent;
}

const draftQuestionSchema = z.object({
  prompt: z
    .string()
    .min(5)
    .max(400)
    .describe("The question to ask, ending in a question mark. Self-contained plain language."),
  options: z
    .array(z.string().min(1).max(120))
    .min(2)
    .max(4)
    .optional()
    .describe("2-4 mutually distinct answer options. Omit to let the question generator derive them."),
  multiSelect: z
    .boolean()
    .optional()
    .describe("True when several options can be picked together (priorities, bundles)."),
});

/**
 * Build a fallback Question directly from an orchestrator draft when the
 * QuestionerAgent produced nothing. Requires the draft to carry options.
 */
function questionFromDraft(draft: z.infer<typeof draftQuestionSchema>, index: number): Question | null {
  if (!draft.options || draft.options.length < 2) return null;
  return {
    title: `Question ${index + 1}`,
    prompt: draft.prompt.slice(0, 400),
    options: draft.options.slice(0, 4).map((label) => ({
      label: label.slice(0, 120),
      description: label.slice(0, 280),
    })),
    multiSelect: draft.multiSelect ?? false,
  };
}

/**
 * Creates the chat-only `ask_user_question` tool. Registered by
 * `createChatTools` only when `deps.chatQuestions` is provided — never part
 * of the MCP tool registry (MCP clients have their own elicitation surface).
 *
 * @param defineTool - Tool factory provided by the composition root.
 * @param deps       - Shared tool dependencies; requires `chatQuestions`.
 */
export function createAskUserQuestionTools(defineTool: DefineTool, deps: ToolDeps) {
  const askUserQuestion = defineTool({
    name: "ask_user_question",
    description:
      "Ask the user 1-3 structured clarifying questions and WAIT for their answer before continuing. " +
      "The conversation pauses: the user sees interactive question cards inline and your turn resumes " +
      "with their selections as the tool result.\n\n" +
      "**Use when** a decision materially changes what you do next — before an expensive operation " +
      "(discovery, creating an intent from ambiguous input), when facing meaningfully different " +
      "directions, or when one concrete missing detail (timing, scope, budget, format) blocks progress.\n\n" +
      "**Do not use** for facts already visible in the conversation or profile, procedural " +
      "confirmations (\"Should I proceed?\"), or open-ended questions better asked in your response text.\n\n" +
      "**Input:** `purpose` states what you need to learn and why. Optionally propose `questions` " +
      "drafts (prompt + 2-4 options); a question generator refines wording and option quality.\n\n" +
      "**Returns:** One entry per question with `status` (`answered`/`dismissed`/`timeout`) and the " +
      "user's `selectedOptions`/`freeText`. On `timeout` the questions stay visible in the " +
      "conversation — acknowledge briefly and end your turn; do NOT repeat the questions in text.",
    querySchema: z.object({
      purpose: z
        .string()
        .min(10)
        .max(600)
        .describe("What you need to learn from the user and why it changes what you do next."),
      questions: z
        .array(draftQuestionSchema)
        .min(1)
        .max(3)
        .optional()
        .describe("Draft questions to ask. The question generator polishes them before display."),
    }),
    handler: async ({ context, query }) => {
      const host = deps.chatQuestions;
      if (!host) {
        return error(
          "Interactive questions are not available in this environment. Ask the user directly in your response text instead.",
        );
      }
      if (context.isMcp || !context.sessionId) {
        return error(
          "Interactive questions require a live chat session. Ask the user directly in your response text instead.",
        );
      }
      const store = requestContext.getStore();
      const emit = store?.traceEmitter;
      const signal = store?.abortSignal;
      if (!emit) {
        return error(
          "Interactive questions require a streaming chat turn. Ask the user directly in your response text instead.",
        );
      }

      const sessionId = context.sessionId;

      // ── 1. Gather grounding context ────────────────────────────────────
      const [conversationExcerpt, userContext] = await Promise.all([
        loadConversationExcerpt(deps, sessionId),
        deps.getUserContextText?.(context.userId).catch(() => "") ?? Promise.resolve(""),
      ]);

      // ── 2. Generate polished questions (hybrid: drafts + QuestionerAgent) ──
      const chatContext: ChatContext = {
        purpose: query.purpose,
        ...(query.questions?.length ? { draftQuestions: query.questions } : {}),
        ...(conversationExcerpt ? { conversationExcerpt } : {}),
        ...(userContext ? { userContext } : {}),
      };

      let generated: QuestionGenerationResult | null = null;
      try {
        generated = await getQuestionerAgent().invoke(
          {
            mode: "chat",
            userId: context.userId,
            sourceType: "conversation",
            sourceId: sessionId,
            context: chatContext,
            conversationId: sessionId,
          },
          signal ? { signal } : undefined,
        );
      } catch (err) {
        logger.warn("QuestionerAgent invocation failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      let finalQuestions: Question[];
      let strategies: QuestionStrategy[];
      let underspecificationTypes: Array<UnderspecificationType | null>;
      if (generated && generated.questions.length > 0) {
        finalQuestions = generated.questions;
        strategies = generated.strategies;
        underspecificationTypes = generated.underspecificationTypes;
      } else {
        // Fallback: use the orchestrator's own drafts verbatim (options required).
        const fromDrafts = (query.questions ?? [])
          .map((d, i) => questionFromDraft(d, i))
          .filter((q): q is Question => q !== null);
        if (fromDrafts.length === 0) {
          return error(
            "Could not prepare structured questions. Ask the user directly in your response text instead.",
          );
        }
        finalQuestions = fromDrafts;
        strategies = fromDrafts.map(() => "surface_missing_detail" as const);
        underspecificationTypes = fromDrafts.map(() => null);
      }

      if (signal?.aborted) {
        return error("The chat turn was cancelled before the questions could be shown.");
      }

      // ── 3. Persist (mode `chat`, linked to this conversation) ──────────
      const timestamp = new Date().toISOString();
      const batch: PersistableQuestion[] = finalQuestions.map((payload, i) => ({
        detection: {
          mode: "chat",
          sourceType: "conversation",
          sourceId: sessionId,
          timestamp,
        },
        actors: [{ userId: context.userId, role: "subject" as const }],
        payload,
        strategy: strategies[i] ?? "surface_missing_detail",
        underspecificationType: underspecificationTypes[i] ?? null,
        conversationId: sessionId,
      }));

      let persisted: PersistedQuestion[];
      try {
        persisted = await host.persist(batch);
      } catch (err) {
        logger.error("Failed to persist chat questions", {
          error: err instanceof Error ? err.message : String(err),
        });
        return error("Could not deliver the questions to the user. Ask directly in your response text instead.");
      }

      // ── 4. Stream the cards to the frontend ────────────────────────────
      emit({
        type: "user_question",
        // The event is an opaque action reference. Question text is canonical
        // only after the recipient resolves this ID through the server.
        questions: persisted.map((q) => ({ id: q.id })),
      });

      // ── 5. Block until answered / dismissed / timeout / abort ──────────
      const heartbeat = setInterval(() => {
        try {
          emit({ type: "status", message: "Waiting for your answer…" });
        } catch {
          /* stream may be closing; the wait resolves via timeout/abort */
        }
      }, WAIT_HEARTBEAT_MS);

      let outcomes: ChatQuestionAnswerOutcome[];
      try {
        outcomes = await host.awaitAnswers(
          persisted.map((q) => q.id),
          { timeoutMs: chatQuestionWaitTimeoutMs(), ...(signal ? { signal } : {}) },
        );
      } finally {
        clearInterval(heartbeat);
      }

      const byId = new Map(persisted.map((q) => [q.id, q]));
      const results = outcomes.map((o) => {
        const q = byId.get(o.questionId);
        return {
          questionId: o.questionId,
          prompt: q?.payload.prompt ?? "",
          status: o.status,
          ...(o.answer
            ? {
                selectedOptions: o.answer.selectedOptions,
                ...(o.answer.freeText ? { freeText: o.answer.freeText } : {}),
              }
            : {}),
        };
      });

      const answeredCount = results.filter((r) => r.status === "answered").length;
      const timedOut = results.some((r) => r.status === "timeout");

      return success({
        answers: results,
        summary: `${answeredCount} of ${results.length} question(s) answered`,
        ...(timedOut
          ? {
              guidance:
                "The user has not answered the remaining question(s) yet. They stay visible in the conversation — acknowledge briefly, do NOT repeat the questions in text, and end your turn.",
            }
          : {}),
      });
    },
  });

  return [askUserQuestion] as const;
}

/**
 * Load a compact excerpt of the most recent conversation messages for the
 * QuestionerAgent's grounding. Best-effort: returns "" on any failure or when
 * no chat session reader is available. Note: the in-flight user message is
 * not yet persisted; the orchestrator's `purpose` carries that context.
 */
async function loadConversationExcerpt(deps: ToolDeps, sessionId: string): Promise<string> {
  if (!deps.chatSession) return "";
  try {
    const messages = await deps.chatSession.getSessionMessages(sessionId, EXCERPT_FETCH_LIMIT);
    if (!messages || messages.length === 0) return "";
    return messages
      .slice(-EXCERPT_MESSAGE_COUNT)
      .map((m) => {
        const role = m.role === "assistant" ? "Assistant" : "User";
        const text = (m.content ?? "").replace(/\s+/g, " ").trim();
        return `${role}: ${text.slice(0, EXCERPT_MESSAGE_CHARS)}`;
      })
      .join("\n");
  } catch (err) {
    logger.warn("Failed to load conversation excerpt", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}
