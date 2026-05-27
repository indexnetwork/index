/**
 * Table and card formatters for CLI output.
 *
 * Each formatter handles a specific domain entity: sessions, profiles,
 * intents, opportunities, networks, conversations, and messages.
 */

import type { Intent, Opportunity, Conversation, ConversationMessage } from "../types";

import {
  RESET,
  BOLD,
  DIM,
  RED,
  GREEN,
  YELLOW,
  BLUE,
  CYAN,
  WHITE,
  GRAY,
  AGENT_TEXT,
  dim,
  wordWrap,
  confidenceBar,
  padTo,
  stripAnsi,
} from "./base";

// ── Profile card ────────────────────────────────────────────────────

/** User data shape for profile card rendering. */
export interface ProfileData {
  id: string;
  key?: string | null;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: Array<{ label: string; value: string }> | null;
  isGhost: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Render a styled profile card and return it as a string.
 * Also prints the card to stdout.
 *
 * @param data - The user profile data.
 * @returns The rendered card string (with ANSI codes).
 */
export function profileCard(data: ProfileData): string {
  const lines: string[] = [];
  const W = 56;
  const border = (ch: string) => `${CYAN}${ch}${RESET}`;
  const hline = `  ${border("+")}${CYAN}${"─".repeat(W)}${RESET}${border("+")}`;

  lines.push("");
  lines.push(hline);

  // Name line
  const displayName = data.name ?? "(unnamed)";
  const ghostTag = data.isGhost ? `  ${YELLOW}[ghost]${RESET}` : "";
  const nameContent = `${BOLD}${WHITE}${displayName}${RESET}${ghostTag}`;
  lines.push(`  ${border("|")} ${nameContent}${padTo(W - 2, stripAnsi(displayName + (data.isGhost ? "  [ghost]" : "")))}${border("|")}`);

  // Intro / bio
  if (data.intro) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const wrapped = wordWrap(data.intro, W - 4);
    for (const line of wrapped) {
      lines.push(`  ${border("|")}  ${AGENT_TEXT}${line}${RESET}${padTo(W - 2, line)}${border("|")}`);
    }
  }

  // Location
  if (data.location) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const locLine = `Location: ${data.location}`;
    lines.push(`  ${border("|")}  ${GRAY}${locLine}${RESET}${padTo(W - 2, locLine)}${border("|")}`);
  }

  // Socials
  if (data.socials && data.socials.length > 0) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    for (const { label, value } of data.socials) {
      const socialLine = `${label}: ${value}`;
      lines.push(`  ${border("|")}  ${BLUE}${socialLine}${RESET}${padTo(W - 2, socialLine)}${border("|")}`);
    }
  }

  // Member since
  const since = new Date(data.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const sinceLine = `Member since ${since}`;
  lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
  lines.push(`  ${border("|")}  ${DIM}${sinceLine}${RESET}${padTo(W - 2, sinceLine)}${border("|")}`);

  lines.push(hline);
  lines.push("");

  const output = lines.join("\n");
  console.log(output);
  return output;
}

// ── Contact table ──────────────────────────────────────────────────

/**
 * Print a table of contacts.
 *
 * @param contacts - Array of contact objects from the API.
 */
export function contactTable(
  contacts: Array<{ userId: string; name: string; email: string; isGhost?: boolean }>,
): void {
  if (contacts.length === 0) {
    console.log("  No contacts yet.");
    return;
  }
  const nameWidth = Math.max(6, ...contacts.map((c) => c.name.length));
  const header = `  ${"Name".padEnd(nameWidth)}  Email`;
  console.log(`${BOLD}${header}${RESET}`);
  for (const c of contacts) {
    const ghost = c.isGhost ? ` ${DIM}(ghost)${RESET}` : "";
    console.log(`  ${c.name.padEnd(nameWidth)}  ${c.email}${ghost}`);
  }
}

// ── Session table ───────────────────────────────────────────────────

/**
 * Print a table of sessions.
 */
