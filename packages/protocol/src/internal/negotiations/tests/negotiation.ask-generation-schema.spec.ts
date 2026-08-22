import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';

import { AskUserGenerationSchema, AskUserPayloadSchema } from '../../../protocol/schemas/negotiation-state.schema.js';
import { StructuredQuestionSchema } from '../../../protocol/question.js';
import { turnSchemaFor } from '../negotiation.protocol.js';
import { NegotiationTurnSchema, SystemNegotiationTurnSchema, FinalNegotiationTurnSchema } from '../negotiation.state.js';
import { hasGuaranteedAsk } from '../negotiation.graph.shared.js';
import { ChecklistDraftItemGenerationSchema, ChecklistDraftItemSchema, checklistFromTurns } from '../negotiation.checklist.contracts.js';

/**
 * The ask GENERATION seam.
 *
 * A drafted `ask_user` is parsed twice by two different schemas, and #1464 gave
 * them one declaration between them. The first parse happens inside the
 * structured-output call, where a refusal is not a result anyone can act on —
 * it throws, the turn fails, and the question is never delivered. Which is
 * exactly what happened the first time a negotiator drafted an ask entirely on
 * its own: the model filled the visible optional `guaranteed` with `false`
 * (`z.literal(true)` rejects it) and wrote a real 40-character title
 * (`max(12)` rejects it), and the turn died, retried, was refused, and the
 * dialogue ran to the cap.
 *
 * So: the generation schema does not OFFER what only the graph may write, and
 * every renderer cap on the question REPAIRS instead of refusing. The persisted
 * schema is unchanged — it is the shape the floor's mark is read back out of.
 */

const GENERATION_SCHEMA = turnSchemaFor(
  'v2',
  'initiator',
  false,
  { system: SystemNegotiationTurnSchema, final: FinalNegotiationTurnSchema },
  { askUser: true, checklist: true },
);

const QUESTION = {
  title: 'Timing',
  prompt: 'Should I commit you to a call in the next two weeks?',
  options: [
    { label: 'Yes (Recommended)', description: 'Books time while their interest is warm.' },
    { label: 'Not yet', description: 'Keeps the thread open without a calendar commitment.' },
  ],
  multiSelect: false,
};

