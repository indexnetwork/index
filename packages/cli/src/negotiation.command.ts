/**
 * Negotiation command handlers for the Index CLI.
 *
 * Implements: list, show subcommands.
 * Follows the handleX(client, subcommand, options) pattern.
 */

import type { ApiClient } from "./api.client";
import type { Negotiation } from "./types";
import * as output from "./output";

const NEGOTIATION_HELP = `
Usage:
  index negotiation list                        List your agent's negotiations
  index negotiation list --limit <n>            Limit results
  index negotiation list --since <date|duration> Filter by time (ISO date or duration like 1h, 2d, 1w)
  index negotiation show <id>                   Show negotiation turn-by-turn details
`;

/**
 * Route a negotiation subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, show).
 * @param options - Additional options (targetId, limit, json).
 */
export async function handleNegotiation(
  client: ApiClient,
  subcommand: string | undefined,
  options: {
    targetId?: string;
    limit?: number;
    since?: string;
    json?: boolean;
  },
): Promise<void> {
  if (!subcommand) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No subcommand provided" }));
    } else {
      console.log(NEGOTIATION_HELP);
    }
    return;
  }

  switch (subcommand) {
    case "list":
      await negotiationList(client, options.limit, options.since, options.json);
      return;

    case "show":
      if (!options.targetId) {
        output.error("Missing negotiation ID. Usage: index negotiation show <id>", 1);
        return;
      }
      await negotiationShow(client, options.targetId, options.json);
      return;

    default:
      output.error(`Unknown subcommand: ${subcommand}`, 1);
      return;
  }
}

/**
 * Parse a human-friendly duration (e.g. "1h", "2d", "1w") or ISO date string
 * into an ISO date string for the API.
 */
