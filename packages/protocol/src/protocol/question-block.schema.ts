/**
 * The question block: the rendering contract between the negotiator's
 * question-message and the web client's steps UI, and the routing contract
 * for answers (docs/plans/2026-08-18-conversational-questions.md).
 *
 * The block is a *view* of the currently-parked negotiations for one intent
 * scope, regenerated fresh on every change — it is not a persistence schema
 * and must never grow state (answered flags, timestamps, question ids).
 * A question's identity is its primary negotiation reference: the id of the
 * opportunity row the negotiation runs on. Task re-resolution from that row
 * is server-side and never encoded here — deliberately, because a snapshotted
 * task id would go stale: answer routing branches on what it re-resolves
 * It is used for ordinary principal questions in a signal DM.
 *
 * This module must stay browser-safe: it may import zod and nothing else.
 * It is exposed to the web client through the package root (see STABILITY.md).
 */
import { z } from "zod";

/** Info string of the fenced section that carries the block in a message body. */
export const QUESTION_BLOCK_MARKER = "index-questions";

/** Bump when the block shape changes; parsers fail closed on unknown versions. */
export const QUESTION_BLOCK_VERSION = 1;

/**
 * A negotiation reference: the id of the opportunity row the negotiation runs
 * on. There is no negotiations table — opportunity id is the durable identity
 * used by the owning signal conversation.
 */
const NegotiationRefSchema = z.string().uuid();

export const QuestionBlockQuestionSchema = z.object({
  /** Agent-authored question text, rendered as one step. */
  prompt: z.string().min(1).max(2000),
  /** Primary negotiation this question unparks; doubles as the question's identity. */
  opportunityId: NegotiationRefSchema,
  /** Further negotiations parked on the same gap that this answer also unparks. */
  alsoUnblocks: z.array(NegotiationRefSchema).max(8).optional(),
  /**
   * The checklist dimension the primary negotiation parked on
   * (docs/plans/2026-08-19-checklist-negotiations.md §4), for the step's label:
   * "Timing", "Location", "Stage fit". Presentation only — routing is the
   * negotiation ref and nothing else, so a stale or missing label can never
   * misroute an answer.
   *
   * Optional in both directions. Blocks authored before the checklist protocol
   * carry none and still parse, which is what keeps the fail-closed parser
   * backward-compatible; and a park whose ask named no dimension (a
   * policy-inferred consultation, a post-stall gap) simply renders unlabeled.
   */
  dimension: z.string().min(1).max(60).optional(),
  /**
   * The decision options the agent authored at park time, carried through so
   * the client can pick one instead of composing prose.
   *
   * The negotiator already writes 2–4 real options with the CONSEQUENCE of
   * choosing each ("what I would do next in this negotiation"), and the parked
   * reader already carries them — but the block had no field for them, so
   * every question arrived as prose with a reply arrow and nothing to select.
   *
   * Optional, like every other addition here: a park whose question was
   * stripped by the safety gate, a policy-inferred consultation, and blocks
   * authored before this field all render as prose, which is what the steps UI
   * did for all of them before.
   */
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(280),
  })).min(2).max(4).optional(),
}).strict();
export type QuestionBlockQuestion = z.infer<typeof QuestionBlockQuestionSchema>;

export const QuestionBlockSchema = z.object({
  version: z.literal(QUESTION_BLOCK_VERSION),
  questions: z.array(QuestionBlockQuestionSchema).min(1).max(20),
}).strict().superRefine((block, ctx) => {
  // Identity is the negotiation ref, so a ref may appear exactly once in the
  // whole block — a duplicate would make answer routing ambiguous.
  const seen = new Set<string>();
  block.questions.forEach((question, questionIndex) => {
    const refs = [question.opportunityId, ...(question.alsoUnblocks ?? [])];
    refs.forEach((ref, refIndex) => {
      if (seen.has(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: refIndex === 0
            ? ["questions", questionIndex, "opportunityId"]
            : ["questions", questionIndex, "alsoUnblocks", refIndex - 1],
          message: `negotiation ref ${ref} appears more than once in the block`,
        });
      }
      seen.add(ref);
    });
  });
});
export type QuestionBlock = z.infer<typeof QuestionBlockSchema>;

/** A parsed question-message: the agent's prose and the block that followed it. */
export interface ParsedQuestionMessage {
  prose: string;
  block: QuestionBlock;
}

const openFencePattern = new RegExp(`^(\`{3,})${QUESTION_BLOCK_MARKER}[ \\t]*\\r?$`, "m");

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Embed a block after the agent's prose. The block is always the terminal
 * section of the body: prose, a blank line, then a fenced section whose info
 * string is the marker. The fence is lengthened past any backtick run in the
 * payload so the payload can never close it early.
 *
 * Throws on a block that fails the schema — serializing an invalid block is a
 * producer bug, not a rendering condition.
 */
export function serializeQuestionMessage(prose: string, block: QuestionBlock): string {
  const payload = JSON.stringify(QuestionBlockSchema.parse(block), null, 2);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(payload) + 1));
  const trimmedProse = prose.trimEnd();
  const fenced = `${fence}${QUESTION_BLOCK_MARKER}\n${payload}\n${fence}`;
  return trimmedProse.length > 0 ? `${trimmedProse}\n\n${fenced}` : fenced;
}

/**
 * Extract the block from a message body. Fails closed: any body that does not
 * end in exactly one well-formed, schema-valid block returns null, and the
 * caller renders the whole body as plain text — never a broken steps UI.
 */
export function parseQuestionMessage(body: string): ParsedQuestionMessage | null {
  // Anchor on the last marker fence so prose that merely mentions the marker
  // earlier in the body cannot shadow the real block.
  let open: RegExpExecArray | null = null;
  const searchPattern = new RegExp(openFencePattern.source, "gm");
  for (let match = searchPattern.exec(body); match; match = searchPattern.exec(body)) {
    open = match;
  }
  if (!open) return null;

  const fenceLength = open[1].length;
  const payloadStart = open.index + open[0].length + 1; // past the fence line's newline
  if (payloadStart > body.length) return null;

  const closePattern = new RegExp(`^\`{${fenceLength}}[ \\t]*\\r?$`, "m");
  const close = closePattern.exec(body.slice(payloadStart));
  if (!close) return null;

  // The block must terminate the message: nothing but whitespace may follow.
  const afterClose = body.slice(payloadStart + close.index + close[0].length);
  if (afterClose.trim().length > 0) return null;

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(body.slice(payloadStart, payloadStart + close.index));
  } catch {
    return null;
  }
  const block = QuestionBlockSchema.safeParse(parsedPayload);
  if (!block.success) return null;

  return { prose: body.slice(0, open.index).trimEnd(), block: block.data };
}
