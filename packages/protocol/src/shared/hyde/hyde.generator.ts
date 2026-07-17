/**
 * HyDE Generator Agent: pure LLM agent for generating hypothetical documents
 * in the target corpus voice. Uses free-text lens labels instead of enum strategies.
 */
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { createStructuredModel } from "../agent/model.config.js";
import { invokeWithAbortSignal } from "../agent/model-signal.js";
import { protocolLogger } from '../observability/protocol.logger.js';
import { Timed } from "../observability/performance.js";
import type { HydeSourceFrame } from './hyde.frame.js';
import { HYDE_CORPUS_PROMPTS } from './hyde.strategies.js';
import type { HydeTargetCorpus } from './lens.inferrer.js';

const logger = protocolLogger("HydeGenerator");

const SYSTEM_PROMPT = `You are a Hypothetical Document Generator for semantic search.

Your task: Given a source statement (e.g. an intent or goal), write a short hypothetical document in the voice of the TARGET side—the kind of person or statement that would be an ideal match for that source.

Rules:
- Write in first person as the target.
- Be concrete and specific so the text is good for vector similarity search.
- Output only the hypothetical document text, no meta-commentary.
- Keep length to a few sentences or one short paragraph.`;

const responseFormat = z.object({
  hypotheticalDocument: z
    .string()
    .describe('The hypothetical document text in the target voice, suitable for embedding and retrieval'),
});

export interface HydeGeneratorOutput {
  text: string;
}

export interface HydeGenerateInput {
  /** Original intent or query text. */
  sourceText: string;
  /** Free-text lens label from LensInferrer (e.g. "crypto infra VC"). */
  lens: string;
  /** Which corpus voice to generate in. */
  corpus: HydeTargetCorpus;
  /** Sanitized source-grounded frame. Absence preserves the exact legacy prompt. */
  sourceFrame?: HydeSourceFrame;
}

/** Minimal structured model contract used for deterministic injection in tests. */
export interface HydeGeneratorStructuredModel {
  invoke(input: BaseLanguageModelInput, config?: { signal?: AbortSignal }): Promise<unknown>;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.join('; ') : '(none)';
}

/** Build the frame-v1 generation prompt from sanitized source evidence. */
export function buildFrameHydePrompt(input: HydeGenerateInput & { sourceFrame: HydeSourceFrame }): string {
  const { sourceText, corpus, sourceFrame } = input;
  const corpusInstruction = {
    profiles: 'Write a first-person professional biography in the target profile voice.',
    intents: 'Write a first-person goal or aspiration in the target intent voice.',
    premises: 'Write a first-person stable identity, values, or worldview statement in the target premise voice.',
  }[corpus];

  return `${corpusInstruction}

Source text: "${sourceText}"

Sanitized source frame:
- Source roles: ${renderList(sourceFrame.sourceRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Counterpart/complementary roles: ${renderList(sourceFrame.counterpartRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Explicit hard constraints: ${renderList(sourceFrame.hardConstraints.map((item) => `${item.type}: ${item.value} [evidence: "${item.evidence}"]`))}
- Named entities: ${renderList(sourceFrame.namedEntities.map((item) => `${item.type}: ${item.name} [evidence: "${item.evidence}"]`))}
- Domain vocabulary: ${renderList(sourceFrame.domainVocabulary.map((item) => `${item.term} [evidence: "${item.evidence}"]`))}

Generation constraints:
- You MAY elaborate generic roles and generic domain language.
- You MAY use reciprocal/complementary inversion and write in the target voice.
- You MUST NOT introduce any new proper noun or named entity.
- You MUST NOT introduce any new hard location, time, numeric, credential, organization, or exclusivity constraint.
- Preserve explicit source-frame constraints when they apply to the reciprocal target.
- Output only a few sentences or one short paragraph.`;
}

/** Generates hypothetical documents in a target corpus voice for semantic search. */
export class HydeGenerator {
  private model?: HydeGeneratorStructuredModel;

  constructor(model?: HydeGeneratorStructuredModel) {
    // Preserve the legacy production model construction path; injected models
    // keep prompt tests provider-free.
    this.model = model ?? createStructuredModel("hydeGenerator", responseFormat, {
      name: "hyde_generator",
    });
  }

  private getModel(): HydeGeneratorStructuredModel {
    this.model ??= createStructuredModel("hydeGenerator", responseFormat, {
      name: "hyde_generator",
    });
    return this.model;
  }

  /** Generate a hypothetical document for the given source text and lens. */
  @Timed()
  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const promptText = input.sourceFrame
      ? buildFrameHydePrompt(input as HydeGenerateInput & { sourceFrame: HydeSourceFrame })
      : HYDE_CORPUS_PROMPTS[input.corpus](input.sourceText, input.lens);

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ];

    const result = await invokeWithAbortSignal(this.getModel(), messages);
    const parsed = responseFormat.parse(result);
    const text = parsed.hypotheticalDocument ?? '';

    logger.verbose('Generated HyDE document', {
      lens: input.lens,
      corpus: input.corpus,
      textLength: text.length,
      frameConstrained: !!input.sourceFrame,
    });

    return { text };
  }
}
