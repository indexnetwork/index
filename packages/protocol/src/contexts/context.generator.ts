/**
 * User Context Generator
 *
 * Synthesizes context paragraphs from user premises for storage in the
 * user_contexts table. Two scopes:
 *  - network-scoped: who the person is through the lens of a given network
 *  - global (networkId = null): a cohesive, network-agnostic identity paragraph
 *    that replaces the legacy synthesized user_profile projection.
 * Each scope supports cold-start (all premises at once) and incremental
 * (single premise change applied to an existing context).
 * Returns { text, embedding } for storage.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { createResilientModel } from "../shared/agent/model.config.js";
import { getAbortSignalConfig, invokeWithAbortSignal } from "../shared/agent/model-signal.js";
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

/** Input for cold-start global (network-agnostic) context generation. */
export interface GlobalContextInput {
  premises: Array<{ text: string }>;
}

/** Input for incremental global context update from a single premise change. */
export interface GlobalIncrementalContextInput {
  currentContext: string;
  changeType: 'added' | 'updated' | 'retracted' | 'expired';
  premiseText: string;
  previousPremiseText?: string;
}

/** Generated context paragraph with its embedding vector. */
export interface UserContextResult {
  text: string;
  embedding: number[];
}

const COLD_START_SYSTEM_PROMPT = `You synthesize user context paragraphs for community matching. Given a list of premises (atomic facts about a person) and a network description, write a focused paragraph (3-6 sentences) that captures who this person is through the lens of that network's purpose. Highlight what is most relevant to the network. Write in third person. Be specific and concrete, not generic.`;

const INCREMENTAL_SYSTEM_PROMPT = `You maintain user context paragraphs for community matching. You will receive the current context paragraph, a change that occurred, and the network description. Update the context paragraph to reflect the change while preserving all other information. Keep the same style: 3-6 sentences, third person, specific and concrete. For retractions/expirations, remove the relevant information. For additions/updates, integrate the new information naturally.`;

const GLOBAL_COLD_START_SYSTEM_PROMPT = `You synthesize a person's global identity profile from premises (atomic facts about them). Write a cohesive paragraph (4-8 sentences) capturing who this person is overall — their identity, work, expertise, and interests — independent of any single community or network. This is their canonical self-description, not lensed toward any particular purpose. Write in third person. Be specific and concrete, not generic. Do not invent facts beyond the premises.`;

const GLOBAL_INCREMENTAL_SYSTEM_PROMPT = `You maintain a person's global identity profile. You will receive the current profile paragraph and a change that occurred. Update the paragraph to reflect the change while preserving all other information. Keep the same style: 4-8 sentences, third person, specific and concrete, network-agnostic. For retractions/expirations, remove the relevant information. For additions/updates, integrate the new information naturally.`;

/**
 * Generates network-scoped context paragraphs from user premises.
 * Uses LLM synthesis to produce focused context and an embedding vector.
 */
export class UserContextGenerator {
  private model = createResilientModel('userContextGenerator');

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

    const response = await invokeWithAbortSignal(this.model, [
      new SystemMessage(COLD_START_SYSTEM_PROMPT),
      new HumanMessage(
        `${networkContext}\n\nPremises:\n${premiseBlock}\n\nWrite a focused context paragraph for this person in this network.`,
      ),
    ]);

    const text = this.extractText(response.content);

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

    const response = await invokeWithAbortSignal(this.model, [
      new SystemMessage(INCREMENTAL_SYSTEM_PROMPT),
      new HumanMessage(
        `${networkContext}\n\nCurrent context:\n${input.currentContext}\n\nChange:\n${changeDescription}\n\nWrite the updated context paragraph.`,
      ),
    ]);

    const text = this.extractText(response.content);

    const embedding = await this.embed(text);
    return { text, embedding };
  }

  /**
   * Generate a global (network-agnostic) identity paragraph from the full set
   * of premises (cold-start). This is the profile-replacing projection stored
   * as the user's global user_context row (networkId = null).
   *
   * @param input - The user's active premises
   * @returns Synthesized global identity text with embedding vector
   */
  async generateGlobalColdStart(input: GlobalContextInput): Promise<UserContextResult> {
    const premiseBlock = input.premises.map(p => `- ${p.text}`).join('\n');

    const response = await invokeWithAbortSignal(this.model, [
      new SystemMessage(GLOBAL_COLD_START_SYSTEM_PROMPT),
      new HumanMessage(
        `Premises:\n${premiseBlock}\n\nWrite a cohesive global identity paragraph for this person.`,
      ),
    ]);

    const text = this.extractText(response.content);

    const embedding = await this.embed(text);
    return { text, embedding };
  }

  /**
   * Update the global identity paragraph after a single premise change.
   *
   * @param input - Current global context and change details
   * @returns Updated global identity text with embedding vector
   */
  async generateGlobalIncremental(input: GlobalIncrementalContextInput): Promise<UserContextResult> {
    const changeDescription = this.describeChange(input);

    const response = await invokeWithAbortSignal(this.model, [
      new SystemMessage(GLOBAL_INCREMENTAL_SYSTEM_PROMPT),
      new HumanMessage(
        `Current profile:\n${input.currentContext}\n\nChange:\n${changeDescription}\n\nWrite the updated global identity paragraph.`,
      ),
    ]);

    const text = this.extractText(response.content);

    const embedding = await this.embed(text);
    return { text, embedding };
  }

  /** Normalize an LLM message content into a plain string. */
  private extractText(content: unknown): string {
    return typeof content === 'string'
      ? content
      : String(content ?? '').trim();
  }

  /** Format the network context header for LLM prompts. */
  private formatNetworkContext(prompt: string | null, title: string): string {
    return prompt
      ? `Network "${title}": ${prompt}`
      : `Network: ${title}`;
  }

  /** Describe the premise change for the incremental prompt. */
  private describeChange(input: IncrementalContextInput | GlobalIncrementalContextInput): string {
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
    const result = await this.embeddingGenerator.generate(text, undefined, getAbortSignalConfig());
    return Array.isArray(result[0]) ? result[0] as number[] : result as number[];
  }
}