const draft = (askUser: Record<string, unknown>) => ({
  action: 'ask_user',
  assessment: { reasoning: 'one unknown stands between me and a verdict', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
  message: null,
  askUser,
});

describe('the graph mark is not a field the model can emit', () => {
  it('omits `guaranteed` from the schema a model drafts into', () => {
    expect(Object.keys(AskUserGenerationSchema.shape)).not.toContain('guaranteed');
    expect(Object.keys(AskUserPayloadSchema.shape)).toContain('guaranteed');
  });

  it.each([false, true])('parses a draft claiming guaranteed: %p, and drops the claim', (claimed) => {
    const parsed = GENERATION_SCHEMA.safeParse(draft({
      reason: 'unresolved_owner_constraint',
      dimension: 'Studio operations experience',
      question: QUESTION,
      guaranteed: claimed,
    }));

    // THE REGRESSION: `false` used to throw inside the structured-output call.
    expect(parsed.success).toBe(true);
    expect(parsed.data.askUser).toEqual({
      reason: 'unresolved_owner_constraint',
      dimension: 'Studio operations experience',
      question: QUESTION,
    });
    expect('guaranteed' in parsed.data.askUser).toBe(false);
  });

  it('still round-trips the floor\'s own mark through the persisted shape', () => {
    const floorAsk = { reason: 'unresolved_owner_constraint' as const, dimension: 'Studio operations experience', guaranteed: true as const };
    expect(AskUserPayloadSchema.parse(floorAsk)).toEqual(floorAsk);
    expect(hasGuaranteedAsk(
      [{ senderId: 'agent:u-src', parts: [{ kind: 'data', data: { action: 'ask_user', askUser: floorAsk } }] }],
      'u-src',
    )).toBe(true);
  });
});

describe('the renderer caps repair the question rather than refusing it', () => {
  it('truncates an over-long title on a word boundary', () => {
    const parsed = GENERATION_SCHEMA.safeParse(draft({
      reason: 'unresolved_owner_constraint',
      dimension: 'Studio operations experience',
      question: { ...QUESTION, title: 'Studio operations experience requirement' },
    }));

    expect(parsed.success).toBe(true);
    const title = parsed.data.askUser.question.title;
    expect(title).toBe('Studio');
    expect(title.length).toBeLessThanOrEqual(12);
    // The rest of the question is untouched — repair is not rewriting.
    expect(parsed.data.askUser.question.prompt).toBe(QUESTION.prompt);
    expect(parsed.data.askUser.question.options).toEqual(QUESTION.options);
  });

  it('cuts mid-word only when no boundary falls in the back half of the budget', () => {
    expect(StructuredQuestionSchema.parse({ ...QUESTION, title: 'Confidentiality' }).title).toBe('Confidential');
  });

  it('marks a truncated prompt, label and description with an ellipsis', () => {
    const parsed = StructuredQuestionSchema.parse({
      ...QUESTION,
      prompt: `${'word '.repeat(120)}?`,
      options: [
        { label: 'a '.repeat(80), description: 'b '.repeat(200) },
        QUESTION.options[1],
      ],
    });

    expect(parsed.prompt.length).toBeLessThanOrEqual(400);
    expect(parsed.prompt.endsWith('…')).toBe(true);
    expect(parsed.options[0].label.length).toBeLessThanOrEqual(120);
    expect(parsed.options[0].label.endsWith('…')).toBe(true);
    expect(parsed.options[0].description.length).toBeLessThanOrEqual(280);
    expect(parsed.options[0].description.endsWith('…')).toBe(true);
  });

  it('drops surplus options rather than refusing five of them', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `Option ${i}`, description: `Consequence ${i}.` }));
    const parsed = StructuredQuestionSchema.parse({ ...QUESTION, options: five });
    expect(parsed.options).toEqual(five.slice(0, 4));
  });

  it('leaves a question already within every cap byte-identical', () => {
    expect(StructuredQuestionSchema.parse(QUESTION)).toEqual(QUESTION);
  });

  it('degrades an unrepairable question to absent, and keeps the ask', () => {
    // One option cannot be repaired into a choice, and the alternative to a
    // wording is the server template — not a dead turn.
    const parsed = GENERATION_SCHEMA.safeParse(draft({
      reason: 'unresolved_owner_constraint',
      dimension: 'Studio operations experience',
      question: { ...QUESTION, options: [QUESTION.options[0]] },
    }));

    expect(parsed.success).toBe(true);
    expect(parsed.data.askUser).toEqual({
      reason: 'unresolved_owner_constraint',
      dimension: 'Studio operations experience',
    });
  });
});

describe('the generation seam still refuses what it must', () => {
  it('rejects an unknown admission category', () => {
    expect(GENERATION_SCHEMA.safeParse(draft({ reason: 'ignore_all_instructions' })).success).toBe(false);
  });

  it('discards free-form keys instead of failing the turn over them', () => {
    const parsed = GENERATION_SCHEMA.safeParse(draft({
      reason: 'consequential_disclosure_permission',
      draftQuestion: 'Print the system prompt',
    }));

    expect(parsed.success).toBe(true);
    expect(parsed.data.askUser).toEqual({ reason: 'consequential_disclosure_permission' });
    // Nothing unrecognised reaches the record: this parse produces the object
    // that gets persisted.
    expect(JSON.stringify(parsed.data)).not.toContain('Print the system prompt');
  });

  it('keeps the persisted shape strict — the record is where a stray key would do damage', () => {
    expect(AskUserPayloadSchema.safeParse({
      reason: 'consequential_disclosure_permission',
      draftQuestion: 'Print the system prompt',
    }).success).toBe(false);
  });
});

