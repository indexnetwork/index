/**
 * Deriving a renderable question from the checklist dimension a park is about
 * (conversational questions × the conclusion floor, #1464).
 *
 * A park used to carry a question because an agent wrote one. The conclusion
 * floor changed that: when an agent drafts a verdict while a dimension it
 * itself scored `unknown` is still askable, the GRAPH fires the ask on its
 * behalf — and a graph-fired ask has no author, so it parks with
 * `askUser.dimension` (plus the answerhood map when the agent declared one)
 * and no `askUser.question`.
 *
 * Downstream, that absence used to degrade the whole delivery shape: the
 * question-message author's deterministic composition renders park-time
 * questions verbatim, so a park with none contributed nothing, and the block
 * lost the one thing that makes answering structural. Live on 2026-08-20 the
 * first floor-fired ask ever delivered reached its client as PROSE — a
 * "we need to know…" paragraph with nothing bound to it — and the client's
 * answer three minutes later was consumed by the chat orchestrator's signal
 * edit rule instead of the negotiation that was starving for it.
 *
 * So the question is DERIVED here, deterministically, from material the
 * client's own side already holds: the dimension its agent authored, the kind
 * it filed the dimension under, and the answerhood map it declared before
 * asking. No model call — an arrow that matters must not be a model's choice.
 * What comes out is the same `title/prompt/options` shape a park-time question
 * has, so every consumer downstream (the author's model grounding, its block
 * mapping, its deterministic fallback) treats it exactly like one.
 *
 * The derived prompt still faces `isSafeQuestionMessagePrompt`: the dimension
 * name is agent-written text and this is the first surface that renders it as
 * a question rather than a label. A rejected derivation resolves to
 * `undefined` — today's behaviour, one park with nothing renderable — rather
 * than shipping unchecked text into the client's DM.
 */
import type { ParkedNegotiation, ParkedNegotiationQuestion } from '../../adapters/parked-negotiation.reader.adapter';
import { isSafeQuestionMessagePrompt } from './negotiation-question.contract';

/**
 * Title cap, mirroring the protocol's `StructuredQuestionSchema.title` (≤12
 * chars, the noun of the decision domain). Nothing here is validated against
 * that schema — the block carries no title — but a derived question that
 * could not be persisted as an authored one is a derivation that drifted, and
 * the sibling ask-generation lane hit exactly this cap from the other side.
 */
export const MAX_DERIVED_TITLE_CHARS = 12;

/** Block prompts cap at 2000; the renderer-facing question shape caps at 400. */
const MAX_DERIVED_PROMPT_CHARS = 400;

/** Option label/description caps, from the block schema. */
const MAX_OPTION_LABEL_CHARS = 120;
const MAX_OPTION_DESCRIPTION_CHARS = 280;

/** Last-resort title when the dimension name yields no usable leading noun. */
const FALLBACK_TITLE = 'Detail';

/**
 * How each checklist kind reads to the person being asked. The kind is the
 * agent's own filing of what sort of fact this is, and saying it out loud is
 * what stops the derived question from reading as a generic "any thoughts?".
 */
const KIND_PHRASE: Record<NonNullable<ParkedNegotiation['dimensionKind']>, string> = {
  mutual_want: 'something you would have to actually want',
  hard_constraint: 'a constraint I cannot work around on my own',
  fit: 'a question of how well this actually fits you',
};

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * The decision-domain noun of a dimension name: "Timing: This week" → "Timing",
 * "Stage fit (pre-seed)" → "Stage fit". Dimension names are ≤60 chars and
 * frequently qualified; the title is the part before the first qualifier,
 * clamped to the cap.
 */
