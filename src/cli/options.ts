import { Negotiator } from "../core/negotiator.ts";
import { dim } from "./ui.ts";

/** Actions used when `--actions` isn't given — the vocabulary the README
 * and examples use. The library has no default vocabulary of its own, only
 * default terminal actions (accept/reject/decline/withdraw), and those
 * already end on `accept` and `decline`, so this needs no `--terminal`. */
export const DEFAULT_ACTIONS = ["propose", "refine", "accept", "decline"];

const DEFAULT_TERMINAL_ACTIONS = new Set(["accept", "reject", "decline", "withdraw"]);

/** Parses a `--actions propose,refine,accept` list, falling back to the
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

/** Parses `--fallback a,b` into the models to route to when the primary
 * fails. Unset keeps the library default; `none` turns fallback off. */
export function parseFallback(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().toLowerCase() === "none") return [];
  const models = raw
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new Error("--fallback was given but empty (use `none` to disable fallback)");
  }
  return models;
}

/** Builds a Negotiator, turning a missing API key into a CLI-friendly
 * message rather than a raw constructor throw. Fallbacks are announced
 * as they happen so a transcript never silently changes model. */
export function buildNegotiator(model: string | undefined, fallback?: string | undefined): Negotiator {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Export it, or put it in a .env file in the current directory.",
    );
  }
  const fallbackModels = parseFallback(fallback);
  return new Negotiator({
    ...(model ? { model } : {}),
    ...(fallbackModels ? { fallbackModels } : {}),
    onFallback: (used) => console.log(dim(`    (answered by fallback model ${used})`)),
  });
}

export function requireOption(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
