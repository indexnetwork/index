import { createModel, type Model } from '@indexnetwork/agent';
import { generateText, isStepCount, type ModelMessage } from 'ai';

import { log } from '../log';
import { PERSONAL_INSTRUCTIONS } from './personal-agent.instructions';
import { personalAgentTools } from './personal-agent.tools';

const logger = log.lib.from('personal-agent/personal-agent');

/** Enough steps to look things up, act, and confirm; a runaway loop stops here. */
const MAX_STEPS = 10;
const MAX_TOKENS = 2048;
const STEP_TIMEOUT_MS = 90_000;
/** How much of the chat the model rereads each turn. */
export const HISTORY_TURNS = 24;


/** Message text from stored message parts. */
export function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (part && typeof part === 'object' && (part as { kind?: unknown }).kind === 'text' ? String((part as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

let model: Model | null = null;
/** The model the personal agent speaks with. */
export function personalModel(): Model {
  model ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/personal-agent', 'X-Title': 'Index Personal Agent' },
  });
  return model;
}

export interface PersonalAgentTurn {
  role: 'user' | 'agent';
  text: string;
}

export interface PersonalAgentReply {
  text: string;
  /** Tools that changed something, so the client knows to refresh. */
  changed: string[];
}

/**
 * Run one turn of the personal agent: read the conversation so far, act with the
 * Index MCP tools for this owner, and answer.
 *
 * @param input - The owner, their name, and the conversation ending with their new message.
 * @returns The agent's answer and what it changed.
 * @throws When the model call fails.
 */
export async function runPersonalAgent(input: { userId: string; userName?: string | null; turns: PersonalAgentTurn[] }): Promise<PersonalAgentReply> {
  const { tools, changed } = personalAgentTools(input.userId);
  const messages: ModelMessage[] = input.turns
    .filter((turn) => turn.text.trim())
    .map((turn) => (turn.role === 'user'
      ? { role: 'user' as const, content: turn.text }
      : { role: 'assistant' as const, content: turn.text }));

  const today = new Date().toISOString().slice(0, 10);
  const who = input.userName ? `You act for ${input.userName}. ` : '';
  const result = await generateText({
    model: personalModel(),
    instructions: `${PERSONAL_INSTRUCTIONS}\n\n${who}Today is ${today}.`,
    messages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    toolCallConcurrency: 1,
    maxOutputTokens: MAX_TOKENS,
    providerOptions: {
      openrouter: {
        user: input.userId,
        trace: { trace_name: 'personal-agent', generation_name: 'turn' },
        metadata: { service: 'personal-agent', operation: 'turn' },
      },
    },
    maxRetries: 1,
    timeout: { stepMs: STEP_TIMEOUT_MS },
  });

  const text = result.text.trim();
  if (!text) logger.warn('personal agent ended without text', { userId: input.userId, steps: result.steps.length, changed });
  return {
    text: text || (changed.length ? 'done.' : "i couldn't work that out. can you say it another way?"),
    changed,
  };
}
