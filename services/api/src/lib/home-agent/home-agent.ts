import { createModel, type Model } from '@indexnetwork/agent';
import { generateText, isStepCount, type ModelMessage } from 'ai';

import { log } from '../log';
import { MCP_INSTRUCTIONS } from '../mcp/mcp.instructions';

import { homeAgentTools } from './home-agent.tools';

const logger = log.lib.from('home-agent/home-agent');

/** Enough steps to look things up, act, and confirm; a runaway loop stops here. */
const MAX_STEPS = 10;
const MAX_TOKENS = 2048;
const STEP_TIMEOUT_MS = 90_000;
/** How much of the home conversation the model rereads each turn. */
export const HISTORY_TURNS = 24;

const HOME_INSTRUCTIONS = `You are the person's own Index agent, talking with them on their Index home screen. You act for them with the Index tools below, and only for them.

How to talk:
- Speak as "I". Be short and plain: one to four sentences, or a short list. Lowercase is fine. Never use em dashes.
- When you list intents or people, give each a short linked name of 3 to 5 words, not the full text. With more than 8, show the most relevant 8 and say how many more there are.
- Do what they ask with the tools, then say what you did and link it. Don't describe tools or ask permission for read-only lookups.
- When something is unclear (which intent they mean, what they're looking for), ask one short question instead of guessing.
- Before you archive an intent, or accept or pass on a match, make sure they clearly said so in this conversation. If they haven't, ask first.
- To start an intent, write it in their words with create_intent. If it comes back needing revision, show them the proposed wording and ask before trying again.

What follows is the standing guidance for the Index tools.`;

/** Message text from stored message parts. */
export function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (part && typeof part === 'object' && (part as { kind?: unknown }).kind === 'text' ? String((part as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

let model: Model | null = null;
function homeModel(): Model {
  model ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/home-agent', 'X-Title': 'Index Home Agent' },
  });
  return model;
}

export interface HomeAgentTurn {
  role: 'user' | 'agent';
  text: string;
}

export interface HomeAgentReply {
  text: string;
  /** Tools that changed something, so the client knows to refresh. */
  changed: string[];
}

/**
 * Run one turn of the home agent: read the conversation so far, act with the
 * Index MCP tools for this owner, and answer.
 *
 * @param input - The owner, their name, and the conversation ending with their new message.
 * @returns The agent's answer and what it changed.
 * @throws When the model call fails.
 */
export async function runHomeAgent(input: { userId: string; userName?: string | null; turns: HomeAgentTurn[] }): Promise<HomeAgentReply> {
  const { tools, changed } = homeAgentTools(input.userId);
  const messages: ModelMessage[] = input.turns
    .filter((turn) => turn.text.trim())
    .map((turn) => (turn.role === 'user'
      ? { role: 'user' as const, content: turn.text }
      : { role: 'assistant' as const, content: turn.text }));

  const today = new Date().toISOString().slice(0, 10);
  const who = input.userName ? `You act for ${input.userName}. ` : '';
  const result = await generateText({
    model: homeModel(),
    instructions: `${HOME_INSTRUCTIONS}\n\n${MCP_INSTRUCTIONS}\n\n${who}Today is ${today}.`,
    messages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    toolCallConcurrency: 1,
    maxOutputTokens: MAX_TOKENS,
    providerOptions: {
      openrouter: {
        user: input.userId,
        trace: { trace_name: 'home-agent', generation_name: 'turn' },
        metadata: { service: 'home-agent', operation: 'turn' },
      },
    },
    maxRetries: 1,
    timeout: { stepMs: STEP_TIMEOUT_MS },
  });

  const text = result.text.trim();
  if (!text) logger.warn('home agent ended without text', { userId: input.userId, steps: result.steps.length, changed });
  return {
    text: text || (changed.length ? 'done.' : "i couldn't work that out. can you say it another way?"),
    changed,
  };
}
