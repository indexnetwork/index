import { createModel, type Model } from '@indexnetwork/agent';
import { generateText, jsonSchema, Output } from 'ai';

import { log } from '../log';

const logger = log.lib.from('introducer/judge');

export interface JudgeInput {
  introducer: { name: string; intro: string | null; intents: string[] };
  member: { name: string; intro: string | null; intent: string };
  contact: { name: string; headline: string; socials: string[] };
}

export interface Judgment {
  mutual: boolean;
  memberGets: string;
  contactGets: string;
  memberLine: string;
  contactLine: string;
  draft: string;
  /** 0 to 100. */
  rank: number;
}

let model: Model | null = null;
function judgeModel(): Model {
  model ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/introduce', 'X-Title': 'Index Intro Desk' },
  });
  return model;
}

type Verdict = Omit<Judgment, 'rank'> & { rank: number };

const judgmentSchema = jsonSchema<Verdict>({
  type: 'object',
  properties: {
    mutual: { type: 'boolean', description: 'True only when memberGets and contactGets are both concrete.' },
    memberGets: { type: 'string', description: 'One sentence: what the member gets from meeting the contact. Empty when nothing concrete.' },
    contactGets: { type: 'string', description: 'One sentence: what the contact gets from meeting the member. Empty when nothing concrete.' },
    memberLine: { type: 'string', description: 'At most 80 characters completing "<member first name> …" with what they need, e.g. "needs a payments design partner". Lowercase, no period.' },
    contactLine: { type: 'string', description: 'At most 80 characters completing "<contact first name> …" with who they are for this pair, from their headline and links only, e.g. "runs checkout at Stripe". Lowercase, no period.' },
    draft: { type: 'string', description: "At most 1000 characters: two short sentences in the introducer's voice to both people, first names, naming what each gets. Claim nothing about the contact beyond their headline and links. No flattery, no emoji." },
    rank: { type: 'number', description: '0 to 100: how much each of them gains. Under 50 when one side gains little.' },
  },
  required: ['mutual', 'memberGets', 'contactGets', 'memberLine', 'contactLine', 'draft', 'rank'],
  additionalProperties: false,
});

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function promptFor(input: JudgeInput): string {
  const { introducer, member, contact } = input;
  const who = firstName(introducer.name);
  return [
    `You are ${who}'s personal agent. You know ${who}. Decide whether introducing these two people gives each of them something real.`,
    '',
    `${who} (the introducer)${introducer.intro ? `: ${clip(introducer.intro, 300)}` : ''}`,
    introducer.intents.length ? `What ${who} is public about wanting:\n${introducer.intents.map((t) => `- ${clip(t, 300)}`).join('\n')}` : '',
    '',
    `${firstName(member.name)} (a member of ${who}'s network)${member.intro ? `: ${clip(member.intro, 300)}` : ''}`,
    `${firstName(member.name)} wants: ${clip(member.intent, 300)}`,
    '',
    `${firstName(contact.name)} (someone ${who} knows, not on Index). All we know about them:`,
    contact.headline ? `Headline: ${clip(contact.headline, 300)}` : 'Headline: none',
    contact.socials.length ? `Links: ${contact.socials.slice(0, 6).join(', ')}` : 'Links: none',
    '',
    'Rules:',
    `- Set mutual to true only when both memberGets and contactGets are concrete: something ${firstName(member.name)} can use now, and something ${firstName(contact.name)} would plausibly want.`,
    `- Do not guess what ${firstName(contact.name)} wants from a shared topic alone. A shared topic is not a reason for either of them.`,
    `- Claim nothing about ${firstName(contact.name)} beyond the headline and links above.`,
    '- When mutual is false, still fill every field with your best short text.',
    `- The draft is two sentences in ${who}'s voice, naming what each of them gets. Plain and specific. No flattery, no hype, no emoji.`,
    '- memberLine and contactLine are at most 80 characters each; the draft is at most 1000.',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
}

/** Whether introducing these two gives each something real; null when the model fails or returns something unusable. */
export async function judgePair(input: JudgeInput): Promise<Judgment | null> {
  let output: Verdict | undefined;
  try {
    ({ output } = await generateText({
      model: judgeModel(),
      output: Output.object({ schema: judgmentSchema }),
      prompt: promptFor(input),
    }));
  } catch (error) {
    logger.warn('Judging a pair failed', { error: String(error) });
    return null;
  }
  if (!output || typeof output.mutual !== 'boolean' || !Number.isFinite(output.rank)) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const memberGets = text(output.memberGets);
  const contactGets = text(output.contactGets);
  const memberLine = clip(text(output.memberLine), 80);
  const contactLine = clip(text(output.contactLine), 80);
  const draft = clip(text(output.draft), 1000);
  if (output.mutual && (!memberGets || !contactGets || !memberLine || !contactLine || !draft)) return null;
  return {
    mutual: output.mutual,
    memberGets, contactGets, memberLine, contactLine, draft,
    rank: Math.min(100, Math.max(0, output.rank)),
  };
}
