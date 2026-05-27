/**
 * User Context Generator
 *
 * Synthesizes network-scoped context paragraphs from user premises.
 * Two modes: cold-start (all premises at once) and incremental
 * (single premise change applied to an existing context).
 * Returns { text, embedding } for storage in the user_contexts table.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { createModel } from "../shared/agent/model.config.js";
import type { EmbeddingGenerator } from "../shared/interfaces/embedder.interface.js";

/** Input for cold-start context generation from a full set of premises. */
export interface UserContextInput {
  premises: Array<{ text: string }>;
  networkPrompt: string | null;
  networkTitle: string;
}

/** Input for incremental context update from a single premise change. */
export interface IncrementalContextInput {
  currentContext: string;
  changeType: 'added' | 'updated' | 'retracted' | 'expired';
  premiseText: string;
  previousPremiseText?: string;
  networkPrompt: string | null;
  networkTitle: string;
}

/** Generated context paragraph with its embedding vector. */
export interface UserContextResult {
  text: string;
  embedding: number[];
}

const COLD_START_SYSTEM_PROMPT = `You synthesize user context paragraphs for community matching. Given a list of premises (atomic facts about a person) and a network description, write a focused paragraph (3-6 sentences) that captures who this person is through the lens of that network's purpose. Highlight what is most relevant to the network. Write in third person. Be specific and concrete, not generic.`;

const INCREMENTAL_SYSTEM_PROMPT = `You maintain user context paragraphs for community matching. You will receive the current context paragraph, a change that occurred, and the network description. Update the context paragraph to reflect the change while preserving all other information. Keep the same style: 3-6 sentences, third person, specific and concrete. For retractions/expirations, remove the relevant information. For additions/updates, integrate the new information naturally.`;

/**
 * Generates network-scoped context paragraphs from user premises.
 * Uses LLM synthesis to produce focused context and an embedding vector.
 */
export class UserContextGenerator {
  private model = createModel('userContextGenerator');

  constructor(private embeddingGenerator: EmbeddingGenerator) {}

  /**
   * Generate a context paragraph from the full set of premises (cold-start).
   *
   * @param input - Premises, network prompt, and network title
   * @returns Synthesized context text with embedding vector
   */
  async generateColdStart(input: UserContextInput): Promise<UserContextResult> {
    const premiseBlock = input.premises.map(p => `- ${p.text}`).join('\n');
    const networkContext = this.formatNetworkContext(input.networkPrompt, input.networkTitle);

    const response = await this.model.invoke([
      new SystemMessage(COLD_START_SYSTEM_PROMPT),
      new HumanMessage(
        `${networkContext}\n\nPremises:\n${premiseBlock}\n\nWrite a focused context paragraph for this person in this network.`,
      ),
    ]);

    const text = typeof response.content === 'string'
      ? response.content
      : String(response.content ?? '').trim();

    const embedding = await this.embed(text);
    return { text, embedding };
  }

  /**
   * Update an existing context paragraph after a single premise change.
   *
   * @param input - Current context, change details, network metadata
   * @returns Updated context text with embedding vector
   */
  async generateIncremental(input: IncrementalContextInput): Promise<UserContextResult> {
    const networkContext = this.formatNetworkContext(input.networkPrompt, input.networkTitle);
    const changeDescription = this.describeChange(input);

    const response = await this.model.invoke([
      new SystemMessage(INCREMENTAL_SYSTEM_PROMPT),
      new HumanMessage(
        `${networkContext}\n\nCurrent context:\n${input.currentContext}\n\nChange:\n${changeDescription}\n\nWrite the updated context paragraph.`,
      ),
    ]);

    const text = typeof response.content === 'string'
      ? response.content
      : String(response.content ?? '').trim();

    const embedding = await this.embed(text);
    return { text, embedding };
  }

  /** Format the network context header for LLM prompts. */
  private formatNetworkContext(prompt: string | null, title: string): string {
    return prompt
      ? `Network "${title}": ${prompt}`
      : `Network: ${title}`;
  }

  /** Describe the premise change for the incremental prompt. */
  private describeChange(input: IncrementalContextInput): string {
    switch (input.changeType) {
      case 'added':
        return `A new fact was learned about this person:\n"${input.premiseText}"`;
      case 'updated':
        return `A fact was updated.\nOld: "${input.previousPremiseText}"\nNew: "${input.premiseText}"`;
      case 'retracted':
        return `A fact was retracted (no longer true):\n"${input.premiseText}"`;
      case 'expired':
        return `A fact has expired (time-bound, no longer current):\n"${input.premiseText}"`;
    }
  }

  /** Generate embedding from text, normalizing the return type. */
  private async embed(text: string): Promise<number[]> {
    const result = await this.embeddingGenerator.generate(text);
    return Array.isArray(result[0]) ? result[0] as number[] : result as number[];
  }
}