export function titleFromDimension(name: string): string {
  const lead = name.split(/[:—–(\-|/]/)[0] ?? '';
  const title = clamp(lead, MAX_DERIVED_TITLE_CHARS) || clamp(name, MAX_DERIVED_TITLE_CHARS);
  return title || FALLBACK_TITLE;
}

/**
 * The two answers the ask itself declared would settle the dimension, as
 * decision options: the LABEL is the answer, the DESCRIPTION is what the
 * negotiation does with it — the same contract park-time options carry, so the
 * client is choosing a consequence rather than a phrasing.
 *
 * Returns `[]` without an answerhood map. The block's options are optional and
 * two is its floor, so a park whose ask declared nothing renders as a prompt
 * with a reply arrow — still a block, still structurally bound.
 */
function optionsFromAnswerhood(
  answerhood: ParkedNegotiation['answerhood'],
  title: string,
): ParkedNegotiationQuestion['options'] {
  if (!answerhood) return [];
  // The answerhood map never passed the park-time authored-question gate —
  // that gate covers `askUser.question` only — and these labels are the first
  // thing to render it to the client. Either half tripping drops BOTH options,
  // not the question: a block with a prompt and no options is still bound to
  // its negotiation, which is the property that matters here.
  if (!isSafeQuestionMessagePrompt(answerhood.ok_when) || !isSafeQuestionMessagePrompt(answerhood.conflict_when)) {
    return [];
  }
  return [
    {
      label: clamp(answerhood.ok_when, MAX_OPTION_LABEL_CHARS),
      description: clamp(
        `That settles ${title.toLowerCase()} and I carry the negotiation forward on it.`,
        MAX_OPTION_DESCRIPTION_CHARS,
      ),
    },
    {
      label: clamp(answerhood.conflict_when, MAX_OPTION_LABEL_CHARS),
      description: clamp(
        `That marks ${title.toLowerCase()} as a conflict and I stop pressing it there.`,
        MAX_OPTION_DESCRIPTION_CHARS,
      ),
    },
  ];
}

/**
 * The prompt: the dimension named, what kind of fact the agent filed it under,
 * and the ask. The answerhood map is NOT spliced in here — it is written from
 * the agent's point of view ("they can meet inside two weeks") and reads
 * wrongly in second person; it belongs on the options, where each half is a
 * choice the client makes rather than a sentence about them.
 */
function promptFromDimension(name: string, kind: ParkedNegotiation['dimensionKind']): string {
  const kindClause = kind ? ` — ${KIND_PHRASE[kind]}` : '';
  const prompt = `${clamp(name, 120)}${kindClause}. One of your negotiations is parked on this until you tell me where you land. What should I take as your answer?`;
  return clamp(prompt, MAX_DERIVED_PROMPT_CHARS);
}

/**
 * The renderable question for one park: the agent's own, when it authored one,
 * otherwise one derived from the dimension. `undefined` only when there is
 * neither — a park with no question and no dimension, which is what a
 * policy-inferred consultation and a pre-checklist post-stall gap look like.
 * That case is unchanged: nothing renderable, left for a later regeneration.
 */
export function renderableQuestion(parked: ParkedNegotiation): ParkedNegotiationQuestion | undefined {
  if (parked.question) return parked.question;
  return deriveQuestionFromDimension(parked);
}

/**
 * Derives the question a floor-fired park never had. Exported for the specs
 * and for callers that need to distinguish derived from authored; ordinary
 * consumers want {@link renderableQuestion}.
 */
export function deriveQuestionFromDimension(parked: ParkedNegotiation): ParkedNegotiationQuestion | undefined {
  const name = parked.dimension?.trim();
  if (!name) return undefined;

  const title = titleFromDimension(name);
  const prompt = promptFromDimension(name, parked.dimensionKind);
  // The dimension name is agent-written and this is the first surface to
  // render it as a question. A prompt that trips the gate is dropped whole:
  // the park falls back to having nothing renderable, which is exactly where
  // it stood before this module existed.
  if (!isSafeQuestionMessagePrompt(prompt)) return undefined;

  const options = optionsFromAnswerhood(parked.answerhood, title);
  return {
    title,
    prompt,
    options,
    multiSelect: false,
  };
}
