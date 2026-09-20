import type { Intent, Profile } from "../agent.context.js";

/**
 * Explains the human-principal relationship and adds the current UTC date and intent scope.
 * @param input - Agent policy, principal profile, current intent, and optional prompt clock.
 * @returns Prepared instructions shared by direct and native reasoning execution.
 */
export function prepareInstructions(input: {
  instructions: string;
  profile: Pick<Profile, "name" | "profileConfirmed">;
  intent: Intent;
  now?: () => Date;
}): string {
  const today = (input.now ?? (() => new Date()))().toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const principalName = input.profile.profileConfirmed ? input.profile.name?.trim() : undefined;

  return [
    input.instructions,
    "You are an AI agent acting on behalf of a person, referred to as your principal.",
    ...(principalName ? [`Your principal is ${principalName}.`] : []),
    `Today is ${today}. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.`,
    `Current intent: ${input.intent.statement}\nEverything you do in this run serves that intent. If something falls outside it, say so rather than acting.`,
  ].join("\n\n");
}
