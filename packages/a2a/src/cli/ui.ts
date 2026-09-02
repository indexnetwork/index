/** Terminal formatting helpers for the CLI. Colors are disabled when
 * stdout isn't a TTY or NO_COLOR is set, so piped output stays clean. */

const enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(code: number, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const dim = (text: string) => wrap(2, text);
export const bold = (text: string) => wrap(1, text);
export const red = (text: string) => wrap(31, text);
export const green = (text: string) => wrap(32, text);
export const yellow = (text: string) => wrap(33, text);
export const cyan = (text: string) => wrap(36, text);
export const magenta = (text: string) => wrap(35, text);

/** Colors a speaker's name so the two sides of a negotiation stay visually
 * distinct; `side` alternates 0/1. */
export function speaker(name: string, side: 0 | 1): string {
  return bold(side === 0 ? cyan(name) : magenta(name));
}

/** Prints one negotiation turn: `Name (action) message`. */
export function printTurn(name: string, side: 0 | 1, action: string, message: string): void {
  console.log(`${speaker(name, side)} ${dim(`(${action})`)} ${message}`);
}

export function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${red("error:")} ${message}`);
}
