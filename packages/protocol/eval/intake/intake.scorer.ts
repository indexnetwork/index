import { FALLBACK_BRING_QUESTION, type FollowUpPlan } from "../../src/intents/application/intake.orchestrator.js";

import type { IntakeEvalCase, IntakeEvalResult } from "./intake.types.js";

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsTerm(value: string, terms: string[]): boolean {
  const haystack = ` ${normalize(value)} `;
  return terms.some((term) => haystack.includes(` ${normalize(term)} `));
}

/** Natural-language criteria for the independent live semantic judge. */
export function buildJudgeCriteria(c: IntakeEvalCase): string {
  const answeredRounds = c.input.rounds
    .map((round) => `${round.prompt} => ${[...round.answer.selectedOptions, round.answer.freeText ?? ""].filter(Boolean).join(", ")}`)
    .join("\n");
  return `Evaluate whether this signal-intake follow-up is answer-first.

Answered rounds (primary evidence):
${answeredRounds}

Profile brief (secondary context):
${c.input.brief}

Requirements:
1. The question prompt must explicitly identify the newly stated person/domain rather than use a dangling generic reference.
2. At least ${c.minDomainOptions} options must be natural, meaningfully distinct next choices that could have been generated from the answered rounds if the profile brief were completely hidden. Merely adding domain words to a generic or profile-driven option does not qualify.
3. At most ${c.maxProfileOptions} option(s) may depend on a role, industry, goal, capability, or theme found only in the profile brief.
4. Treat an option as profile-derived whenever it would not naturally follow without the profile, even if it plausibly intersects the newly stated domain.
5. The generic fallback question is a failure.

Interpretation rules:
- "At most ${c.maxProfileOptions}" means zero through ${c.maxProfileOptions} inclusive. Exactly one profile bridge passes when the maximum is one.
- Do NOT require answer-grounded options to reflect the profile. Their independence from the profile is the desired behavior.
- A prompt that repeats the user's named domain while asking for a missing purpose, attribute, exchange, or constraint is answer-first and does not re-ask who they want to meet.
- Do not fail merely because a concise option is broad; fail it only when it is not a meaningful path for the stated domain or when it depends on the profile.`;
}

/** Score whether a live follow-up keeps the current answer authoritative. */
export function scoreCase(c: IntakeEvalCase, output: FollowUpPlan): IntakeEvalResult {
  const question = output.questions[0];
  const promptRelevant = question ? containsTerm(question.prompt, c.promptTerms) : false;
  const optionText = (question?.options ?? []).map((option) => `${option.label} ${option.description}`);
  const domainOptionCount = optionText.filter((text) => containsTerm(text, c.domainTerms)).length;
  const profileOptionCount = optionText.filter((text) => containsTerm(text, c.profileTerms)).length;
  const usedFallback = question?.prompt === FALLBACK_BRING_QUESTION.prompt;
  return {
    caseId: c.id,
    passed: Boolean(question)
      && !usedFallback
      && promptRelevant
      && domainOptionCount >= c.minDomainOptions
      && profileOptionCount <= c.maxProfileOptions,
    promptRelevant,
    domainOptionCount,
    profileOptionCount,
    usedFallback,
    output,
  };
}