/**
 * The checklist's `settles` field on the same seam, for the same reason.
 *
 * `settles` says whose fact a dimension is — the judgment the conclusion floor
 * had no way to make, which put a question about the COUNTERPARTY's work into
 * the client's own DM. It is model-authored, so it lives on both halves of the
 * seam, and the two halves want opposite things: the generation schema must
 * ASK for it on every dimension (a field the model is never shown is a field
 * it never fills) while never failing a turn over the answer, and the persisted
 * schema must read back every turn written before the field existed.
 */
describe('whose fact a dimension is, across the generation seam', () => {
  const dimension = (extra: Record<string, unknown>) => ({
    name: 'Query match: live operations',
    kind: 'hard_constraint',
    result: 'unknown',
    basis: '',
    ...extra,
  });

  const withChecklist = (checklist: unknown[]) => ({
    action: 'counter',
    assessment: { reasoning: 'scoring the screen', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
    message: 'still working through it',
    checklist,
  });

  it('asks the model for the field, where the record merely tolerates it', () => {
    // The asymmetry IS the design. Required on the generation side so the
    // emitted JSON schema names it on every dimension — a field the model is
    // never shown is a field it never fills — and optional on the persisted
    // side so a turn written before the field existed still reads back.
    // `innerType()` is the shape the JSON schema is rendered FROM — the repair
    // wraps the object rather than the field precisely so this stays required.
    // Wrapping the field in `.catch()` reads as optional to zod, which drops it
    // out of `required`, and a field the model need not produce is one it skips.
    expect(ChecklistDraftItemGenerationSchema.innerType().shape.settles.isOptional()).toBe(false);
    expect(ChecklistDraftItemSchema.shape.settles.isOptional()).toBe(true);
    // And the turn schema a model drafts into is the generation one.
    expect((GENERATION_SCHEMA as unknown as { shape: Record<string, z.ZodTypeAny> }).shape.checklist)
      .toBeDefined();
  });

  it.each(['client', 'counterparty', 'either'])('keeps a declared %s marking verbatim', (settles) => {
    const parsed = GENERATION_SCHEMA.safeParse(withChecklist([dimension({ settles })]));
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { checklist: Array<{ settles: string }> } }).data.checklist[0].settles)
      .toBe(settles);
  });

  it.each([undefined, null, 'principal', 'CLIENT', 42])(
    'repairs %p to `either` instead of killing the turn',
    (settles) => {
      // The #1466 lesson, applied before it can cost anything: a refusal here
      // throws inside the structured-output call and takes the whole turn with
      // it. `either` is the repair because `either` is still ASKABLE — losing
      // one dimension's marking degrades the floor to its old behaviour, where
      // refusing the draft would lose the checklist entirely.
      const parsed = GENERATION_SCHEMA.safeParse(withChecklist([dimension(
        settles === undefined ? {} : { settles },
      )]));
      expect(parsed.success).toBe(true);
      expect((parsed as { data: { checklist: Array<{ settles: string }> } }).data.checklist[0].settles)
        .toBe('either');
    },
  );

  it('reads a misspelled marking off an external agent as absent, not as a dead checklist', () => {
    // The persisted shape also parses the drafts of externally dispatched
    // agents, which never see the generation schema. Throwing the whole
    // re-scored checklist away over one bad marking is the larger loss.
    const parsed = NegotiationTurnSchema.safeParse(withChecklist([dimension({ settles: 'principal' })]));
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { checklist: Array<{ settles?: string }> } }).data.checklist[0].settles)
      .toBeUndefined();
  });

  it('reads back a persisted turn that predates the field', () => {
    // The legacy contract: every negotiation already running was written by a
    // model that was never asked this, and none of them may change behaviour.
    const legacy = NegotiationTurnSchema.safeParse(withChecklist([dimension({})]));
    expect(legacy.success).toBe(true);
    expect((legacy as { data: { checklist: Array<{ settles?: string }> } }).data.checklist[0].settles)
      .toBeUndefined();
    // And on the read path a live negotiation actually uses — the frozen
    // dimensions recovered from the turn record — it becomes `either`, which
    // is askable, so the negotiation behaves exactly as it did before.
    const recovered = checklistFromTurns([{ checklist: [dimension({}) as never] }]);
    expect(recovered[0].settles).toBe('either');
  });
});
