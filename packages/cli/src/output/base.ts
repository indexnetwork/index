/**
 * Base terminal output helpers: ANSI constants, basic messages, and
 * streaming/chat UI primitives.
 */

// ── ANSI codes ──────────────────────────────────────────────────────

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const ITALIC = "\x1b[3m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";
export const GRAY = "\x1b[90m";

// 256-color for brand tones
/** Claude orange (208) for tool call indicators. */
export const ORANGE = "\x1b[38;5;208m";
/** Soft white for agent responses — distinct from bright user prompt. */
export const AGENT_TEXT = "\x1b[38;5;252m";
/** Bright cyan for user prompt. */
export const USER_PROMPT = CYAN;

// ── Basic messages ──────────────────────────────────────────────────

/** Print an error message to stderr and optionally exit. */
export function error(message: string, exitCode?: number): void {
  console.error(`${RED}${BOLD}error${RESET}${RED}: ${message}${RESET}`);
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }
}

/** Print a success message. */
export function success(message: string): void {
  console.log(`${GREEN}${BOLD}+${RESET} ${message}`);
}

/** Print an informational message. */
export function info(message: string): void {
  console.log(`${CYAN}${message}${RESET}`);
}

/** Print a warning message. */
export function warn(message: string): void {
  console.log(`${YELLOW}${message}${RESET}`);
}

/** Print a dim/secondary message. */
export function dim(message: string): void {
  console.log(`${GRAY}${message}${RESET}`);
}

/** Print a bold heading. */
export function heading(message: string): void {
  console.log(`\n${BOLD}${message}${RESET}`);
}

// ── Chat header ─────────────────────────────────────────────────────

/** Print the branded chat header. */
export function chatHeader(): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}I N D E X${RESET}  ${GRAY}chat${RESET}`);
  console.log(`  ${GRAY}─────────────────────────────────────${RESET}`);
  console.log(`  ${GRAY}Type your message. "exit" or Ctrl+C to quit.${RESET}`);
  console.log();
}

// ── Chat prompt ─────────────────────────────────────────────────────

/** The prompt string for readline. */
export const PROMPT_STR = `${USER_PROMPT}${BOLD}> ${RESET}`;

// ── Streaming output ────────────────────────────────────────────────

/** Write raw text to stdout. */
export function raw(text: string): void {
  process.stdout.write(text);
}

/** Print a status line (overwrites current line). */
export function status(message: string): void {
  process.stderr.write(`\r  ${GRAY}${message}${RESET}\x1b[K`);
}

/** Clear the status line. */
export function clearStatus(): void {
  process.stderr.write("\r\x1b[K");
}

/** Print a persistent tool activity line (clears any status first). */
export function toolActivity(description: string): void {
  process.stderr.write(`\r\x1b[K${ORANGE}> ${description}${RESET}\n`);
}

// ── Tool descriptions ───────────────────────────────────────────────

/** Human-friendly descriptions for protocol tools (mirrors frontend). */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_user_profiles: "Reading your profile...",
  create_user_profile: "Creating your profile...",
  update_user_profile: "Updating your profile...",
  read_intents: "Fetching your active signals...",
  create_intent: "Creating a new signal...",
  update_intent: "Updating signal...",
  delete_intent: "Removing signal...",
  create_intent_index: "Saving signal to index...",
  read_intent_indexes: "Fetching signals in index...",
  delete_intent_index: "Removing signal from index...",
  read_networks: "Checking your communities...",
  create_network: "Creating a new community...",
  update_network: "Updating community...",
  delete_network: "Deleting community...",
  create_network_membership: "Adding member to community...",
  read_network_memberships: "Fetching community memberships...",
  discover_opportunities: "Searching for relevant connections...",
  list_opportunities: "Listing your opportunities...",
  update_opportunity: "Updating opportunity status...",
  scrape_url: "Reading content from URL...",
  read_docs: "Looking up documentation...",
  import_gmail_contacts: "Importing Gmail contacts...",
  import_contacts: "Importing contacts...",
  list_contacts: "Listing your contacts...",
  add_contact: "Adding contact...",
  remove_contact: "Removing contact...",
};

/** Get a human-friendly description for a raw tool name. */
export function humanizeToolName(name: string): string {
  return TOOL_DESCRIPTIONS[name] ?? name.replace(/_/g, " ") + "...";
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Word-wrap text to a maximum width. */
export function wordWrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Render a confidence percentage as a small bar. */
export function confidenceBar(confidence: number): string {
  const normalized = confidence <= 1 ? confidence * 100 : confidence;
  const pct = Math.round(normalized);
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return `${GREEN}${"#".repeat(filled)}${GRAY}${"-".repeat(empty)}${RESET} ${GRAY}${pct}%`;
}

/** Pad remaining space to fill a fixed-width card cell. */
export function padTo(cellWidth: number, plainText: string): string {
  const remaining = Math.max(0, cellWidth - plainText.length);
  return " ".repeat(remaining);
}

/** Strip ANSI escape sequences from a string. */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
