/**
 * Home Categorizer Agent
 *
 * Takes a list of presenter-produced opportunity cards and returns dynamic sections
 * with CTA-style titles and Lucide icon names. Used by the home graph after
 * generateCardText.
 */

import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

import type { HomeSectionProposal } from './feed.state.js';
import { getIconNamesForPrompt, DEFAULT_HOME_SECTION_ICON } from '../../shared/ui/lucide.icon-catalog.js';
import { protocolLogger } from '../../shared/observability/protocol.logger.js';
import { Timed } from "../../shared/observability/performance.js";
import { createModel } from "../../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";

const logger = protocolLogger('HomeCategorizer');

const categorizationSchema = z.object({
  sections: z.array(
    z.object({
      id: z.string().describe('Short kebab-case id for the section'),
      title: z
        .string()
        .describe(
          'Call-to-action style section heading (e.g. REACH OUT NOW, YOUR MOVE, CONNECTIONS WAITING FOR YOU)'
        ),
      subtitle: z.string().nullable().describe('Optional one-line description; use null if none'),
      iconName: z.string().describe('Lucide icon name in kebab-case from the allowed list'),
      itemIndices: z.array(z.number()).describe('Indices of cards in this section (0-based)'),
    })
  ),
});

export type CategorizerInputItem = {
  index: number;
  headline?: string;
  mainText: string;
  name: string;
  viewerRole?: string;
  opportunityStatus?: string;
};

export type CategorizerResult = {
  sections: HomeSectionProposal[];
};

const UNCATEGORIZED_SECTION_ID = 'uncategorized';
const UNCATEGORIZED_SECTION_TITLE = 'UNCATEGORIZED OPPORTUNITIES';

/** Single-section fallback grouping every card under one generic heading. */
function buildFallbackResult(cards: CategorizerInputItem[]): CategorizerResult {
  return {
    sections: [
      {
        id: 'opportunities',
        title: 'OPPORTUNITIES',
        iconName: DEFAULT_HOME_SECTION_ICON,
        itemIndices: cards.map((c) => c.index),
      },
    ],
  };
}

/**
 * Build card summaries for the categorizer prompt.
 */
function buildCardSummaries(cards: CategorizerInputItem[]): string {
  return cards
    .map((c) => {
      const role = c.viewerRole ?? 'party';
      const status = c.opportunityStatus ?? 'pending';
      return `[${c.index}] role=${role}; status=${status}; ${c.headline ?? c.mainText.slice(0, 60)}... (${c.name})`;
    })
    .join('\n');
}

function reconcileSections(sections: HomeSectionProposal[], maxIndex: number): HomeSectionProposal[] {
  const assigned = new Set<number>();

  const normalizedSections = sections.map((section) => {
    const uniqueIndices = Array.from(
      new Set(section.itemIndices.filter((index) => index >= 0 && index <= maxIndex))
    ).sort((a, b) => a - b);

    for (const index of uniqueIndices) {
      assigned.add(index);
    }

    return {
      ...section,
      itemIndices: uniqueIndices,
    };
  });

  const missingIndices: number[] = [];
  for (let index = 0; index <= maxIndex; index += 1) {
    if (!assigned.has(index)) {
      missingIndices.push(index);
    }
  }

  if (missingIndices.length === 0) {
    return normalizedSections;
  }

  const fallbackSection = normalizedSections.find((section) => section.id === UNCATEGORIZED_SECTION_ID);
  if (fallbackSection) {
    fallbackSection.itemIndices = Array.from(
      new Set([...fallbackSection.itemIndices, ...missingIndices])
    ).sort((a, b) => a - b);
    return normalizedSections;
  }

  return [
    ...normalizedSections,
    {
      id: UNCATEGORIZED_SECTION_ID,
      title: UNCATEGORIZED_SECTION_TITLE,
      iconName: DEFAULT_HOME_SECTION_ICON,
      itemIndices: missingIndices,
    },
  ];
}

export class HomeCategorizerAgent {
  private model: ReturnType<ChatOpenAI['withStructuredOutput']>;

  constructor() {
    const llm = createModel("homeCategorizer");
    this.model = llm.withStructuredOutput(categorizationSchema, { name: 'home_sections' });
  }

  /**
   * Categorize presenter-produced cards into 1–5 sections with CTA-style titles and icons.
   */
  @Timed()
  async categorize(cards: CategorizerInputItem[]): Promise<CategorizerResult> {
    if (cards.length === 0) {
      return { sections: [] };
    }
    const iconList = getIconNamesForPrompt();
    const cardSummaries = buildCardSummaries(cards);
    const maxIndex = cards.length - 1;

    const systemPrompt = `You are organizing connection opportunities into dynamic sections for a user's home feed.

Given a list of opportunity cards (each with index, headline/summary, and name), group them into 1–5 sections.

Each section must have:
- id: short kebab-case identifier (e.g. waiting-for-action, your-perspective, connector)
- title: CALL-TO-ACTION style section heading in uppercase. Write as an action or invitation, not a neutral label. Examples: REACH OUT NOW, YOUR MOVE, CONNECTIONS WAITING FOR YOU, INTROS READY TO SEND, PEOPLE YOU SHOULD MEET
- subtitle: optional one-line description
- iconName: exactly ONE icon from this list (use the name as-is): ${iconList}
- itemIndices: array of card indices that belong in this section (each index 0 to ${maxIndex} at most once)

Rules:
- Use only icon names from the list above.
- Every card index must appear in exactly one section.
- Section titles must read as calls-to-action or invitations, not passive labels.
- If a card has role=introducer and status=pending, prioritize grouping those cards under a connector curation section with a CTA title like "YOU'RE THE CONNECTOR THEY NEED", "MAKE THE INTRO", or "DECIDE IF IT'S A GOOD MATCH".`;

    const userContent = `Cards to categorize:\n${cardSummaries}\n\nOutput sections with id, title (CTA-style), subtitle (optional), iconName, and itemIndices.`;

    try {
      const result = await invokeWithAbortSignal(this.model, [
        new SystemMessage(systemPrompt),
        new HumanMessage(userContent),
      ]);
      const parsed = categorizationSchema.safeParse(result);
      if (!parsed.success) {
        logger.warn('HomeCategorizer parse failed', { error: parsed.error });
        return buildFallbackResult(cards);
      }
      const sections: HomeSectionProposal[] = parsed.data.sections.map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle ?? undefined,
        iconName: s.iconName,
        itemIndices: s.itemIndices.filter((i) => i >= 0 && i <= maxIndex),
      }));
      const reconciledSections = reconcileSections(sections, maxIndex);
      return { sections: reconciledSections };
    } catch (e) {
      const err = e instanceof Error ? { message: e.message, name: e.name } : String(e);
      logger.error('HomeCategorizer categorize failed', { error: err });
      return buildFallbackResult(cards);
    }
  }
}