export function sessionTable(
  sessions: Array<{ id: string; title: string | null; createdAt: string }>,
): void {
  if (sessions.length === 0) {
    dim("  No chat sessions found.");
    return;
  }

  const idWidth = 36;
  const titleWidth = 40;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Title".padEnd(titleWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(`  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(titleWidth)}  ${"-".repeat(dateWidth)}${RESET}`);

  for (const s of sessions) {
    const title = (s.title ?? "(untitled)").slice(0, titleWidth);
    const date = new Date(s.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    console.log(
      `  ${GRAY}${s.id.padEnd(idWidth)}${RESET}  ${title.padEnd(titleWidth)}  ${GRAY}${date}${RESET}`,
    );
  }
}

// ── Intent output ──────────────────────────────────────────────────

/**
 * Print a table of intents (user-facing: "signals").
 *
 * @param intents - Array of intent objects from the API.
 */
export function intentTable(intents: Intent[]): void {
  if (intents.length === 0) {
    dim("  No signals found.");
    return;
  }

  const idWidth = 8;
  const descWidth = 44;
  const statusWidth = 10;
  const sourceWidth = 16;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Signal".padEnd(descWidth)}  ${"Status".padEnd(statusWidth)}  ${"Source".padEnd(sourceWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(descWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(sourceWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const intent of intents) {
    const shortId = intent.id.slice(0, 8);
    const desc = (intent.summary ?? intent.payload).slice(0, descWidth);
    const status = (intent.status ?? "").padEnd(statusWidth);
    const source = (intent.sourceType ?? "-").padEnd(sourceWidth);
    const date = new Date(intent.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const sColor = intent.status === "ACTIVE" ? GREEN : GRAY;
    console.log(
      `  ${CYAN}${shortId}${RESET}  ${desc.padEnd(descWidth)}  ${sColor}${status}${RESET}  ${GRAY}${source}${RESET}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a detailed card for a single intent (user-facing: "signal").
 *
 * @param intent - The intent object from the API.
 */
export function intentCard(intent: Intent): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Signal Details${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${intent.id}${RESET}`);
  console.log(`  ${BOLD}Status${RESET}        ${intent.status === "ACTIVE" ? GREEN : GRAY}${intent.status}${RESET}`);

  if (intent.summary) {
    console.log(`  ${BOLD}Summary${RESET}       ${intent.summary}`);
  }

  console.log();
  console.log(`  ${BOLD}Description${RESET}`);
  console.log(`  ${intent.payload}`);

  if (intent.speechActType) {
    console.log();
    console.log(`  ${BOLD}Speech Act${RESET}    ${intent.speechActType}`);
  }
  if (intent.intentMode) {
    console.log(`  ${BOLD}Mode${RESET}          ${intent.intentMode}`);
  }
  if (intent.sourceType) {
    console.log(`  ${BOLD}Source${RESET}        ${intent.sourceType}`);
  }
  if (intent.confidence !== undefined) {
    console.log(`  ${BOLD}Confidence${RESET}    ${confidenceBar(intent.confidence)}`);
  }
  if (intent.semanticEntropy !== undefined) {
    console.log(`  ${BOLD}Entropy${RESET}       ${intent.semanticEntropy.toFixed(2)}`);
  }
  if (intent.isIncognito) {
    console.log(`  ${BOLD}Incognito${RESET}     ${YELLOW}Yes${RESET}`);
  }

  console.log();
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${new Date(intent.createdAt).toLocaleString()}${RESET}`);
  console.log(`  ${BOLD}Updated${RESET}       ${GRAY}${new Date(intent.updatedAt).toLocaleString()}${RESET}`);
  if (intent.archivedAt) {
    console.log(`  ${BOLD}Archived${RESET}      ${GRAY}${new Date(intent.archivedAt).toLocaleString()}${RESET}`);
  }

  if (intent.indexes && intent.indexes.length > 0) {
    console.log();
    console.log(`  ${BOLD}Index Assignments${RESET}`);
    for (const idx of intent.indexes) {
      const score = idx.relevancyScore !== undefined ? ` (${idx.relevancyScore.toFixed(2)})` : "";
      console.log(`  ${CYAN}*${RESET} ${idx.title}${GRAY}${score}${RESET}`);
    }
  }

  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log();
}

// ── Opportunity output ──────────────────────────────────────────────

/** Human-readable labels for valency roles with color. */
const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: "Helper", color: GREEN },
  patient: { label: "Seeker", color: YELLOW },
  peer: { label: "Peer", color: CYAN },
};

/**
 * Get a colored role label for an actor's valency role.
 *
 * @param role - Valency role string (agent, patient, peer).
 * @returns Colored label string.
 */
function roleLabel(role?: string): string {
  const entry = role ? ROLE_LABELS[role] : undefined;
  if (!entry) return `${GRAY}Unknown${RESET}`;
  return `${entry.color}${entry.label}${RESET}`;
}

/**
 * Print a table of opportunities.
 *
 * @param opportunities - Array of opportunity objects.
 */
export function opportunityTable(opportunities: Opportunity[]): void {
  if (opportunities.length === 0) {
    dim("  No opportunities found.");
    return;
  }

  const idW = 8;
  const nameW = 20;
  const catW = 18;
  const statusW = 10;
  const confW = 8;
  const dateW = 20;

  process.stdout.write(
    `  ${BOLD}${"ID".padEnd(idW)}  ${"Counterparty".padEnd(nameW)}  ${"Category".padEnd(catW)}  ${"Status".padEnd(statusW)}  ${"Conf".padEnd(confW)}  ${"Created".padEnd(dateW)}${RESET}\n`,
  );
  process.stdout.write(
    `  ${GRAY}${"-".repeat(idW)}  ${"-".repeat(nameW)}  ${"-".repeat(catW)}  ${"-".repeat(statusW)}  ${"-".repeat(confW)}  ${"-".repeat(dateW)}${RESET}\n`,
  );

  for (const opp of opportunities) {
    const shortId = opp.id.slice(0, 8);
    const fallbackName = opp.actors?.[1]?.name ?? opp.actors?.find((a) => a.name)?.name;
    const name = (opp.counterpartName ?? fallbackName ?? "Unknown").slice(0, nameW);
    const category = (opp.interpretation?.category ?? "-").slice(0, catW);
    const st = opp.status.slice(0, statusW);
    const rawConf = opp.interpretation?.confidence;
    const conf = rawConf != null ? `${Math.round(rawConf <= 1 ? rawConf * 100 : rawConf)}%` : "-";
    const date = opp.createdAt
      ? new Date(opp.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    process.stdout.write(
      `  ${CYAN}${shortId}${RESET}  ${name.padEnd(nameW)}  ${GRAY}${category.padEnd(catW)}${RESET}  ${statusColor(st)}${st.padEnd(statusW)}${RESET}  ${GRAY}${conf.padEnd(confW)}${RESET}  ${GRAY}${date.padEnd(dateW)}${RESET}\n`,
    );
  }
}

/**
 * Print a detailed opportunity card.
 *
 * @param opp - Opportunity object with full details.
 */
export function opportunityCard(opp: Opportunity): void {
  const width = 58;
  const innerWidth = width - 2;

  process.stdout.write(`\n  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);
  process.stdout.write(`  ${BLUE}|${RESET} ${BOLD}${BLUE}Opportunity${RESET}${" ".repeat(innerWidth - 12)}${BLUE}|${RESET}\n`);
  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);

  // Status and category
  const st = opp.status ?? "unknown";
  const category = opp.interpretation?.category ?? "Uncategorized";
  cardLine(`${BOLD}Status:${RESET}  ${statusColor(st)}${st}${RESET}`);
  cardLine(`${BOLD}Category:${RESET}  ${category}`);

  // Confidence
  if (opp.interpretation?.confidence != null) {
    const bar = confidenceBar(opp.interpretation.confidence);
    cardLine(`${BOLD}Confidence:${RESET}  ${bar}`);
  }

  // Parties
  if (opp.actors && opp.actors.length > 0) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Parties:${RESET}`);
    for (const actor of opp.actors) {
      const name = actor.name ?? actor.userId;
      const role = roleLabel(actor.role);
      cardLine(`  ${name}  ${role}`);
    }
  }

  // Reasoning
  if (opp.interpretation?.reasoning) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Reasoning:${RESET}`);
    const wrapped = wordWrap(opp.interpretation.reasoning, innerWidth - 4);
    for (const line of wrapped) {
      cardLine(`  ${AGENT_TEXT}${line}${RESET}`);
    }
  }

  // Presentation
  if (opp.presentation) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Presentation:${RESET}`);
    const wrapped = wordWrap(opp.presentation, innerWidth - 4);
    for (const line of wrapped) {
      cardLine(`  ${AGENT_TEXT}${line}${RESET}`);
    }
  }

  // Timestamps
  if (opp.createdAt) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    const created = new Date(opp.createdAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    cardLine(`${GRAY}Created: ${created}${RESET}`);
  }

  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n\n`);
}

