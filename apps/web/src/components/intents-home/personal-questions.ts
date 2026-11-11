import type { PrincipalQuestion } from "@/services/conversation";

/**
 * One question card on Home: a group of questions from your intents that ask
 * for the same thing. `id` and `intentId` are the question the card speaks
 * through; answering it answers every question in the group.
 */
export interface PersonalQuestion extends PrincipalQuestion {
  groupId: string;
  intentId: string;
  intentIds: string[];
  questionIds: string[];
}

/** @returns The cards still waiting, without any group one of whose questions was just answered. */
export function withoutAnswered(cards: PersonalQuestion[], answered: ReadonlySet<string>): PersonalQuestion[] {
  return cards.filter((card) => !card.questionIds.some((questionId) => answered.has(questionId)));
}

/** @returns Every intent whose agent goes back to work after this answer. */
export function intentsToRefresh(cards: PersonalQuestion[], questionId: string, intentId: string): string[] {
  return cards.find((card) => card.questionIds.includes(questionId))?.intentIds ?? [intentId];
}

/** @returns The group holding question `q` (from a `/q/<id>` link), or null. */
export function focusedGroup(cards: { groupId: string; questionIds: string[] }[], q: string | null): string | null {
  if (!q) return null;
  return cards.find((card) => card.questionIds.includes(q))?.groupId ?? null;
}