export function resolveSince(input: string): string {
  const match = input.match(/^(\d+)([smhdw])$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit]!;
    return new Date(Date.now() - n * ms).toISOString();
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Invalid --since value: "${input}". Use ISO date or duration like 1h, 2d, 1w.`);
  return d.toISOString();
}

/**
 * List negotiations with optional limit and since filter.
 */
async function negotiationList(
  client: ApiClient,
  limit?: number,
  since?: string,
  json?: boolean,
): Promise<void> {
  const sinceIso = since ? resolveSince(since) : undefined;
  const negotiations = await client.listNegotiations({ limit, since: sinceIso });
  if (json) { console.log(JSON.stringify(negotiations)); return; }
  output.heading("Negotiations");
  negotiationTable(negotiations);
  console.log();
}

/**
 * Show turn-by-turn details for a single negotiation (matched by prefix).
 */
async function negotiationShow(
  client: ApiClient,
  id: string,
  json?: boolean,
): Promise<void> {
  const negotiations = await client.listNegotiations({ limit: 50 });
  const match = negotiations.find(
    (n) => n.id === id || n.id.startsWith(id),
  );

  if (!match) {
    output.error(`Negotiation not found: ${id}`, 1);
    return;
  }

  if (json) { console.log(JSON.stringify(match)); return; }
  negotiationCard(match);
}

// ── Formatters ─────────────────────────────────────────────────────

const { BOLD, RESET, CYAN, GRAY, GREEN, YELLOW, BLUE, DIM } = output;

function outcomeLabel(outcome?: Negotiation["outcome"]): string {
  if (!outcome) return `${GRAY}unknown${RESET}`;
  return outcome.hasOpportunity
    ? `${GREEN}opportunity${RESET}`
    : `${GRAY}no match${RESET}`;
}

function roleLabel(role?: string): string {
  switch (role) {
    case "agent": return `${GREEN}helper${RESET}`;
    case "patient": return `${YELLOW}seeker${RESET}`;
    case "peer": return `${CYAN}peer${RESET}`;
    default: return `${GRAY}-${RESET}`;
  }
}

function actionColorFor(action?: string): string {
  switch (action) {
    case "accept": return GREEN;
    case "reject": return output.RED;
    default: return BLUE;
  }
}

/**
 * Print a table of negotiations.
 */
function negotiationTable(negotiations: Negotiation[]): void {
  if (negotiations.length === 0) {
    output.dim("  No negotiations found.");
    return;
  }

  const idW = 8;
  const nameW = 22;
  const outcomeW = 14;
  const roleW = 8;
  const turnsW = 6;
  const dateW = 20;

  process.stdout.write(
    `  ${BOLD}${"ID".padEnd(idW)}  ${"Counterparty".padEnd(nameW)}  ${"Outcome".padEnd(outcomeW)}  ${"Role".padEnd(roleW)}  ${"Turns".padEnd(turnsW)}  ${"Created".padEnd(dateW)}${RESET}\n`,
  );
  process.stdout.write(
    `  ${GRAY}${"-".repeat(idW)}  ${"-".repeat(nameW)}  ${"-".repeat(outcomeW)}  ${"-".repeat(roleW)}  ${"-".repeat(turnsW)}  ${"-".repeat(dateW)}${RESET}\n`,
  );

  for (const n of negotiations) {
    const shortId = n.id.slice(0, 8);
    const name = (n.counterparty?.name ?? "Unknown").slice(0, nameW);
    const turns = String(n.outcome?.turnCount ?? n.turns?.length ?? "-");
    const date = n.createdAt
      ? new Date(n.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    const outcomeStr = outcomeLabel(n.outcome);
    const roleStr = roleLabel(n.outcome?.role);

    process.stdout.write(
      `  ${CYAN}${shortId}${RESET}  ${name.padEnd(nameW)}  ${outcomeStr}${output.padTo(outcomeW, output.stripAnsi(outcomeStr))}  ${roleStr}${output.padTo(roleW, output.stripAnsi(roleStr))}  ${turns.padEnd(turnsW)}  ${GRAY}${date}${RESET}\n`,
    );
  }
}

/**
 * Print a detailed card for a single negotiation with turn-by-turn detail.
 */
function negotiationCard(n: Negotiation): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Negotiation Details${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(60)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}             ${GRAY}${n.id}${RESET}`);
  console.log(`  ${BOLD}Counterparty${RESET}   ${n.counterparty?.name ?? "Unknown"}`);
  console.log(`  ${BOLD}Outcome${RESET}        ${outcomeLabel(n.outcome)}`);
  console.log(`  ${BOLD}Your Role${RESET}      ${roleLabel(n.outcome?.role)}`);
  console.log(`  ${BOLD}Turns${RESET}          ${n.outcome?.turnCount ?? n.turns?.length ?? "-"}`);
  console.log(`  ${BOLD}Created${RESET}        ${GRAY}${new Date(n.createdAt).toLocaleString()}${RESET}`);

  if (n.turns && n.turns.length > 0) {
    console.log();
    console.log(`  ${BOLD}Turn-by-Turn${RESET}`);
    console.log(`  ${GRAY}${"─".repeat(60)}${RESET}`);

    for (let i = 0; i < n.turns.length; i++) {
      const t = n.turns[i];
      const time = new Date(t.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const actionColor = actionColorFor(t.action);

      console.log(`  ${DIM}Turn ${i + 1}${RESET}  ${CYAN}${t.speaker?.name ?? "?"}${RESET}  ${actionColor}${t.action}${RESET}  ${GRAY}${time}${RESET}`);

      if (t.suggestedRoles) {
        console.log(`  ${DIM}  roles: own=${t.suggestedRoles.ownUser ?? "?"} other=${t.suggestedRoles.otherUser ?? "?"}${RESET}`);
      }

      if (t.reasoning) {
        const lines = output.wordWrap(t.reasoning, 72);
        for (const line of lines) {
          console.log(`  ${DIM}  ${line}${RESET}`);
        }
      }
      console.log();
    }
  }

  console.log(`  ${GRAY}${"─".repeat(60)}${RESET}`);
  console.log();
}
