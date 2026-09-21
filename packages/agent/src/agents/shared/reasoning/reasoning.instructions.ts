/**
 * Adds shared principal and intent guidance and the current UTC date without repeating context data.
 * @param input - Agent policy and optional prompt clock; principal evidence belongs in the prompt.
 * @returns Prepared instructions shared by direct and native reasoning execution.
 */
export function prepareInstructions(input: {
  instructions: string;
  now?: () => Date;
}): string {
  const today = (input.now ?? (() => new Date()))().toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return [
    input.instructions,
    "You are an AI agent acting on behalf of a person, referred to as your principal.",
    `Today is ${today}. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.`,
    "The prompt supplies your principal's confirmed profile and principalIntent. Everything you do in this run serves that intent. If something falls outside it, say so rather than acting.",
  ].join("\n\n");
}
