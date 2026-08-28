/**
 * Colour, measurement and the two line formats the panes are made of.
 *
 * Everything here is ANSI-aware: the TUI has to know how wide a coloured
 * string *looks* to lay it out, which is not how long it is.
 */
import type { AgentTurn, Direction, Step } from "../src/index.ts";

const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const sgr = (n: string) => (text: string) => (enabled ? `\x1b[${n}m${text}\x1b[0m` : text);

export const bold = sgr("1");
export const dim = sgr("2");
export const inverse = sgr("7");
export const red = sgr("31");
export const green = sgr("32");
export const yellow = sgr("33");
export const blue = sgr("34");
export const magenta = sgr("35");
export const cyan = sgr("36");

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ESCAPE = /\x1b\[[0-9;]*m/g;

/** How wide the string looks once the escape sequences are gone. */
export function width(text: string): number {
  return text.replace(ESCAPE, "").length;
}

/** Cuts to `max` visible columns, keeping escape sequences intact. */
export function clip(text: string, max: number): string {
  if (width(text) <= max) return text;

  let visible = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const escape = match(text, i);
    if (escape) {
      out += escape;
      i += escape.length - 1;
      continue;
    }
    if (visible >= max - 1) break;
    out += text[i];
    visible++;
  }
  return `${out}…\x1b[0m`;
}

/** Pads to exactly `size` visible columns. */
export function pad(text: string, size: number): string {
  const clipped = clip(text, size);
  return clipped + " ".repeat(Math.max(0, size - width(clipped)));
}

/**
 * Wraps to `size` columns, breaking on spaces where it can. Wrapped rows
 * carry the last colour forward, so a coloured span that spills over a
 * line break doesn't lose its colour halfway.
 */
export function wrap(text: string, size: number, indent = 0): string[] {
  if (size < 4) return [text];

  const rows: string[] = [];
  const prefix = " ".repeat(indent);
  let row = "";
  let visible = 0;
  let colour = "";
  let word = "";
  let wordWidth = 0;

  const flush = () => {
    rows.push(row);
    row = colour ? `${prefix}${colour}` : prefix;
    visible = indent;
  };

  const take = () => {
    if (!word) return;
    if (visible + wordWidth > size && visible > indent) flush();
    row += word;
    visible += wordWidth;
    word = "";
    wordWidth = 0;
  };

  for (let i = 0; i < text.length; i++) {
    const escape = match(text, i);
    if (escape) {
      word += escape;
      colour = escape === "\x1b[0m" ? "" : escape;
      i += escape.length - 1;
      continue;
    }

    const character = text[i]!;
    if (character === " ") {
      take();
      if (visible >= size) flush();
      else {
        row += " ";
        visible++;
      }
      continue;
    }

    // A word longer than the pane has to break somewhere.
    if (wordWidth >= size - indent) take();
    word += character;
    wordWidth++;
  }

  take();
  if (row.trim() || !rows.length) rows.push(row);
  return rows;
}

function match(text: string, index: number): string | null {
  if (text[index] !== "\x1b") return null;
  ESCAPE.lastIndex = index;
  const found = ESCAPE.exec(text);
  ESCAPE.lastIndex = 0;
  return found?.index === index ? found[0] : null;
}

// --- the two line formats --------------------------------------------

/** A step of an agent run, for the chat pane. The final message and the
 * question are rendered by the caller, which knows where they belong. */
export function formatStep(step: Step): string[] {
  if (step.kind === "message" || step.kind === "ask") return [];

  const args = short(step.input, 100);
  const head = `${magenta("⚒")} ${bold(step.name)}${args ? dim(` ${args}`) : ""}`;

  if (step.error) return [head, `  ${red(`✗ ${short(step.error, 200)}`)}`];
  const output = summarize(step.name, step.output);
  return output ? [head, `  ${dim(`→ ${output}`)}`] : [head];
}

/** A negotiation turn, for the negotiation pane. Rendered as speech,
 * since that is what it is. */
export function formatTurn(self: string, turn: AgentTurn, direction: Direction): string {
  const mine = turn.speaker === "self";
  const arrow = mine ? green("▸") : blue("◂");
  const who = mine ? self : "them";
  const tag = dim(`(${turn.decision.action}${direction === "inbound" && mine ? ", reply" : ""})`);
  return `${arrow} ${bold(who)} ${tag} ${turn.decision.message}`;
}

/** Negotiation tool results repeat what the turns already said, so they
 * collapse to the state that matters. */
function summarize(name: string, output: unknown): string {
  if (output === undefined) return "";

  if (name.startsWith("negotiate_") && output && typeof output === "object") {
    const turn = output as {
      id?: string;
      state?: string;
      done?: boolean;
      settlement?: { outcome?: string; basis?: string };
    };
    const verdict = turn.settlement
      ? `${turn.settlement.outcome}/${turn.settlement.basis}`
      : turn.done && "done";
    return [turn.id && turn.id.slice(0, 8), turn.state, verdict]
      .filter(Boolean)
      .join(" · ");
  }
  return short(output, 120);
}

/** Leading spaces, ignoring any colour that comes before them. Wrapped
 * rows hang under the text they continue rather than at a fixed column. */
export function indentOf(text: string): number {
  const bare = text.replace(ESCAPE, "");
  return bare.length - bare.trimStart().length;
}

export function short(value: unknown, max = 160): string {
  if (value === null || value === undefined) return "";
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
