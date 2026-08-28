import { Negotiator } from "../core/negotiator.ts";

/** Actions used when `--actions` isn't given — the price-negotiation
 * vocabulary the library defaults to elsewhere. */
export const DEFAULT_ACTIONS = ["propose", "counter", "accept", "reject"];

const DEFAULT_TERMINAL_ACTIONS = new Set(["accept", "reject", "decline", "withdraw"]);

/** Parses a `--actions propose,counter,accept` list, falling back to the
 * default vocabulary. */
export function parseActions(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ACTIONS;
  const actions = raw
    .split(",")
    .map((action) => action.trim())
    .filter(Boolean);
  if (actions.length === 0) {
    throw new Error("--actions was given but empty");
  }
  return actions;
}

/** Which actions end a negotiation. `--terminal` overrides the default
 * accept/reject/decline/withdraw set — needed for a custom vocabulary
 * where none of those names appear. */
export function parseTerminal(raw: string | undefined): (action: string) => boolean {
  if (!raw) return (action) => DEFAULT_TERMINAL_ACTIONS.has(action);
  const terminal = new Set(
    raw
      .split(",")
      .map((action) => action.trim())
      .filter(Boolean),
  );
  return (action) => terminal.has(action);
}

/** Builds a Negotiator, turning a missing API key into a CLI-friendly
 * message rather than a raw constructor throw. */
export function buildNegotiator(model: string | undefined): Negotiator {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Export it, or put it in a .env file in the current directory.",
    );
  }
  return new Negotiator(model ? { model } : {});
}

export function requireOption(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
