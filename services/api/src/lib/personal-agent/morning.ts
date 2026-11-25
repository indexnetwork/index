import type { Model } from '@indexnetwork/agent';
import { generateText } from 'ai';

import { PERSONAL_INSTRUCTIONS } from './personal-agent.instructions';

/** A question group in the morning message, linked to Home. */
export interface MorningGroup {
  id: string;
  question: string;
  url: string;
}

export interface MorningPerson {
  opportunityId: string;
  userId: string;
  name: string;
  context: string | null;
  fresh: boolean;
}

/** One morning, as the personal agent says it in chat and by email. */
export interface Morning {
  /** The person's name; the message greets them by first name. */
  name: string;
  opening: string;
  waiting: MorningPerson[];
  groups: MorningGroup[];
}

/** What the personal agent reads to write the opening. */
export interface OpeningInput {
  name: string;
  /** The intent agents' notes since the last morning. */
  reports: { intent: string; text: string }[];
  talked: number;
  waitingNames: string[];
  groupCount: number;
}

const MORNING_TASK = `Write the first lines of this morning's message to them: at most two sentences about what their intent agents did since yesterday. Do not greet them: the message already starts with "Good morning, <their first name>." Do not name the people waiting on them or repeat the questions; both are listed below your lines. If nothing happened worth saying, say so in one sentence.`;

/** A morning waits on its opening this long, then uses the plain one. */
export const OPENING_TIMEOUT_MS = 30_000;

const SENTENCE = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g;

/** @returns The text cut to its first two sentences, or null when there is none. */
export function clipOpening(text: string | null | undefined): string | null {
  const sentences = (text ?? '').trim().match(SENTENCE)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  return sentences.length ? sentences.slice(0, 2).join(' ') : null;
}

/** The opening code writes when the model cannot: how many people their agents talked with. */
export function fallbackOpening(talked: number): string {
  if (!talked) return "Here's what needs you this morning.";
  return `Since yesterday I've talked with the agents of ${talked === 1 ? '1 person' : `${talked} people`}.`;
}

/** @returns "Good morning, <first name>." */
export function greeting(name: string): string {
  return `Good morning, ${name.trim().split(/\s+/)[0] || 'there'}.`;
}

/**
 * Ask the personal agent for this morning's opening.
 *
 * @returns Its lines, unclipped, or null when it wrote nothing.
 * @throws When the model call fails; the caller falls back.
 */
export async function writeOpening(input: OpeningInput, model: Model, timeoutMs = OPENING_TIMEOUT_MS): Promise<string | null> {
  const reports = input.reports.length
    ? input.reports.map((report) => `${report.intent}: ${report.text}`).join('\n')
    : 'No intent agent reported anything.';
  const result = await generateText({
    model,
    instructions: `${PERSONAL_INSTRUCTIONS}\n\n${MORNING_TASK}`,
    prompt: [
      `You are writing to ${input.name}.`,
      `Their intent agents talked with the agents of ${input.talked} people since yesterday.`,
      `${input.waitingNames.length} people are waiting on them; ${input.groupCount} questions need them.`,
      '',
      'What the intent agents reported:',
      reports,
    ].join('\n'),
    maxOutputTokens: 300,
    maxRetries: 1,
    // Mornings go out one owner after another: a hung call must not hold the rest.
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return result.text.trim() || null;
}

/** The morning as a chat message: the opening, then who is waiting and what to answer, as links. */
export function morningChatText(morning: Morning, appUrl = 'https://index.network'): string {
  const lines = [`${greeting(morning.name)} ${morning.opening}`];
  if (morning.waiting.length) {
    lines.push('', morning.waiting.length === 1 ? 'Waiting on you:' : `${morning.waiting.length} people waiting on you:`);
    for (const person of morning.waiting) lines.push(`- [${person.name}](${appUrl}/u/${person.userId})${person.context ? `: ${person.context}` : ''}`);
  }
  if (morning.groups.length) {
    lines.push('', morning.groups.length === 1 ? 'One thing I need from you:' : 'A few things I need from you:');
    for (const group of morning.groups) lines.push(`- [${group.question}](${group.url})`);
  }
  return lines.join('\n');
}