/** Print a line inside a card box. */
function cardLine(content: string): void {
  process.stdout.write(`  ${BLUE}|${RESET} ${content}\n`);
}

/** Get ANSI color for an opportunity status. */
function statusColor(st: string): string {
  switch (st) {
    case "accepted":
      return GREEN;
    case "rejected":
      return RED;
    case "pending":
      return YELLOW;
    case "expired":
      return GRAY;
    default:
      return "";
  }
}

// ── Network output ─────────────────────────────────────────────────

/**
 * Print a table of networks.
 *
 * @param networks - Array of network objects to display.
 */
export function networkTable(
  networks: Array<{
    id: string;
    key?: string | null;
    title: string;
    memberCount?: number;
    role?: string;
    joinPolicy?: string;
    createdAt?: string;
  }>,
): void {
  if (networks.length === 0) {
    dim("  No networks found.");
    return;
  }

  const keyW = 24;
  const titleW = 26;
  const membersW = 8;
  const roleW = 10;
  const policyW = 12;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Key".padEnd(keyW)}  ${"Title".padEnd(titleW)}  ${"Members".padEnd(membersW)}  ${"Role".padEnd(roleW)}  ${"Join Policy".padEnd(policyW)}  ${"Created".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(keyW)}  ${"-".repeat(titleW)}  ${"-".repeat(membersW)}  ${"-".repeat(roleW)}  ${"-".repeat(policyW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const n of networks) {
    const key = (n.key ?? n.id.slice(0, 8)).slice(0, keyW);
    const title = n.title.slice(0, titleW);
    const members = String(n.memberCount ?? "-");
    const role = n.role ?? "member";
    const policy = (n.joinPolicy ?? "invite_only").replace("_", " ");
    const date = n.createdAt
      ? new Date(n.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${CYAN}${key.padEnd(keyW)}${RESET}  ${title.padEnd(titleW)}  ${members.padEnd(membersW)}  ${role.padEnd(roleW)}  ${policy.padEnd(policyW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a network detail card.
 *
 * @param network - Network object with details.
 */
export function networkCard(network: {
  id: string;
  key?: string | null;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  memberCount?: number;
  owner?: { name: string; email: string };
}): void {
  console.log();
  console.log(`  ${BOLD}${network.title}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  if (network.key) {
    console.log(`  ${GRAY}Key:${RESET}         ${CYAN}${network.key}${RESET}`);
  }
  console.log(`  ${GRAY}ID:${RESET}          ${network.id}`);
  if (network.prompt) {
    console.log(`  ${GRAY}Prompt:${RESET}      ${network.prompt}`);
  }
  console.log(`  ${GRAY}Join Policy:${RESET} ${(network.joinPolicy ?? "invite_only").replace("_", " ")}`);
  console.log(`  ${GRAY}Members:${RESET}     ${network.memberCount ?? "-"}`);
  if (network.owner) {
    console.log(`  ${GRAY}Owner:${RESET}       ${network.owner.name} (${network.owner.email})`);
  }
  console.log();
}

/**
 * Print a table of network members.
 *
 * @param members - Array of member objects.
 */
export function memberTable(
  members: Array<{
    name?: string | null;
    email?: string | null;
    /** Legacy nested shape — kept for backward compatibility. */
    user?: { name: string; email: string };
    permissions: string[];
    createdAt?: string;
  }>,
): void {
  if (members.length === 0) {
    dim("  No members found.");
    return;
  }

  const nameW = 24;
  const emailW = 30;
  const roleW = 10;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Name".padEnd(nameW)}  ${"Email".padEnd(emailW)}  ${"Role".padEnd(roleW)}  ${"Joined".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(nameW)}  ${"-".repeat(emailW)}  ${"-".repeat(roleW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const m of members) {
    const name = (m.name ?? m.user?.name ?? "(unnamed)").slice(0, nameW);
    const email = (m.email ?? m.user?.email ?? "").slice(0, emailW);
    const role = m.permissions.includes("owner")
      ? "owner"
      : m.permissions.includes("admin")
        ? "admin"
        : "member";
    const date = m.createdAt
      ? new Date(m.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${name.padEnd(nameW)}  ${email.padEnd(emailW)}  ${role.padEnd(roleW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

// ── Conversation output ───────────────────────────────────────────

/**
 * Print a table of conversations.
 *
 * @param conversations - Array of conversation objects from the API.
 */
export function conversationTable(conversations: Conversation[]): void {
  if (conversations.length === 0) {
    dim("  No conversations found.");
    return;
  }

  const idWidth = 8;
  const participantsWidth = 46;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Participants".padEnd(participantsWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(participantsWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const c of conversations) {
    const shortId = c.id.slice(0, 8);
    const names = c.participants
      .map((p) => p.name ?? p.user?.name ?? p.participantId)
      .join(", ")
      .slice(0, participantsWidth);
    const date = new Date(c.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    console.log(
      `  ${CYAN}${shortId}${RESET}  ${names.padEnd(participantsWidth)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a summary card for a conversation (used after DM get-or-create).
 *
 * @param conversation - The conversation object from the API.
 */
export function conversationCard(conversation: Conversation): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Conversation${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${conversation.id}${RESET}`);

  if (conversation.participants.length > 0) {
    const names = conversation.participants
      .map((p) => p.name ?? p.user?.name ?? p.participantId)
      .join(", ");
    console.log(`  ${BOLD}Participants${RESET}  ${names}`);
  }

  const date = new Date(conversation.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${date}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log();
}

/**
 * Print a list of messages in a conversation.
 *
 * @param messages - Array of message objects from the API.
 */
export function messageList(messages: ConversationMessage[]): void {
  if (messages.length === 0) {
    dim("  No messages found.");
    return;
  }

  for (const msg of messages) {
    const sender = msg.senderId ?? msg.role;
    const time = new Date(msg.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const date = new Date(msg.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const textParts = msg.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("");

    console.log(`  ${CYAN}${sender}${RESET}  ${GRAY}${date} ${time}${RESET}`);
    console.log(`  ${textParts}`);
    console.log();
  }
}
